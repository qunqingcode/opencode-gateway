/**
 * OpenCode Gateway 主入口 (新架构)
 * 
 * 三层架构：
 * - Layer 1: Channels - 渠道适配层 (飞书、钉钉等)
 * - Layer 2: Gateway - 网关核心层 (Session、MCP客户端)
 * - Layer 3: MCP Servers - 原子能力层 (禅道、GitLab等)
 * 
 * MCP 暴露方式：
 * - 统一 HTTP 服务，端口 3100
 * - OpenCode 配置为 Remote MCP 连接到此服务
 */

import { CONFIG, validateConfig } from './src/config';
import { appLogger as logger } from './src/utils/logger';

// Layer 1: Channels
import { createChannel, getRegisteredChannelTypes } from './src/channels';
import type { ChannelPlugin } from './src/channels/types';
import type { FeishuChannelConfig } from './src/channels/feishu';

// Layer 2: Gateway
import { createGateway, UnifiedMCPHTTPServer } from './src/gateway';
import type { GatewayConfig } from './src/gateway/types';

// Layer 3: MCP Servers
import { createMCPServer, getRegisteredServerTypes } from './src/mcp-servers';

// ============================================================
// 配置
// ============================================================

/** MCP HTTP 服务端口 */
const MCP_HTTP_PORT = parseInt(process.env.MCP_HTTP_PORT || '3100');

/** 从环境变量获取配置 */
function getGatewayConfig(): GatewayConfig {
  return {
    opencode: {
      url: CONFIG.opencode.url,
      timeout: CONFIG.opencode.timeout || 600000,
      modelId: CONFIG.opencode.modelId,
      providerId: CONFIG.opencode.providerId,
    },
    mcpServers: [],
  };
}

/** 获取飞书 Channel 配置 */
function getFeishuChannelConfig(): FeishuChannelConfig | null {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    return null;
  }

  return {
    id: 'feishu',
    type: 'feishu',
    enabled: true,
    name: process.env.FEISHU_BOT_NAME || 'OpenCode Bot',
    appId,
    appSecret,
    connectionMode: (process.env.FEISHU_CONNECTION_MODE as 'websocket' | 'webhook') || 'websocket',
    domain: (process.env.FEISHU_DOMAIN as 'feishu' | 'lark') || 'feishu',
    webhookPort: process.env.FEISHU_WEBHOOK_PORT ? parseInt(process.env.FEISHU_WEBHOOK_PORT) : undefined,
    webhookPath: process.env.FEISHU_WEBHOOK_PATH,
    encryptKey: process.env.FEISHU_ENCRYPT_KEY,
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
    thinkingThresholdMs: process.env.FEISHU_THINKING_THRESHOLD_MS 
      ? parseInt(process.env.FEISHU_THINKING_THRESHOLD_MS) 
      : undefined,
    botNames: process.env.FEISHU_BOT_NAMES?.split(','),
  };
}

/** 获取禅道 MCP Server 配置 */
function getZentaoMCPConfig() {
  const baseUrl = process.env.ZENTAO_BASE_URL;
  if (!baseUrl) return null;

  return {
    name: 'zentao',
    enabled: true,
    baseUrl,
    token: process.env.ZENTAO_TOKEN,
    account: process.env.ZENTAO_ACCOUNT,
    password: process.env.ZENTAO_PASSWORD,
    projectId: process.env.ZENTAO_PROJECT_ID,
  };
}

/** 获取 GitLab MCP Server 配置 */
function getGitLabMCPConfig() {
  const baseUrl = process.env.GITLAB_URL;
  const token = process.env.GITLAB_TOKEN;
  const projectId = process.env.GITLAB_PROJECT_ID;

  if (!baseUrl || !token || !projectId) return null;

  return {
    name: 'gitlab',
    enabled: true,
    baseUrl,
    token,
    projectId,
  };
}

