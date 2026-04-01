/**
 * 工具层导出
 * 
 * 统一入口，提供工具类型、注册表、工厂函数
 */

import type { Logger } from '../types';
import type { ITool } from './types';
import { createGitLabTools } from './gitlab';
import { createZentaoTools } from './zentao';
import { createWorkflowTools } from './workflow';
import { createFeishuTools } from './feishu';
import { createCronTools, CronStore } from './cron';
import { createMCPProxyTools, MCPProxyTool } from './mcp-proxy';

// 类型
export type {
  ToolContext,
  ToolDefinition,
  ToolResult,
  ITool,
  JSONSchema,
  ToolBuilderOptions,
} from './types';

// Cron 相关导出
export { CronStore } from './cron';
export type { CronJob } from './cron';

// 基类
export { BaseTool } from './base';

// 工厂函数
export { createTool } from './types';

// 注册表
export { ToolRegistry } from './registry';

// ============================================================
// 配置类型
// ============================================================

export interface ToolsConfig {
  /** 数据目录 */
  dataDir: string;
  /** GitLab 配置 */
  gitlab?: {
    enabled: boolean;
    baseUrl: string;
    token: string;
    projectId: string | number;
  };
  /** 禅道配置 */
  zentao?: {
    enabled: boolean;
    baseUrl: string;
    token?: string;
    account?: string;
    password?: string;
    projectId?: string | number;
  };
  /** Workflow 配置 */
  workflow?: {
    enabled: boolean;
  };
  /** 第三方 MCP Server 配置 */
  mcpServers?: {
    [name: string]: {
      enabled: boolean;
      command: string[] | (() => string[]);
      description?: string;
      env?: Record<string, string>;
      cwd?: string;
    };
  };
}

// ============================================================
// 创建工具结果
// ============================================================

/**
 * 创建所有工具的结果
 */
export interface CreateAllToolsResult {
  tools: ITool[];
  /** Cron Store（供 Gateway 创建 scheduler） */
  cronStore?: CronStore;
}

// ============================================================
// 统一工具工厂
// ============================================================

/**
 * 创建所有工具
 * 
 * 根据配置自动创建所有启用的工具
 */
export async function createAllTools(
  config: ToolsConfig,
  logger: Logger
): Promise<CreateAllToolsResult> {
  const tools: ITool[] = [];
  let cronStore: CronStore | undefined;

  // 1. 飞书工具（始终启用）
  tools.push(...createFeishuTools(logger));

  // 2. Cron 工具（始终启用）
  const cronResult = createCronTools({
    dataDir: config.dataDir,
    defaultLanguage: 'zh',
  }, logger);
  
  tools.push(...cronResult.tools);
  cronStore = cronResult.store;

  // 3. GitLab 工具
  if (config.gitlab?.enabled) {
    tools.push(...createGitLabTools(config.gitlab, logger));
  }

  // 4. 禅道工具
  if (config.zentao?.enabled) {
    tools.push(...await createZentaoTools(config.zentao, logger));
  }

  // 5. Workflow 工具（需要 GitLab + 禅道）
  if (config.workflow?.enabled && config.gitlab && config.zentao) {
    tools.push(...await createWorkflowTools({
      gitlab: config.gitlab,
      zentao: config.zentao,
    }, logger));
  }

  // 6. 第三方 MCP Server 工具（动态发现，每个工具独立）
  if (config.mcpServers) {
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      if (serverConfig.enabled) {
        const mcpTools = await createMCPProxyTools({
          name,
          command: serverConfig.command,
          description: serverConfig.description,
          env: serverConfig.env,
          cwd: serverConfig.cwd,
        }, logger);
        tools.push(...mcpTools);
        logger.info(`[Tools] MCP Server '${name}': ${mcpTools.length} tools discovered`);
      }
    }
  }

  return { tools, cronStore };
}