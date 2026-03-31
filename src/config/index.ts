/**
 * 配置类型和加载
 */

// ============================================================
// 配置类型
// ============================================================

export interface AppConfig {
  /** 运行模式 */
  mode: 'mcp' | 'cli';

  /** 数据目录 */
  dataDir: string;

  /** Agent 配置 */
  agent: {
    url: string;
    timeout: number;
    modelId?: string;
    providerId?: string;
    progress?: {
      enabled: boolean;
      showToolStatus: boolean;
      showTextOutput: boolean;
    };
  };

  /** MCP Server 配置 */
  mcp?: {
    port: number;
    host: string;
  };

  /** 渠道配置 */
  channels: {
    feishu?: {
      enabled: boolean;
      appId: string;
      appSecret: string;
      connectionMode: 'websocket' | 'webhook';
      domain: 'feishu' | 'lark';
      webhookPort?: number;
    };
  };

  /** 工具配置 */
  tools: {
    gitlab?: {
      enabled: boolean;
      baseUrl: string;
      token: string;
      projectId: string | number;
    };
    zentao?: {
      enabled: boolean;
      baseUrl: string;
      token?: string;
      account?: string;
      password?: string;
      projectId?: string | number;
    };
    workflow?: {
      enabled: boolean;
    };
  };

  /** 第三方 MCP Server 配置 */
  mcpServers?: {
    [name: string]: {
      enabled: boolean;
      /** 命令（支持静态数组或动态函数） */
      command: string[] | (() => string[]);
      description?: string;
      env?: Record<string, string>;
      cwd?: string;
    };
  };
}

// ============================================================
// 配置加载
// ============================================================

/**
 * 从环境变量加载配置
 */
export function loadConfigFromEnv(): AppConfig {
  return {
    mode: (process.env.MODE as 'mcp' | 'cli') || 'mcp',
    dataDir: process.env.DATA_DIR || './data',

    agent: {
      url: process.env.OPENCODE_API_URL || 'http://127.0.0.1:4096',
      timeout: parseInt(process.env.OPENCODE_TIMEOUT || '600000'),
      modelId: process.env.OPENCODE_MODEL_ID,
      providerId: process.env.OPENCODE_PROVIDER_ID,
      progress: {
        enabled: process.env.PROGRESS_ENABLED !== 'false',
        showToolStatus: process.env.PROGRESS_TOOL_STATUS === 'true',
        showTextOutput: process.env.PROGRESS_TEXT_OUTPUT === 'true',
      },
    },

    mcp: {
      port: parseInt(process.env.MCP_HTTP_PORT || '3100'),
      host: process.env.MCP_HOST || 'localhost',
    },

    channels: {
      feishu: {
        enabled: !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET),
        appId: process.env.FEISHU_APP_ID || '',
        appSecret: process.env.FEISHU_APP_SECRET || '',
        connectionMode: (process.env.FEISHU_CONNECTION_MODE as 'websocket' | 'webhook') || 'websocket',
        domain: (process.env.FEISHU_DOMAIN as 'feishu' | 'lark') || 'feishu',
        webhookPort: process.env.FEISHU_WEBHOOK_PORT ? parseInt(process.env.FEISHU_WEBHOOK_PORT) : undefined,
      },
    },

    tools: {
      gitlab: {
        enabled: !!(process.env.GITLAB_URL && process.env.GITLAB_TOKEN),
        baseUrl: process.env.GITLAB_URL || '',
        token: process.env.GITLAB_TOKEN || '',
        projectId: process.env.GITLAB_PROJECT_ID || '',
      },
      zentao: {
        enabled: !!process.env.ZENTAO_BASE_URL,
        baseUrl: process.env.ZENTAO_BASE_URL || '',
        token: process.env.ZENTAO_TOKEN,
        account: process.env.ZENTAO_ACCOUNT,
        password: process.env.ZENTAO_PASSWORD,
        projectId: process.env.ZENTAO_PROJECT_ID,
      },
      workflow: {
        enabled: !!(process.env.GITLAB_URL && process.env.GITLAB_TOKEN && process.env.ZENTAO_BASE_URL),
      },
    },

    // 第三方 MCP Servers
    mcpServers: loadMCPServersFromEnv(),
  };
}

// ============================================================
// MCP Servers 配置加载
// ============================================================

/**
 * 从环境变量加载 MCP Server 配置
 */
function loadMCPServersFromEnv(): AppConfig['mcpServers'] {
  const mcpServers: AppConfig['mcpServers'] = {};

  // 飞书官方 MCP Server
  if (process.env.LARK_MCP_APP_ID && process.env.LARK_MCP_APP_SECRET) {
    mcpServers['lark'] = {
      enabled: true,
      command: () => [
        'npx', '-y', '@larksuiteoapi/lark-mcp', 'mcp',
        '-a', process.env.LARK_MCP_APP_ID!,
        '-s', process.env.LARK_MCP_APP_SECRET!,
      ],
      description: '飞书官方 MCP：文档、多维表格、消息等',
    };
  }

  // GitHub MCP Server
  if (process.env.GITHUB_TOKEN) {
    mcpServers['github'] = {
      enabled: process.env.GITHUB_MCP_ENABLED === 'true',
      command: () => ['npx', '-y', '@modelcontextprotocol/server-github'],
      description: 'GitHub MCP：仓库、Issue、PR 操作',
    };
  }

  // GitLab MCP Server
  if (process.env.GITLAB_URL && process.env.GITLAB_TOKEN) {
    mcpServers['gitlab_mcp'] = {
      enabled: process.env.GITLAB_MCP_ENABLED === 'true',
      command: () => ['npx', '-y', '@modelcontextprotocol/server-gitlab'],
      description: 'GitLab MCP：仓库、Issue、MR 操作',
    };
  }

  // PostgreSQL MCP Server
  if (process.env.DATABASE_URL) {
    mcpServers['postgres'] = {
      enabled: process.env.POSTGRES_MCP_ENABLED === 'true',
      command: () => ['npx', '-y', '@modelcontextprotocol/server-postgres', process.env.DATABASE_URL!],
      description: 'PostgreSQL MCP：数据库查询',
    };
  }

  // Filesystem MCP Server
  if (process.env.FILESYSTEM_MCP_PATH) {
    mcpServers['filesystem'] = {
      enabled: process.env.FILESYSTEM_MCP_ENABLED === 'true',
      command: () => ['npx', '-y', '@modelcontextprotocol/server-filesystem', process.env.FILESYSTEM_MCP_PATH!],
      description: '文件系统 MCP：读写文件',
    };
  }

  // 自定义 MCP Server（JSON 格式）
  if (process.env.CUSTOM_MCP_SERVERS) {
    try {
      const customServers = JSON.parse(process.env.CUSTOM_MCP_SERVERS);
      for (const [name, config] of Object.entries(customServers)) {
        mcpServers[name] = config as AppConfig['mcpServers'] extends Record<string, infer U> ? U : never;
      }
    } catch (e) {
      console.warn('Failed to parse CUSTOM_MCP_SERVERS:', e);
    }
  }

  return mcpServers;
}