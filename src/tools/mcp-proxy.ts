/**
 * MCP Proxy Tool
 * 
 * 将 Stdio MCP Server 的工具动态代理为独立工具
 * 
 * 用途：集成第三方 MCP Server（如 lark-mcp、github-mcp）
 */

import { spawn, ChildProcess } from 'child_process';
import type { Logger } from '../types';
import { BaseTool } from './base';
import type { ToolDefinition, ToolResult, ToolContext, ITool, JSONSchema } from './types';

// ============================================================
// 内部类型定义
// ============================================================

/** MCP 工具定义（从 MCP Server 发现的） */
interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/** JSON-RPC 请求 */
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

/** JSON-RPC 响应 */
interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ============================================================
// 配置类型
// ============================================================

export interface MCPProxyToolConfig {
  /** 工具命名空间前缀（如 'lark', 'github'） */
  name: string;
  /** 工具描述 */
  description?: string;
  /** MCP Server 启动命令 */
  command: string[] | (() => string[]);
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工作目录 */
  cwd?: string;
}

// ============================================================
// Stdio MCP Server（内部实现）
// ============================================================

/**
 * Stdio MCP Server
 * 
 * 启动 STDIO 模式的 MCP Server 作为子进程，通过 JSON-RPC 通信
 */
class StdioMCPServer {
  readonly name: string;

  private command: string[];
  private env?: Record<string, string>;
  private cwd?: string;
  private logger: Logger;
  private process: ChildProcess | null = null;
  private tools: Map<string, MCPToolInfo> = new Map();
  private pendingRequests = new Map<string | number, {
    resolve: (value: JSONRPCResponse) => void;
    reject: (error: Error) => void;
  }>();
  private buffer = '';
  private initialized = false;
  private requestId = 0;

  constructor(name: string, command: string[], logger: Logger, env?: Record<string, string>, cwd?: string) {
    this.name = name;
    this.command = command;
    this.logger = logger;
    this.env = env;
    this.cwd = cwd;
  }

  async start(): Promise<void> {
    if (this.process) return;

    this.logger.info(`[StdioMCP:${this.name}] Starting: ${this.command.join(' ')}`);

    // 启动子进程（Windows 需要 shell: true）
    this.process = spawn(this.command[0], this.command.slice(1), {
      env: { ...process.env, ...this.env },
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    this.process.stdout?.on('data', (data: Buffer) => this.handleStdout(data));
    this.process.stderr?.on('data', (data: Buffer) => {
      this.logger.debug?.(`[StdioMCP:${this.name}] stderr: ${data.toString()}`);
    });
    this.process.on('exit', (code) => {
      this.logger.info(`[StdioMCP:${this.name}] Exited: code=${code}`);
      this.process = null;
      this.initialized = false;
    });
    this.process.on('error', (err) => {
      this.logger.error(`[StdioMCP:${this.name}] Error: ${err.message}`);
    });

    await this.initialize();
    await this.discoverTools();

    this.logger.info(`[StdioMCP:${this.name}] Started with ${this.tools.size} tools`);
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    this.logger.info(`[StdioMCP:${this.name}] Stopping...`);
    try { await this.sendRequest('shutdown', {}); } catch { /* ignore */ }
    this.process.kill();
    this.process = null;
    this.initialized = false;
  }

  listTools(): MCPToolInfo[] {
    return Array.from(this.tools.values());
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.tools.has(toolName)) {
      return { success: false, error: `Unknown tool: ${toolName}` };
    }

    try {
      this.logger.info(`[StdioMCP:${this.name}] Calling: ${toolName}`);
      const response = await this.sendRequest('tools/call', { name: toolName, arguments: args });

      if (response.error) {
        return { success: false, error: response.error.message };
      }

      const result = response.result as { content?: Array<{ type: string; text?: string }> };
      const textContent = result?.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text || '')
        .join('\n');

      return { success: true, output: textContent || result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'opencode-gateway', version: '4.0.0' },
    });
    if (response.error) throw new Error(`Initialize failed: ${response.error.message}`);
    this.sendNotification('notifications/initialized', {});
    this.initialized = true;
  }

  private async discoverTools(): Promise<void> {
    const response = await this.sendRequest('tools/list', {});
    if (response.error) return;

    const result = response.result as { tools?: MCPToolInfo[] };
    this.tools.clear();
    for (const tool of result?.tools || []) {
      this.tools.set(tool.name, tool);
    }
  }

  private sendRequest(method: string, params: unknown): Promise<JSONRPCResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Process not running'));
        return;
      }

      const id = ++this.requestId;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (res) => { clearTimeout(timeout); resolve(res); },
        reject: (err) => { clearTimeout(timeout); reject(err); },
      });

      this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  private sendNotification(method: string, params: unknown): void {
    this.process?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  private handleStdout(data: Buffer): void {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response: JSONRPCResponse = JSON.parse(line);
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          pending.resolve(response);
        }
      } catch {
        this.logger.warn(`[StdioMCP:${this.name}] Parse error: ${line}`);
      }
    }
  }
}

