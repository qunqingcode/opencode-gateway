/**
 * OpenCode Gateway - 入口
 * 
 * 六层架构：
 * callers/ → gateway/ → agents/ + tools/ → channels/ + clients/
 * 
 * 启动模式：
 * - npm start: 启动 MCP Server + Feishu Channel
 * - gateway <cmd>: CLI 调用正在运行的 MCP Server
 */

require('dotenv').config();

import { appLogger as logger } from './src/utils/logger';
import { loadConfigFromEnv } from './src/config';
import { Gateway } from './src/gateway';
import { MCPHTTPServer } from './src/callers';
import { ToolRegistry, GitLabTool, ZentaoTool, WorkflowTool, FeishuTool, CronTool, MCPProxyTool } from './src/tools';
import { FeishuClient } from './src/channels/feishu';

// ============================================================
// 启动
// ============================================================

async function main() {
  const config = loadConfigFromEnv();
  logger.info('[Startup] Loading configuration...');

  // 创建工具注册表
  const toolRegistry = new ToolRegistry(logger);

  // 注册飞书消息发送工具（始终启用）
  toolRegistry.register(new FeishuTool(logger));

  // 注册 Cron 定时任务工具（始终启用）
  toolRegistry.register(new CronTool({
    dataDir: config.dataDir,
    defaultLanguage: 'zh',
  }, logger));

  // 注册 GitLab 工具
  if (config.tools.gitlab?.enabled) {
    toolRegistry.register(new GitLabTool(config.tools.gitlab, logger));
  }

  // 注册禅道工具
  if (config.tools.zentao?.enabled) {
    toolRegistry.register(new ZentaoTool(config.tools.zentao, logger));
  }

  // 注册 Workflow 工具（需要 GitLab + 禅道）
  if (config.tools.workflow?.enabled && config.tools.gitlab && config.tools.zentao) {
    toolRegistry.register(new WorkflowTool({
      gitlab: config.tools.gitlab,
      zentao: config.tools.zentao,
    }, logger));
  }

  // 注册第三方 MCP Server 工具
  if (config.mcpServers) {
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      if (serverConfig.enabled) {
        const mcpTool = new MCPProxyTool({
          name,
          command: serverConfig.command,
          description: serverConfig.description,
          env: serverConfig.env,
          cwd: serverConfig.cwd,
        }, logger);

        toolRegistry.register(mcpTool);
        logger.info(`[Startup] Registered MCP Server: ${name}`);
      }
    }
  }

  // 创建 Gateway
  const gateway = new Gateway({
    agent: config.agent,
    dataDir: config.dataDir,
  }, logger, toolRegistry);

  // 初始化 Gateway
  await gateway.init();

  // 注册飞书渠道
  if (config.channels.feishu?.enabled) {
    const feishu = new FeishuClient({
      id: 'feishu',
      appId: config.channels.feishu.appId,
      appSecret: config.channels.feishu.appSecret,
      connectionMode: config.channels.feishu.connectionMode,
      domain: config.channels.feishu.domain,
      webhookPort: config.channels.feishu.webhookPort,
    }, logger);

    await feishu.connect();
    gateway.registerChannel(feishu);
  }

  // 启动 MCP HTTP Server
  const mcpServer = new MCPHTTPServer(toolRegistry, {
    port: config.mcp?.port || 3100,
    host: config.mcp?.host || 'localhost',
  }, logger);

  await mcpServer.start();

  // 优雅关闭
  const shutdown = async () => {
    logger.info('[Shutdown] Graceful shutdown...');
    await gateway.shutdown();
    await mcpServer.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('[Startup] Failed:', err);
  process.exit(1);
});