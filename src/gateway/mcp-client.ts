/**
 * MCP 客户端
 * 
 * 职责：
 * 1. 管理 MCP Servers
 * 2. 工具发现和调用
 * 3. 统一的工具执行接口
 */

import type {
  IMCPClient,
  IMCPServer,
  MCPToolDefinition,
  MCPToolCallRequest,
  MCPToolCallResult,
  ToolContext,
  Logger,
} from './types';

// ============================================================
// MCP 客户端实现
// ============================================================

export class MCPClient implements IMCPClient {
  private servers = new Map<string, IMCPServer>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  // ============================================================
  // Server 管理
  // ============================================================

  registerServer(name: string, server: IMCPServer): void {
    this.servers.set(name, server);
    this.logger.info(`[MCP] Registered server: ${name}`);
  }

  async startAll(): Promise<void> {
    for (const [name, server] of this.servers) {
      try {
        await server.start();
        this.logger.info(`[MCP] Started server: ${name}`);
      } catch (error) {
        this.logger.error(`[MCP] Failed to start ${name}: ${(error as Error).message}`);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const [name, server] of this.servers) {
      try {
        await server.stop();
        this.logger.info(`[MCP] Stopped server: ${name}`);
      } catch (error) {
        this.logger.error(`[MCP] Failed to stop ${name}: ${(error as Error).message}`);
      }
    }
  }

// ============================================================
// 工具发现
// ============================================================

  async discoverTools(includeInternal = false): Promise<MCPToolDefinition[]> {
    const tools: MCPToolDefinition[] = [];

    for (const [serverName, server] of this.servers) {
      const serverTools = server.listTools();
      for (const tool of serverTools) {
        // 过滤内部工具（除非明确要求包含）
        if (!includeInternal && (tool as any).internal) {
          continue;
        }
        tools.push({
          ...tool,
          // 添加 server 前缀以区分同名工具
          name: `${serverName}.${tool.name}`,
        });
      }
    }

    return tools;
  }

  getTools(server: string): MCPToolDefinition[] {
    const serverInstance = this.servers.get(server);
    if (!serverInstance) {
      return [];
    }
    return serverInstance.listTools();
  }

  // ============================================================
  // 工具调用
  // ============================================================

  async callTool(request: MCPToolCallRequest, context: ToolContext): Promise<MCPToolCallResult> {
    const { server, tool, arguments: args } = request;

    const serverInstance = this.servers.get(server);
    if (!serverInstance) {
      return {
        success: false,
        error: `Unknown MCP server: ${server}`,
      };
    }

    try {
      this.logger.info(`[MCP] Calling ${server}.${tool}`);
      const result = await serverInstance.callTool(tool, args, context);
      return result;
    } catch (error) {
      this.logger.error(`[MCP] Tool call failed: ${(error as Error).message}`);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 检查服务器是否存在
   */
  hasServer(name: string): boolean {
    return this.servers.has(name);
  }

  /**
   * 获取所有服务器名称
   */
  getServerNames(): string[] {
    return Array.from(this.servers.keys());
  }
}