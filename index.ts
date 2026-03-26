/**
 * 应用入口 - 声明式配置
 * 
 * 所有组件通过配置声明，自动注册和启动
 */

require('dotenv').config();

import { createApp } from './src/app';
import { appLogger as logger } from './src/utils/logger';

// ============================================================
// 声明式配置
// ============================================================

const app = createApp({
  // 服务端口
  port: parseInt(process.env.MCP_HTTP_PORT || '3100'),
  
  // OpenCode 配置
  opencode: {
    url: process.env.OPENCODE_API_URL || 'http://127.0.0.1:4096',
    timeout: parseInt(process.env.OPENCODE_TIMEOUT || '600000'),
    modelId: process.env.OPENCODE_MODEL_ID,
    providerId: process.env.OPENCODE_PROVIDER_ID,
  },
  
  // Channel 配置（IM 通信）
  channels: {
    feishu: {
      enabled: !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET),
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET,
      connectionMode: process.env.FEISHU_CONNECTION_MODE as 'websocket' | 'webhook' || 'websocket',
      domain: process.env.FEISHU_DOMAIN as 'feishu' | 'lark' || 'feishu',
    },
  },
  
  // MCP Server 配置
  mcpServers: {
    // 内置 MCP Server
    zentao: {
      enabled: !!(process.env.ZENTAO_BASE_URL),
      baseUrl: process.env.ZENTAO_BASE_URL,
      token: process.env.ZENTAO_TOKEN,
      account: process.env.ZENTAO_ACCOUNT,
      password: process.env.ZENTAO_PASSWORD,
      projectId: process.env.ZENTAO_PROJECT_ID,
    },
    
    gitlab: {
      enabled: !!(process.env.GITLAB_URL && process.env.GITLAB_TOKEN),
      baseUrl: process.env.GITLAB_URL,
      token: process.env.GITLAB_TOKEN,
      projectId: process.env.GITLAB_PROJECT_ID,
    },
    
    workflow: {
      // 自动检测：GitLab + 禅道都配置时启用
      enabled: !!(process.env.GITLAB_URL && process.env.GITLAB_TOKEN && process.env.ZENTAO_BASE_URL),
      gitlab: {
        baseUrl: process.env.GITLAB_URL,
        token: process.env.GITLAB_TOKEN,
        projectId: process.env.GITLAB_PROJECT_ID,
      },
      zentao: {
        baseUrl: process.env.ZENTAO_BASE_URL,
        token: process.env.ZENTAO_TOKEN,
        account: process.env.ZENTAO_ACCOUNT,
        password: process.env.ZENTAO_PASSWORD,
        projectId: process.env.ZENTAO_PROJECT_ID,
      },
    },
    
    // 第三方 MCP Server（通过 Stdio 代理）
    lark: {
      enabled: !!(process.env.LARK_MCP_APP_ID && process.env.LARK_MCP_APP_SECRET),
      type: 'stdio',
      command: () => {
        const appId = process.env.LARK_MCP_APP_ID!;
        const appSecret = process.env.LARK_MCP_APP_SECRET!;
        return ['npx', '-y', '@larksuiteoapi/lark-mcp', 'mcp', '-a', appId, '-s', appSecret];
      },
    },
    
    // 消息发送工具（通用，始终启用）
    message: {
      enabled: true,
    },
  },
}, logger);

// ============================================================
// 启动
// ============================================================

app.start().catch((err) => {
  logger.error('[Startup] Failed:', err);
  process.exit(1);
});