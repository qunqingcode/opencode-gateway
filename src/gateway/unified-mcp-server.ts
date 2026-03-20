/**
 * 统一 MCP HTTP Server
 * 
 * 一个服务暴露所有 MCP 工具
 * OpenCode 通过 HTTP 连接，无需启动多个进程
 */

import http from 'http';
import type { IMCPClient, MCPToolDefinition, ToolContext } from '../gateway/types';
import type { Logger } from '../channels/types';
import type { ChannelPlugin } from '../channels/types';
import type { ActiveContext } from './context';

// ============================================================
// 类型定义
// ============================================================

/** Gateway 接口（仅需要获取上下文的方法） */
interface IGatewayContext {
  getActiveContext(): ActiveContext | null;
}

// ============================================================
// MCP 协议类型
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
// 统一 MCP HTTP Server
// ============================================================

export class UnifiedMCPHTTPServer {
  private mcpClient: IMCPClient;
  private logger: Logger;
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private channel: ChannelPlugin | null = null;
  private gateway: IGatewayContext | null = null;

  constructor(mcpClient: IMCPClient, logger: Logger, port: number = 3100, host: string = 'localhost') {
    this.mcpClient = mcpClient;
    this.logger = logger;
    this.port = port;
    this.host = host;
  }

  /**
   * 设置消息发送通道
   */
  setChannel(channel: ChannelPlugin): void {
    this.channel = channel;
    this.logger.info(`[MCP] Channel set: ${channel.name}`);
  }

  /**
   * 设置 Gateway（用于获取活跃上下文）
   */
  setGateway(gateway: IGatewayContext): void {
    this.gateway = gateway;
  }

  /**
   * 启动 MCP HTTP 服务
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.port, this.host, () => {
        this.logger.info(`[MCP] Unified HTTP Server started at http://${this.host}:${this.port}`);
        this.logger.info(`[MCP] OpenCode config: { "type": "remote", "url": "http://${this.host}:${this.port}/mcp" }`);
        resolve();
      });

      this.server.on('error', (err) => {
        this.logger.error(`[MCP] Server error: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * 停止服务
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('[MCP] Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 获取服务 URL
   */
  getUrl(): string {
    return `http://${this.host}:${this.port}/mcp`;
  }

  /**
   * 处理 HTTP 请求
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // SSE 端点 (用于流式响应)
    if (req.url === '/sse' && req.method === 'GET') {
      this.handleSSE(req, res);
      return;
    }

    // MCP 端点
    if (req.url?.startsWith('/mcp') && req.method === 'POST') {
      await this.handleMCPRequest(req, res);
      return;
    }

    // 健康检查
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', servers: this.mcpClient.getServerNames() }));
      return;
    }

    // 工具列表 (GET)
    if (req.url === '/tools' && req.method === 'GET') {
      const tools = await this.mcpClient.discoverTools();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tools }));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  }

  /**
   * 处理 MCP JSON-RPC 请求
   */
  private async handleMCPRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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
   * 处理 JSON-RPC 请求
   */
  private async handleJSONRPC(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    const { id, method, params } = request;

    // 记录所有 OpenCode 请求
    this.logger.info(`[MCP] Request: method=${method}, id=${id}, params=${JSON.stringify(params)}`);

    try {
      let result: unknown;

      switch (method) {
        case 'initialize':
          result = await this.handleInitialize(params);
          break;

        case 'notifications/initialized':
          // 客户端确认初始化完成
          result = {};
          break;

        case 'tools/list':
          result = await this.handleToolsList();
          break;

        case 'tools/call':
          result = await this.handleToolsCall(params);
          break;

        case 'ping':
          result = {};
          break;

        case 'resources/list':
          // 暂不支持资源
          result = { resources: [] };
          break;

        case 'prompts/list':
          // 暂不支持提示词
          result = { prompts: [] };
          break;

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
          };
      }

      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      this.logger.error(`[MCP] Error handling ${method}: ${(error as Error).message}`);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: (error as Error).message,
        },
      };
    }
  }

  /**
   * 处理初始化
   */
  private async handleInitialize(params: unknown): Promise<unknown> {
    const initParams = params as { clientInfo?: { name: string; version: string } };
    
    this.logger.info(`[MCP] Client connected: ${initParams?.clientInfo?.name || 'unknown'}`);

    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      serverInfo: {
        name: 'opencode-gateway-mcp',
        version: '3.0.0',
      },
    };
  }

  /**
   * 处理工具列表
   */
  private async handleToolsList(): Promise<unknown> {
    const tools = await this.mcpClient.discoverTools();
    
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  }

  /**
   * 处理工具调用
   */
  private async handleToolsCall(params: unknown): Promise<unknown> {
    const callParams = params as {
      name: string;
      arguments: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    };

    if (!callParams?.name) {
      throw new Error('Missing tool name');
    }

    // 解析工具名称 (格式: server.tool)
    const parts = callParams.name.split('.');
    const server = parts.length > 1 ? parts[0] : '';
    const toolName = parts.length > 1 ? parts.slice(1).join('.') : callParams.name;

    this.logger.info(`[MCP] Tool call: ${callParams.name}`);
    this.logger.info(`[MCP] Tool args: ${JSON.stringify(callParams.arguments || {}).slice(0, 200)}`);

    // 从 Gateway 获取活跃上下文
    const activeContext = this.gateway?.getActiveContext();
    const chatId = activeContext?.chatId || '';
    const userId = activeContext?.userId || '';
    const sessionId = activeContext?.sessionId || '';

    if (!chatId) {
      this.logger.warn(`[MCP] No active context, card will not be sent`);
    }

    // 构建工具上下文
    const context: ToolContext = {
      chatId,
      userId,
      sessionId,
      sendText: async (text: string) => {
        if (this.channel && chatId) {
          await this.channel.outbound.sendText(chatId, text);
          this.logger.info(`[MCP Tool] sendText sent to ${chatId}`);
        } else {
          this.logger.warn('[MCP Tool] sendText: no channel or chatId');
        }
      },
      sendCard: async (card: unknown) => {
        if (this.channel && chatId && this.channel.outbound.sendCard) {
          await this.channel.outbound.sendCard(chatId, card);
          this.logger.info(`[MCP Tool] sendCard sent to ${chatId}`);
        } else {
          this.logger.warn('[MCP Tool] sendCard: no channel or chatId');
        }
      },
      logger: this.logger,
    };

    // 调用 MCP 工具
    const toolResult = await this.mcpClient.callTool(
      { server, tool: toolName, arguments: callParams.arguments || {} },
      context
    );

    this.logger.info(`[MCP] Tool result: success=${toolResult.success}, requiresApproval=${toolResult.requiresApproval}`);

    return {
      content: [
        {
          type: 'text',
          text: toolResult.success
            ? typeof toolResult.output === 'string'
              ? toolResult.output
              : JSON.stringify(toolResult.output, null, 2)
            : `Error: ${toolResult.error}`,
        },
      ],
      isError: !toolResult.success,
    };
  }

  /**
   * 处理 SSE 连接
   */
  private handleSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 发送初始事件
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    // 保持连接
    const keepAlive = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
    });
  }

  /**
   * 读取请求体
   */
  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }
}