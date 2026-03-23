/**
 * 配置管理模块
 */

require('dotenv').config();

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
// OpenCode 配置
// ============================================================

export interface OpenCodeConfig {
  url: string;
  timeout: number;
  modelId?: string;
  providerId?: string;
  progress?: {
    enabled?: boolean;
    showToolStatus?: boolean;
    showTextOutput?: boolean;
  };
}

export const CONFIG = {
  opencode: {
    url: getEnvString('OPENCODE_API_URL', 'http://127.0.0.1:4096') || 'http://127.0.0.1:4096',
    timeout: getEnvNumber('OPENCODE_TIMEOUT', 600000),
    modelId: getEnvString('OPENCODE_MODEL_ID'),
    providerId: getEnvString('OPENCODE_PROVIDER_ID'),
    progress: {
      enabled: getEnvString('OPENCODE_PROGRESS_ENABLED', 'false') === 'true',
      showToolStatus: getEnvString('OPENCODE_PROGRESS_TOOL_STATUS', 'false') === 'true',
      showTextOutput: getEnvString('OPENCODE_PROGRESS_TEXT_OUTPUT', 'false') === 'true',
    },
  },
};

// ============================================================
// 配置验证
// ============================================================

export function validateConfig(): void {
  const errors: string[] = [];

  // 检查飞书配置
  const feishuAppId = process.env.FEISHU_APP_ID;
  const feishuAppSecret = process.env.FEISHU_APP_SECRET;
  if (!feishuAppId) {
    errors.push('FEISHU_APP_ID is required');
  }
  if (!feishuAppSecret) {
    errors.push('FEISHU_APP_SECRET is required');
  }

  if (errors.length > 0) {
    console.error('❌ Configuration errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
}