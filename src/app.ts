/**
 * 应用核心 - 自动编排所有组件
 * 
 * 职责：
 * 1. 根据配置自动创建组件
 * 2. 自动注册和启动
 * 3. 生命周期管理
 */

import { Gateway, createGateway, UnifiedMCPHTTPServer } from './gateway';
import { createChannel, ChannelPlugin } from './channels';
import { createMCPServer, IMCPServer } from './mcp-servers';
import type { Logger } from './types';

// ============================================================
// 配置类型
// ============================================================

export interface AppConfig {
  port: number;
  opencode: {
    url: string;
    timeout: number;
    modelId?: string;
    providerId?: string;
  };
  channels: Record<string, ChannelConfig>;
  mcpServers: Record<string, MCPServerConfig>;
}

export interface ChannelConfig {
  enabled: boolean;
  type?: string;
  [key: string]: unknown;
}

export interface MCPServerConfig {
  enabled: boolean;
  type?: 'stdio' | string;
  command?: () => string[];
  [key: string]: unknown;
}

// ============================================================
// 应用类
// ============================================================

export class App {
  private config: AppConfig;
  private logger: Logger;
  private gateway: Gateway | null = null;
  private mcpHttpServer: UnifiedMCPHTTPServer | null = null;
  private channels: Map<string, ChannelPlugin> = new Map();
  private mcpServers: Map<string, IMCPServer> = new Map();

  constructor(config: AppConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  async start(): Promise<void> {
    this.logger.info('========================================');
    this.logger.info('  OpenCode Gateway v3.0');
    this.logger.info('========================================');

    // 1. 创建 Gateway
    this.gateway = createGateway({
      opencode: this.config.opencode,
      mcpServers: [],
    }, this.logger);

    // 2. 注册 MCP Servers
    await this.registerMCPServers();

    // 3. 初始化 Gateway
    await this.gateway.init();

    // 4. 启动 MCP HTTP 服务
    this.mcpHttpServer = new UnifiedMCPHTTPServer(
      this.gateway.getMCPClient(),
      this.logger,
      this.config.port
    );
    this.mcpHttpServer.setGateway(this.gateway);
    await this.mcpHttpServer.start();

    // 5. 注册并启动 Channels
    await this.registerChannels();

    // 6. 设置 Channel 到 MCP HTTP Server
    const firstChannel = Array.from(this.channels.values())[0];
    if (firstChannel) {
      this.mcpHttpServer.setChannel(firstChannel);
    }

    // 7. 打印信息
    this.printStartupInfo();

    // 8. 注册关闭钩子
    this.registerShutdownHooks();
  }

  private async registerMCPServers(): Promise<void> {
    const mcpClient = this.gateway!.getMCPClient();
    const servers = this.config.mcpServers;

    for (const [name, config] of Object.entries(servers)) {
      if (!config.enabled) continue;

      // 处理 Stdio 类型
      const serverConfig = config.type === 'stdio' && config.command
        ? { ...config, name, command: config.command() }
        : config;

      // 从 config 中移除 type (command 已在上方解析为数组，不需要删除)
      const cleanConfig = { ...serverConfig };
      delete (cleanConfig as any).type;

      const server = createMCPServer(
        config.type === 'stdio' ? 'stdio' : name,
        cleanConfig as Record<string, unknown>,
        this.logger
      );

      if (server) {
        // Stdio 类型需要先启动
        if (config.type === 'stdio') {
          await server.start();
        }
        mcpClient.registerServer(name, server);
        this.mcpServers.set(name, server);
        this.logger.info(`[MCP] Registered: ${name}`);
      }
    }
  }

  private async registerChannels(): Promise<void> {
    const channels = this.config.channels;

    for (const [name, config] of Object.entries(channels)) {
      if (!config.enabled) continue;

      const channel = createChannel(
        { ...config, id: name, type: name } as any,
        this.logger
      );

      if (channel) {
        this.gateway!.registerChannel(channel);
        
        // 启动
        await channel.lifecycle.start();
        const health = await channel.lifecycle.healthCheck();
        
        this.channels.set(name, channel);
        this.logger.info(`[Channel] ${name}: ${health.healthy ? 'OK' : 'FAIL'} - ${health.message}`);
      }
    }
  }

  private printStartupInfo(): void {
    const tools = this.gateway!.getMCPClient().getServerNames();
    const channels = Array.from(this.channels.keys());

    this.logger.info(`[Startup] Channels: ${channels.join(', ') || 'none'}`);
    this.logger.info(`[Startup] MCP Servers: ${tools.join(', ') || 'none'}`);
    this.logger.info(`[Startup] MCP URL: http://localhost:${this.config.port}/mcp`);
    
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║              OpenCode MCP 配置指南                              ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  MCP URL: http://localhost:${this.config.port}/mcp`);
    console.log(`  可用工具: ${tools.map(t => `${t}.*`).join(', ')}`);
    console.log('');
  }

  private registerShutdownHooks(): void {
    const shutdown = async () => {
      this.logger.info('[Shutdown] Stopping...');

      // 停止 Channels
      for (const channel of this.channels.values()) {
        await channel.lifecycle.stop();
      }

      // 停止 MCP HTTP
      await this.mcpHttpServer?.stop();

      // 停止 Gateway
      await this.gateway?.shutdown();

      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('uncaughtException', (err) => this.logger.error('[Error]', err));
    process.on('unhandledRejection', (reason) => this.logger.error('[Error]', reason));
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createApp(config: AppConfig, logger: Logger): App {
  return new App(config, logger);
}