/** 获取 Workflow MCP Server 配置（需要 GitLab + 禅道同时配置） */
function getWorkflowMCPConfig() {
  const gitlabUrl = process.env.GITLAB_URL;
  const gitlabToken = process.env.GITLAB_TOKEN;
  const gitlabProjectId = process.env.GITLAB_PROJECT_ID;
  const zentaoUrl = process.env.ZENTAO_BASE_URL;

  // 需要 GitLab 和禅道都配置才启用 workflow
  if (!gitlabUrl || !gitlabToken || !gitlabProjectId || !zentaoUrl) {
    return null;
  }

  return {
    name: 'workflow',
    enabled: true,
    gitlab: {
      baseUrl: gitlabUrl,
      token: gitlabToken,
      projectId: gitlabProjectId,
    },
    zentao: {
      baseUrl: zentaoUrl,
      token: process.env.ZENTAO_TOKEN,
      account: process.env.ZENTAO_ACCOUNT,
      password: process.env.ZENTAO_PASSWORD,
      projectId: process.env.ZENTAO_PROJECT_ID,
    },
  };
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  validateConfig();

  logger.info('========================================');
  logger.info('  OpenCode Gateway v3.0');
  logger.info('  三层架构: Channels → Gateway → MCP');
  logger.info('========================================');

  // 1. 创建 Gateway
  const gatewayConfig = getGatewayConfig();
  const gateway = createGateway(gatewayConfig, logger);

  // 2. 注册 MCP Servers (Layer 3)
  logger.info('[Startup] Registering MCP Servers...');
  const mcpClient = gateway.getMCPClient();

  const zentaoConfig = getZentaoMCPConfig();
  if (zentaoConfig) {
    const zentaoServer = createMCPServer('zentao', zentaoConfig as Record<string, unknown>, logger);
    if (zentaoServer) {
      mcpClient.registerServer('zentao', zentaoServer);
    }
  }

  const gitlabConfig = getGitLabMCPConfig();
  if (gitlabConfig) {
    const gitlabServer = createMCPServer('gitlab', gitlabConfig as Record<string, unknown>, logger);
    if (gitlabServer) {
      mcpClient.registerServer('gitlab', gitlabServer);
    }
  }

  // Workflow MCP Server（需要 GitLab + 禅道配置）
  const workflowConfig = getWorkflowMCPConfig();
  if (workflowConfig) {
    const workflowServer = createMCPServer('workflow', workflowConfig as Record<string, unknown>, logger);
    if (workflowServer) {
      mcpClient.registerServer('workflow', workflowServer);
      logger.info('[Startup] Workflow MCP Server enabled (GitLab + Zentao)');
    }
  }

  const registeredServers = getRegisteredServerTypes();
  logger.info(`[Startup] MCP Servers: ${registeredServers.join(', ') || 'none'}`);

  // 3. 初始化 Gateway
  logger.info('[Startup] Initializing Gateway...');
  await gateway.init();

  // 4. 启动统一 MCP HTTP 服务
  logger.info('[Startup] Starting unified MCP HTTP server...');
  const mcpHttpServer = new UnifiedMCPHTTPServer(mcpClient, logger, MCP_HTTP_PORT);
  mcpHttpServer.setGateway(gateway);  // 设置 Gateway，用于获取活跃上下文
  await mcpHttpServer.start();

  // 5. 注册 Channels (Layer 1)
  logger.info('[Startup] Registering Channels...');
  const feishuConfig = getFeishuChannelConfig();
  let feishuChannel: ChannelPlugin | null = null;

  if (feishuConfig) {
    feishuChannel = createChannel(feishuConfig, logger);
    if (feishuChannel) {
      gateway.registerChannel(feishuChannel);
      logger.info('[Startup] Feishu channel registered');
    }
  }

  logger.info(`[Startup] Channels: ${getRegisteredChannelTypes().join(', ') || 'none'}`);

  // 6. 启动 Channel
  if (feishuChannel) {
    logger.info('[Startup] Starting Feishu channel...');
    await feishuChannel.lifecycle.start();
    
    // 健康检查
    const health = await feishuChannel.lifecycle.healthCheck();
    const status = health.healthy ? 'OK' : 'FAIL';
    logger.info(`  [${status}] feishu: ${health.message}`);
    
    // 将 Channel 设置给 MCP HTTP Server，使工具能发送消息
    mcpHttpServer.setChannel(feishuChannel);
  }

  // 7. 打印工具信息
  const tools = await mcpClient.discoverTools();
  logger.info(`[Startup] Available MCP tools: ${tools.length}`);
  
  if (tools.length > 0) {
    tools.slice(0, 8).forEach(tool => {
      logger.info(`  - ${tool.name}: ${tool.description.slice(0, 40)}...`);
    });
    if (tools.length > 8) {
      logger.info(`  ... and ${tools.length - 8} more`);
    }
  }

  // 8. 打印 OpenCode 配置指南
  printOpenCodeConfig(mcpHttpServer.getUrl(), registeredServers);

  // 9. 优雅关闭
  const shutdown = async () => {
    logger.info('[Shutdown] Stopping...');
    
    if (feishuChannel) {
      await feishuChannel.lifecycle.stop();
    }
    
    await mcpHttpServer.stop();
    await gateway.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => logger.error('[Error] Uncaught:', err));
  process.on('unhandledRejection', (reason) => logger.error('[Error] Unhandled:', reason));

  logger.info('[Startup] Gateway is running. Press Ctrl+C to stop.');
}

/**
 * 打印 OpenCode 配置指南
 */
function printOpenCodeConfig(mcpUrl: string, servers: string[]) {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              OpenCode MCP 配置指南                              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('将以下配置添加到 OpenCode 配置文件:');
  console.log('');
  console.log('  Windows: %USERPROFILE%\\.config\\opencode\\opencode.json');
  console.log('  macOS/Linux: ~/.config/opencode/opencode.json');
  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────┐');
  console.log('│ {                                                               │');
  console.log('│   "$schema": "https://opencode.ai/config.json",                 │');
  console.log('│   "mcp": {                                                      │');
  console.log('│     "opencode-gateway": {                                       │');
  console.log('│       "type": "remote",                                         │');
  console.log(`│       "url": "${mcpUrl}",                    │`);
  console.log('│       "enabled": true                                           │');
  console.log('│     }                                                           │');
  console.log('│   }                                                             │');
  console.log('│ }                                                               │');
  console.log('└─────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('可用工具:');
  servers.forEach(server => {
    console.log(`  - ${server}.* (如: ${server}.get_bug, ${server}.create_mr)`);
  });
  console.log('');
  console.log('验证工具:');
  console.log('  opencode mcp list');
  console.log('');
}

// ============================================================
// 启动
// ============================================================

main().catch((err) => {
  logger.error('[Startup] Failed:', err);
  process.exit(1);
});