// ============================================================
// 动态代理工具
// ============================================================

/**
 * 单个 MCP 工具的代理
 * 
 * 将 MCP Server 的一个工具包装为独立工具
 */
class MCPToolProxy extends BaseTool {
  readonly definition: ToolDefinition;

  private namespace: string;
  private toolName: string;
  private mcpServer: StdioMCPServer;

  constructor(namespace: string, tool: MCPToolInfo, mcpServer: StdioMCPServer, logger: Logger) {
    super(logger);
    this.namespace = namespace;
    this.toolName = tool.name;
    this.mcpServer = mcpServer;

    // 构建工具定义
    this.definition = {
      name: `${namespace}.${tool.name}`,
      description: tool.description || `MCP tool: ${tool.name}`,
      inputSchema: this.buildInputSchema(tool.inputSchema),
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    return this.mcpServer.callTool(this.toolName, args);
  }

  private buildInputSchema(schema?: MCPToolInfo['inputSchema']): JSONSchema {
    if (!schema || schema.type !== 'object') {
      return { type: 'object', properties: {} };
    }
    return {
      type: 'object',
      properties: (schema.properties as JSONSchema['properties']) || {},
      required: schema.required,
    };
  }
}

// ============================================================
// MCP Proxy Tool（对外暴露）
// ============================================================

/**
 * MCP Proxy Tool
 * 
 * 启动 STDIO MCP Server，动态发现工具并创建独立工具代理
 */
export class MCPProxyTool {
  private config: MCPProxyToolConfig;
  private mcpServer: StdioMCPServer;
  private tools: ITool[] = [];
  private logger: Logger;

  constructor(config: MCPProxyToolConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;

    const command = typeof config.command === 'function' ? config.command() : config.command;
    this.mcpServer = new StdioMCPServer(config.name, command, logger, config.env, config.cwd);
  }

  // ============================================================
  // 生命周期
  // ============================================================

  async start(): Promise<void> {
    await this.mcpServer.start();
    this.createToolProxies();
    this.logger.info(`[MCPProxy:${this.config.name}] Created ${this.tools.length} tools`);
  }

  async stop(): Promise<void> {
    await this.mcpServer.stop();
  }

  // ============================================================
  // 获取工具
  // ============================================================

  /**
   * 获取所有代理工具
   * 
   * 返回独立工具实例，可直接注册到 ToolRegistry
   */
  getTools(): ITool[] {
    return this.tools;
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private createToolProxies(): void {
    const mcpTools = this.mcpServer.listTools();
    this.tools = mcpTools.map(tool => 
      new MCPToolProxy(this.config.name, tool, this.mcpServer, this.logger)
    );
  }
}

/**
 * 创建 MCP Proxy 工具
 * 
 * @returns 工具实例数组，可直接注册
 */
export async function createMCPProxyTools(config: MCPProxyToolConfig, logger: Logger): Promise<ITool[]> {
  const proxy = new MCPProxyTool(config, logger);
  await proxy.start();
  return proxy.getTools();
}