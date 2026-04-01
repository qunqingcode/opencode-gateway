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
import { ToolRegistry, createAllTools } from './src/tools';
import { FeishuChannel } from './src/channels';

// ============================================================
// 启动
// ============================================================

async function main() {
  const config = loadConfigFromEnv();
  logger.info('[Startup] Loading configuration...');

  // 创建工具注册表
  const toolRegistry = new ToolRegistry(logger);

  // 创建并注册所有工具
  const { tools, cronStore } = await createAllTools({
    dataDir: config.dataDir,
    ...config.tools,
    mcpServers: config.mcpServers,
  }, logger);

  toolRegistry.registerAll(tools);

  // 输出工具统计
  const publicTools = toolRegistry.listPublic();
  const internalTools = tools.length - publicTools.length;
  logger.info(`[Startup] Registered ${publicTools.length} public tools, ${internalTools} internal tools`);

  // 创建 Gateway（传入 cronStore，Gateway 会自动创建和启动 scheduler）
  const gateway = new Gateway({
    agent: config.agent,
    dataDir: config.dataDir,
  }, logger, toolRegistry, cronStore);

  // 初始化 Gateway
  await gateway.init();

  // 注册飞书渠道
  if (config.channels.feishu?.enabled) {
    const feishu = new FeishuChannel({
      id: 'feishu',
      appId: config.channels.feishu.appId,
      appSecret: config.channels.feishu.appSecret,
      connectionMode: config.channels.feishu.connectionMode,
      domain: config.channels.feishu.domain,
      webhookPort: config.channels.feishu.webhookPort,
    }, logger);

    // 先注册再连接（registerChannel 会注册 onInteraction 处理器）
    gateway.registerChannel(feishu);
    await feishu.connect();
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

  // 全局 unhandled rejection 监听器（防止进程崩溃）
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('[UnhandledRejection] Unhandled promise rejection:', reason);
    logger.error('[UnhandledRejection] Promise:', promise);
    // 不退出进程，让网关继续运行
  });

  // 全局 uncaught exception 监听器（防止进程崩溃）
  process.on('uncaughtException', (error) => {
    logger.error('[UncaughtException] Uncaught exception:', error);
    // 不退出进程，让网关继续运行
  });
}

main().catch((err) => {
  logger.error('[Startup] Failed:', err);
  process.exit(1);
});