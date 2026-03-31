/**
 * Agent 工厂
 */

import type { Logger } from '../types';
import type { IAgent, AgentConfig } from './interface';
import { OpenCodeAgent } from './opencode';

// ============================================================
// Agent 类型
// ============================================================

export type AgentType = 'opencode' | 'claudecode' | 'cursor';

export interface AgentFactoryConfig {
  type: AgentType;
  config: AgentConfig;
}

// ============================================================
// Agent 工厂
// ============================================================

export class AgentFactory {
  /**
   * 创建 Agent 实例
   */
  static create(type: AgentType, config: AgentConfig, logger: Logger): IAgent {
    switch (type) {
      case 'opencode':
        return new OpenCodeAgent(config, logger);

      // 未来扩展：
      // case 'claudecode':
      //   return new ClaudeCodeAgent(config, logger);
      //
      // case 'cursor':
      //   return new CursorAgent(config, logger);

      default:
        throw new Error(`Unknown agent type: ${type}`);
    }
  }

  /**
   * 获取支持的 Agent 类型
   */
  static getSupportedTypes(): AgentType[] {
    return ['opencode'];
  }
}