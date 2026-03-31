/**
 * MCP HTTP Server
 * 
 * 提供 JSON-RPC 接口供 OpenCode 调用工具
 */

import http from 'http';
import type { Logger } from '../../types';
import type { ToolRegistry, ToolContext } from '../../tools';

// ============================================================
// JSON-RPC 类型
// ============================================================

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ============================================================
// MCP Server 配置
// ============================================================

export interface MCPServerConfig {
  port: number;
  host: string;
}

// ============================================================
// MCP HTTP Server
// ============================================================

export class MCPHTTPServer {
  private toolRegistry: ToolRegistry;
  private logger: Logger;
  private config: MCPServerConfig;
  private server: http.Server | null = null;
  private activeContext: {
    chatId: string;
    userId: string;
    sessionId: string;
    sendText: (text: string) => Promise<void>;
    sendCard: (card: unknown) => Promise<void>;
  } | null = null;

  constructor(
    toolRegistry: ToolRegistry,
    config: MCPServerConfig,
    logger: Logger
  ) {
    this.toolRegistry = toolRegistry;
    this.config = config;
    this.logger = logger;
  }

  /**
   * 设置活跃上下文
   */
  setActiveContext(context: typeof this.activeContext): void {
    this.activeContext = context;
  }

  /**
   * 启动服务
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.logger.info(`[MCPServer] Started at http://${this.config.host}:${this.config.port}`);
        this.logger.info(`[MCPServer] OpenCode config: { "type": "remote", "url": "http://${this.config.host}:${this.config.port}/mcp" }`);
        resolve();
      });

      this.server.on('error', (err) => {
        this.logger.error(`[MCPServer] Error: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * 停止服务
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('[MCPServer] Stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 处理请求
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // 健康检查
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', tools: this.toolRegistry.names() }));
      return;
    }

    // 工具列表
    if (req.url === '/tools') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tools: this.toolRegistry.listPublic() }));
      return;
    }

    // MCP 端点
    if (req.url?.startsWith('/mcp') && req.method === 'POST') {
      await this.handleMCP(req, res);
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  }

  /**
   * 处理 MCP 请求
   */
  private async handleMCP(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);

    try {
      const request: JSONRPCRequest = JSON.parse(body);
      const response = await this.handleJSONRPC(request);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (error) {
      const response: JSONRPCResponse = {
        jsonrpc: '2.0',
        error: {
          code: -32700,
          message: 'Parse error',
          data: (error as Error).message,
        },
      };
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    }
  }

  /**
   * 处理 JSON-RPC
   */
  private async handleJSONRPC(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    const { id, method, params } = request;

    this.logger.info(`[MCPServer] Request: ${method}`);

    try {
      let result: unknown;

      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'opencode-gateway', version: '4.0.0' },
          };
          break;

        case 'tools/list':
          result = { tools: this.toolRegistry.listPublic() };
          break;

        case 'tools/call':
          result = await this.handleToolCall(params);
          break;

        case 'ping':
          result = {};
          break;

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          };
      }

      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'Internal error', data: (error as Error).message },
      };
    }
  }

  /**
   * 处理工具调用
   */
  private async handleToolCall(params: unknown): Promise<unknown> {
    const { name, arguments: args } = params as {
      name: string;
      arguments: Record<string, unknown>;
    };

    if (!name) {
      throw new Error('Missing tool name');
    }

    // 构建上下文
    const context: ToolContext = {
      chatId: this.activeContext?.chatId || '',
      userId: this.activeContext?.userId || '',
      sessionId: this.activeContext?.sessionId || '',
      sendText: this.activeContext?.sendText || (async () => {}),
      sendCard: this.activeContext?.sendCard || (async () => {}),
      logger: this.logger,
    };

    // 执行工具
    const result = await this.toolRegistry.execute(name, args || {}, context);

    return {
      content: [
        {
          type: 'text',
          text: result.success
            ? typeof result.output === 'string'
              ? result.output
              : JSON.stringify(result.output, null, 2)
            : `Error: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  }

  /**
   * 读取请求体
   */
  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }
}