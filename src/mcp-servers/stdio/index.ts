/**
 * Stdio MCP Server 代理
 * 
 * 启动任意 STDIO 模式的 MCP Server 作为子进程
 * 通过 JSON-RPC 与之通信
 * 
 * 用途：集成官方/第三方 MCP Server（如 lark-mcp）
 */

import { spawn, ChildProcess } from 'child_process';
import type { IMCPServer, ToolDefinition, ToolResult } from '../types';
import type { MCPToolCallResult, ToolContext } from '../../gateway/types';
import type { Logger } from '../../channels/types';

// ============================================================
// 类型定义
// ============================================================

export interface StdioMCPServerConfig {
  /** Server 名称（用于工具前缀） */
  name: string;
  /** 启动命令 */
  command: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工作目录 */
  cwd?: string;
  /** 是否启用 */
  enabled?: boolean;
}

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

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

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

// ============================================================
// Stdio MCP Server 实现
// ============================================================

export class StdioMCPServer implements IMCPServer {
  readonly name: string;
  readonly description?: string;

  private config: StdioMCPServerConfig;
  private logger: Logger;
  private process: ChildProcess | null = null;
  private tools: Map<string, ToolDefinition> = new Map();
  private pendingRequests = new Map<string | number, {
    resolve: (value: JSONRPCResponse) => void;
    reject: (error: Error) => void;
  }>();
  private buffer = '';
  private initialized = false;
  private requestId = 0;

  constructor(config: StdioMCPServerConfig, logger: Logger) {
    this.name = config.name;
    this.config = config;
    this.logger = logger;
  }

  // ============================================================
  // 生命周期管理
  // ============================================================

  async start(): Promise<void> {
    if (this.process) return;

    this.logger.info(`[StdioMCP:${this.name}] Starting with command: ${this.config.command.join(' ')}`);

    // 启动子进程
    this.process = spawn(this.config.command[0], this.config.command.slice(1), {
      env: { ...process.env, ...this.config.env },
      cwd: this.config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // 处理 stdout (JSON-RPC 响应)
    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleStdout(data);
    });

    // 处理 stderr (日志)
    this.process.stderr?.on('data', (data: Buffer) => {
      this.logger.debug?.(`[StdioMCP:${this.name}] stderr: ${data.toString()}`);
    });

    // 处理进程退出
    this.process.on('exit', (code, signal) => {
      this.logger.info(`[StdioMCP:${this.name}] Process exited: code=${code}, signal=${signal}`);
      this.process = null;
      this.initialized = false;
    });

    this.process.on('error', (err) => {
      this.logger.error(`[StdioMCP:${this.name}] Process error: ${err.message}`);
    });

    // 初始化 MCP 协议
    await this.initialize();

    // 发现工具
    await this.discoverTools();

    this.logger.info(`[StdioMCP:${this.name}] Started with ${this.tools.size} tools`);
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    this.logger.info(`[StdioMCP:${this.name}] Stopping...`);

    // 发送 shutdown 请求
    try {
      await this.sendRequest('shutdown', {});
    } catch {
      // 忽略错误
    }

    // 强制退出
    this.process.kill();
    this.process = null;
    this.initialized = false;
  }

  // ============================================================
  // IMCPServer 接口实现
  // ============================================================

  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async callTool(toolName: string, args: Record<string, unknown>, context: ToolContext): Promise<MCPToolCallResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${toolName}`,
      };
    }

    try {
      this.logger.info(`[StdioMCP:${this.name}] Calling tool: ${toolName}`);

      // 调用远程 MCP server
      const response = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: args,
      });

      if (response.error) {
        return {
          success: false,
          error: response.error.message,
        };
      }

      // 解析结果
      const result = response.result as { content?: Array<{ type: string; text?: string }> };
      const textContent = result?.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text || '')
        .join('\n');

      return {
        success: true,
        output: textContent || result,
      };
    } catch (error) {
      this.logger.error(`[StdioMCP:${this.name}] Tool call failed: ${(error as Error).message}`);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  // ============================================================
  // MCP 协议实现
  // ============================================================

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'opencode-gateway',
        version: '3.0.0',
      },
    });

    if (response.error) {
      throw new Error(`Initialize failed: ${response.error.message}`);
    }

    // 发送 initialized 通知
    this.sendNotification('notifications/initialized', {});

    this.initialized = true;
    this.logger.info(`[StdioMCP:${this.name}] Initialized`);
  }

  private async discoverTools(): Promise<void> {
    const response = await this.sendRequest('tools/list', {});

    if (response.error) {
      this.logger.error(`[StdioMCP:${this.name}] Failed to list tools: ${response.error.message}`);
      return;
    }

    const result = response.result as { tools?: MCPTool[] };
    const tools = result?.tools || [];

    this.tools.clear();

    for (const tool of tools) {
      // 转换 inputSchema 到统一格式
      const rawProps = (tool.inputSchema?.properties as Record<string, unknown>) || {};
      const properties: Record<string, { type: string; description: string }> = {};
      
      for (const [key, value] of Object.entries(rawProps)) {
        const prop = value as { type?: string; description?: string };
        properties[key] = {
          type: prop.type || 'string',
          description: prop.description || `${key} parameter`,
        };
      }

      const toolDef: ToolDefinition = {
        name: tool.name,
        description: tool.description || `Tool: ${tool.name}`,
        inputSchema: {
          type: 'object' as const,
          properties,
          required: tool.inputSchema?.required || [],
        },
        execute: async () => ({ success: true }), // 占位，实际在 callTool 中执行
      };
      this.tools.set(tool.name, toolDef);
      this.logger.debug?.(`[StdioMCP:${this.name}] Discovered tool: ${tool.name}`);
    }
  }

  // ============================================================
  // JSON-RPC 通信
  // ============================================================

  private sendRequest(method: string, params: unknown): Promise<JSONRPCResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Process not running'));
        return;
      }

      const id = ++this.requestId;
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      const message = JSON.stringify(request) + '\n';
      this.process.stdin.write(message);
      this.logger.debug?.(`[StdioMCP:${this.name}] Sent: ${message.trim()}`);
    });
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.process?.stdin) return;

    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const message = JSON.stringify(notification) + '\n';
    this.process.stdin.write(message);
  }

  private handleStdout(data: Buffer): void {
    this.buffer += data.toString();

    // 按行解析 JSON-RPC 消息
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // 保留最后一个不完整的行

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response: JSONRPCResponse = JSON.parse(line);
        this.logger.debug?.(`[StdioMCP:${this.name}] Received: ${line}`);

        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          pending.resolve(response);
        }
      } catch {
        this.logger.warn(`[StdioMCP:${this.name}] Failed to parse: ${line}`);
      }
    }
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createStdioMCPServer(config: StdioMCPServerConfig, logger: Logger): StdioMCPServer {
  return new StdioMCPServer(config, logger);
}