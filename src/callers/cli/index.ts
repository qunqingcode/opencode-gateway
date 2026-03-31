/**
 * CLI 调用入口
 */

import type { Logger } from '../../types';
import type { ToolRegistry, ToolContext } from '../../tools';

// ============================================================
// CLI 配置
// ============================================================

export interface CLIConfig {
  dataDir?: string;
}

// ============================================================
// CLI 入口
// ============================================================

export class CLI {
  private toolRegistry: ToolRegistry;
  private logger: Logger;

  constructor(toolRegistry: ToolRegistry, logger: Logger) {
    this.toolRegistry = toolRegistry;
    this.logger = logger;
  }

  /**
   * 运行 CLI
   * @returns 退出码 (0=成功, 1=错误)
   */
  async run(args: string[]): Promise<number> {
    if (args.length === 0) {
      this.printHelp();
      return 0;
    }

    const [toolName, ...toolArgs] = args;

    if (toolName === 'list') {
      this.listTools();
      return 0;
    }

    if (toolName === 'help') {
      this.printHelp();
      return 0;
    }

    // 执行工具
    return this.executeTool(toolName, this.parseArgs(toolArgs));
  }

  /**
   * 执行工具
   */
  private async executeTool(name: string, args: Record<string, unknown>): Promise<number> {
    const context: ToolContext = {
      chatId: 'cli',
      userId: process.env.USER || 'cli-user',
      sessionId: 'cli-session',
      sendText: async (text: string) => console.log(text),
      sendCard: async (card: unknown) => console.log(JSON.stringify(card, null, 2)),
      logger: this.logger,
    };

    try {
      const result = await this.toolRegistry.execute(name, args, context);

      if (result.success) {
        console.log('\n✅ Success:');
        console.log(JSON.stringify(result.output, null, 2));
        return 0;
      } else {
        console.error('\n❌ Error:', result.error);
        return 1;
      }
    } catch (error) {
      console.error('\n❌ Error:', (error as Error).message);
      return 1;
    }
  }

  /**
   * 解析参数
   */
  private parseArgs(args: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--')) {
        const key = arg.slice(2);
        const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
        result[key] = value;
        if (value !== true) i++;
      }
    }

    return result;
  }

  /**
   * 列出工具
   */
  private listTools(): void {
    console.log('\n可用工具:\n');
    const tools = this.toolRegistry.listPublic();
    
    // 按命名空间分组
    const groups = new Map<string, typeof tools>();
    for (const tool of tools) {
      const [namespace] = tool.name.split('.');
      if (!groups.has(namespace)) {
        groups.set(namespace, []);
      }
      groups.get(namespace)!.push(tool);
    }

    // 输出
    for (const [namespace, groupTools] of groups) {
      console.log(`[${namespace}]`);
      for (const tool of groupTools) {
        const shortName = tool.name.replace(`${namespace}.`, '');
        console.log(`  ${shortName}: ${tool.description}`);
      }
      console.log('');
    }

    console.log(`共 ${tools.length} 个工具`);
  }

  /**
   * 打印帮助
   */
  private printHelp(): void {
    console.log(`
OpenCode Gateway CLI

用法:
  gateway <tool.name> [--arg1 value1] [--arg2 value2]
  gateway list              列出所有工具
  gateway help              显示帮助

工具命名:
  <namespace>.<action>      如 gitlab.get_branches, zentao.get_bug

示例:
  # GitLab
  gateway gitlab.get_branches
  gateway gitlab.get_merge_requests --state open
  gateway gitlab.create_branch --name feature/new --ref main

  # 禅道
  gateway zentao.get_bug --bugId 123
  gateway zentao.get_bugs --status active
  gateway zentao.close_bug --bugId 123 --comment "已修复"

  # Workflow
  gateway workflow.get_linked_bugs --mrId 45
  gateway workflow.create_mr_for_bug --bugId 123

  # 飞书
  gateway feishu.send_file --filePath /path/to/file

  # 定时任务
  gateway cron.list
  gateway cron.create --cronExpr "0 9 * * 1-5" --prompt "生成日报"
`);
  }
}