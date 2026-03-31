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
   */
  async run(args: string[]): Promise<void> {
    if (args.length === 0) {
      this.printHelp();
      return;
    }

    const [toolName, ...toolArgs] = args;

    if (toolName === 'list') {
      this.listTools();
      return;
    }

    if (toolName === 'help') {
      this.printHelp();
      return;
    }

    // 执行工具
    await this.executeTool(toolName, this.parseArgs(toolArgs));
  }

  /**
   * 执行工具
   */
  private async executeTool(name: string, args: Record<string, unknown>): Promise<void> {
    const context: ToolContext = {
      chatId: 'cli',
      userId: process.env.USER || 'cli-user',
      sessionId: 'cli-session',
      sendText: async (text: string) => console.log(text),
      sendCard: async (card: unknown) => console.log(JSON.stringify(card, null, 2)),
      logger: this.logger,
    };

    const result = await this.toolRegistry.execute(name, args, context);

    if (result.success) {
      console.log('\n✅ Success:');
      console.log(JSON.stringify(result.output, null, 2));
    } else {
      console.error('\n❌ Error:', result.error);
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
    console.log('\n可用的工具:\n');
    for (const tool of this.toolRegistry.listPublic()) {
      console.log(`  ${tool.name}: ${tool.description}`);
    }
  }

  /**
   * 打印帮助
   */
  private printHelp(): void {
    console.log(`
OpenCode Gateway CLI

用法:
  gateway <tool> [--arg1 value1] [--arg2 value2]
  gateway list              列出所有工具
  gateway help              显示帮助

示例:
  gateway gitlab --action get_branches
  gateway workflow --action merge_and_close_bug --mrId 123 --bugId 456
`);
  }
}