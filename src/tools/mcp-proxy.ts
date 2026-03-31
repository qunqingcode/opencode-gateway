/**
 * MCP Proxy Tool
 * 
 * 将 Stdio MCP Server 包装成 Tool，放入 tools 层
 * 
 * 用途：集成第三方 MCP Server（如 lark-mcp、github-mcp）
 */

import { spawn, ChildProcess } from 'child_process';
import type { Logger } from '../types';
import { BaseTool } from './base';
import type { ToolResult, ToolContext, JSONSchema } from './types';

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

/** MCP 工具调用结果 */
interface MCPToolResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

// ============================================================
// 配置类型
// ============================================================

export interface MCPProxyToolConfig {
  /** 工具名称（命名空间前缀） */
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

  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
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
// MCP Proxy Tool（对外暴露）
// ============================================================

/**
 * MCP Proxy Tool
 * 
 * 启动 STDIO MCP Server 作为子进程，动态发现工具，代理调用
 */
export class MCPProxyTool extends BaseTool {
  readonly definition: {
    name: string;
    description: string;
    inputSchema: JSONSchema;
    requiresApproval?: boolean;
    internal?: boolean;
  };

  private config: MCPProxyToolConfig;
  private mcpServer: StdioMCPServer;
  private discoveredActions: Map<string, { description: string; inputSchema?: unknown }> = new Map();

  constructor(config: MCPProxyToolConfig, logger: Logger) {
    super(logger);
    this.config = config;

    // 初始定义
    this.definition = {
      name: config.name,
      description: config.description || `MCP Server: ${config.name}`,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: '操作类型（启动后动态发现）' },
        },
        required: ['action'],
      },
    };

    // 创建内部 MCP Server
    const command = typeof config.command === 'function' ? config.command() : config.command;
    this.mcpServer = new StdioMCPServer(config.name, command, logger, config.env, config.cwd);
  }

  // ============================================================
  // 生命周期
  // ============================================================

  async start(): Promise<void> {
    await this.mcpServer.start();
    this.updateDefinition();
    this.logger.info(`[MCPProxy:${this.config.name}] Ready with ${this.discoveredActions.size} actions`);
  }

  async stop(): Promise<void> {
    await this.mcpServer.stop();
  }

  // ============================================================
  // 工具执行
  // ============================================================

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = args.action as string;

    if (!action) {
      return this.error('Missing action parameter');
    }

    if (!this.discoveredActions.has(action)) {
      const available = Array.from(this.discoveredActions.keys()).join(', ');
      return this.error(`Unknown action: ${action}. Available: ${available}`);
    }

    try {
      this.logger.info(`[MCPProxy:${this.config.name}] Executing: ${action}`);

      // 提取实际参数（去掉 action 字段）
      const toolArgs = { ...args };
      delete toolArgs.action;

      const result = await this.mcpServer.callTool(action, toolArgs);

      if (result.success) {
        return this.success(result.output);
      } else {
        return this.error(result.error || 'Unknown error');
      }
    } catch (error) {
      this.logger.error(`[MCPProxy:${this.config.name}] Failed: ${(error as Error).message}`);
      return this.error((error as Error).message);
    }
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private updateDefinition(): void {
    const tools = this.mcpServer.listTools();
    const actionDescriptions: string[] = [];

    this.discoveredActions.clear();

    for (const tool of tools) {
      this.discoveredActions.set(tool.name, {
        description: tool.description || tool.name,
        inputSchema: tool.inputSchema,
      });
      actionDescriptions.push(`${tool.name}: ${tool.description || tool.name}`);
    }

    this.definition.inputSchema = {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: `操作类型:\n${actionDescriptions.join('\n')}`,
        },
      },
      required: ['action'],
    };
  }

  /**
   * 获取发现的工具列表
   */
  getDiscoveredActions(): string[] {
    return Array.from(this.discoveredActions.keys());
  }
}