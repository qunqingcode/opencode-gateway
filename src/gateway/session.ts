/**
 * Session 管理器
 * 
 * 职责：
 * 1. 管理 OpenCode Session 生命周期
 * 2. 实现 chatId -> sessionId 映射
 * 3. 管理活跃上下文（供 MCP 工具使用）
 * 4. 自动清理过期 Session
 */

import type { ISessionManager, SessionInfo, Logger } from './types';
import type { ActiveContext } from './context';

// ============================================================
// 配置
// ============================================================

const SESSION_TTL_MS = 3600000; // 1 小时

// ============================================================
// Session 管理器实现
// ============================================================

export class SessionManager implements ISessionManager {
  private sessions = new Map<string, SessionInfo>();
  private logger: Logger;
  private createSessionFn: (chatId: string) => Promise<string>;
  
  // 活跃上下文（当前正在处理消息的会话）
  private activeContext: ActiveContext | null = null;

  constructor(
    logger: Logger,
    createSessionFn: (chatId: string) => Promise<string>
  ) {
    this.logger = logger;
    this.createSessionFn = createSessionFn;
  }

  async getOrCreate(chatId: string): Promise<string> {
    // 定期清理
    if (this.sessions.size > 100) {
      this.cleanupExpired();
    }

    const existing = this.sessions.get(chatId);
    if (existing) {
      existing.lastActiveAt = Date.now();
      return existing.id;
    }

    // 创建新 Session
    this.logger.info(`[Session] Creating new session for chat: ${chatId}`);
    const sessionId = await this.createSessionFn(chatId);

    const info: SessionInfo = {
      id: sessionId,
      chatId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.sessions.set(chatId, info);
    this.logger.info(`[Session] Created: ${chatId} -> ${sessionId}`);

    return sessionId;
  }

  getSessionId(chatId: string): string | undefined {
    return this.sessions.get(chatId)?.id;
  }

  getSessionInfo(chatId: string): SessionInfo | undefined {
    return this.sessions.get(chatId);
  }

  cleanupExpired(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [chatId, info] of this.sessions) {
      if (now - info.lastActiveAt > SESSION_TTL_MS) {
        this.sessions.delete(chatId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.info(`[Session] Cleaned ${cleaned} expired sessions`);
    }
  }

  size(): number {
    return this.sessions.size;
  }

  // ============================================================
  // 活跃上下文管理（供 MCP 工具使用）
  // ============================================================

  /**
   * 设置当前活跃上下文
   * 在 Gateway 收到消息时调用
   */
  setActiveContext(ctx: Omit<ActiveContext, 'updatedAt'>): void {
    this.activeContext = { ...ctx, updatedAt: Date.now() };
  }

  /**
   * 获取当前活跃上下文
   * 在 MCP 工具执行时调用
   */
  getActiveContext(): ActiveContext | null {
    return this.activeContext;
  }
}