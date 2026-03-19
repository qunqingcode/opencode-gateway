/**
 * 配置管理模块
 * 
 * 支持多 Provider 配置
 */

require('dotenv').config();

import { GatewayConfig, ProviderConfig, ProviderType } from './core/types';

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_QUEUE_CONFIG = {
  maxCacheSize: 1000,
};

// ============================================================
// 环境变量解析
// ============================================================

function getEnvString(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

// ============================================================
// 构建 Provider 配置
// ============================================================

function buildProviderConfigs(): Record<string, ProviderConfig> {
  const providers: Record<string, ProviderConfig> = {};

  // 飞书配置
  const feishuAppId = getEnvString('FEISHU_APP_ID');
  const feishuAppSecret = getEnvString('FEISHU_APP_SECRET');
  if (feishuAppId && feishuAppSecret) {
    providers['feishu'] = {
      id: 'feishu',
      type: 'messenger',
      enabled: true,
      name: getEnvString('FEISHU_NAME', 'Feishu'),
      capabilities: ['messaging', 'media', 'notification'],
      // 扩展配置
      appId: feishuAppId,
      appSecret: feishuAppSecret,
      connectionMode: getEnvString('FEISHU_CONNECTION_MODE', 'websocket') as 'websocket' | 'webhook',
      domain: getEnvString('FEISHU_DOMAIN', 'feishu') as 'feishu' | 'lark',
      webhookPort: getEnvNumber('FEISHU_WEBHOOK_PORT', 3000),
      webhookPath: getEnvString('FEISHU_WEBHOOK_PATH', '/feishu/events'),
    } as ProviderConfig & Record<string, unknown>;
  }

  // GitLab 配置
  const gitlabToken = getEnvString('GITLAB_TOKEN');
  const gitlabProjectId = getEnvString('GITLAB_PROJECT_ID');
  if (gitlabToken && gitlabProjectId) {
    providers['gitlab'] = {
      id: 'gitlab',
      type: 'vcs',
      enabled: true,
      name: getEnvString('GITLAB_NAME', 'GitLab'),
      capabilities: ['repository'],
      apiUrl: getEnvString('GITLAB_API_URL', 'https://gitlab.com/api/v4'),
      token: gitlabToken,
      projectId: gitlabProjectId,
    } as ProviderConfig & Record<string, unknown>;
  }

  // 禅道配置（预留）
  const zentaoToken = getEnvString('ZENTAO_TOKEN');
  const zentaoBaseUrl = getEnvString('ZENTAO_BASE_URL');
  if (zentaoToken && zentaoBaseUrl) {
    providers['zentao'] = {
      id: 'zentao',
      type: 'issue',
      enabled: true,
      name: getEnvString('ZENTAO_NAME', 'Zentao'),
      capabilities: ['issues', 'project'],
      baseUrl: zentaoBaseUrl,
      token: zentaoToken,
      projectId: getEnvString('ZENTAO_PROJECT_ID'),
    } as ProviderConfig & Record<string, unknown>;
  }

  return providers;
}

// ============================================================
// 构建全局配置
// ============================================================

export function buildConfig(): GatewayConfig {
  return {
    providers: buildProviderConfigs(),
    opencode: {
      url: getEnvString('OPENCODE_API_URL', 'http://127.0.0.1:4096') || 'http://127.0.0.1:4096',
      timeout: getEnvNumber('OPENCODE_TIMEOUT', 600000),
      modelId: getEnvString('OPENCODE_MODEL_ID'),
      providerId: getEnvString('OPENCODE_PROVIDER_ID'),
    },
    queue: DEFAULT_QUEUE_CONFIG,
  };
}

// ============================================================
// 配置导出
// ============================================================

export const CONFIG = buildConfig();

// ============================================================
// 配置验证
// ============================================================

export function validateConfig(): void {
  const errors: string[] = [];

  // 检查是否有启用的 Provider
  const enabledProviders = Object.values(CONFIG.providers).filter(p => p.enabled);
  if (enabledProviders.length === 0) {
    errors.push('No enabled providers found');
  }

  // 检查飞书配置
  const feishu = CONFIG.providers['feishu'];
  if (feishu?.enabled) {
    const feishuConfig = feishu as unknown as Record<string, unknown>;
    if (!feishuConfig.appId) {
      errors.push('FEISHU_APP_ID is required when Feishu is enabled');
    }
    if (!feishuConfig.appSecret) {
      errors.push('FEISHU_APP_SECRET is required when Feishu is enabled');
    }
  }

  if (errors.length > 0) {
    console.error('❌ Configuration errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
}

// ============================================================
// 获取启用的 Provider
// ============================================================

export function getEnabledProviders(): ProviderConfig[] {
  return Object.values(CONFIG.providers).filter(p => p.enabled);
}

export function getProvidersByType(type: ProviderType): ProviderConfig[] {
  return Object.values(CONFIG.providers).filter(p => p.enabled && p.type === type);
}