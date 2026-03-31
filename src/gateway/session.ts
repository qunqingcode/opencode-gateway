/**
 * Session 管理
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '../types';

// ============================================================
// Session 类型
// ============================================================

interface Session {
  id: string;
  name: string;
  agentSessionId: string;
  createdAt: number;
  updatedAt: number;
}

interface SessionSnapshot {
  sessions: Record<string, Session>;
  activeSession: Record<string, string>;
  counter: number;
}

// ============================================================
// Session 管理器
// ============================================================

export class SessionManager {
  private sessions = new Map<string, Session>();
  private activeSession = new Map<string, string>();
  private counter = 0;
  private storePath: string;
  private logger: Logger;

  constructor(dataDir: string, logger: Logger) {
    this.storePath = path.join(dataDir, 'sessions.json');
    this.logger = logger;
    this.load();
  }

  /**
   * 获取或创建 Session
   */
  getOrCreate(chatId: string): Session {
    const activeId = this.activeSession.get(chatId);
    if (activeId && this.sessions.has(activeId)) {
      return this.sessions.get(activeId)!;
    }

    const session = this.create(chatId);
    this.save();
    return session;
  }

  /**
   * 创建新 Session
   */
  private create(chatId: string): Session {
    this.counter++;
    const now = Date.now();
    const session: Session = {
      id: `s${this.counter}`,
      name: 'default',
      agentSessionId: '',
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(session.id, session);
    this.activeSession.set(chatId, session.id);

    this.logger.info(`[SessionManager] Created session: ${session.id}`);
    return session;
  }

  /**
   * 获取 Session
   */
  get(chatId: string): Session | undefined {
    const activeId = this.activeSession.get(chatId);
    if (!activeId) return undefined;
    return this.sessions.get(activeId);
  }

  /**
   * 保存到文件
   */
  save(): void {
    if (!this.storePath) return;

    const snap: SessionSnapshot = {
      sessions: Object.fromEntries(this.sessions),
      activeSession: Object.fromEntries(this.activeSession),
      counter: this.counter,
    };

    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storePath, JSON.stringify(snap, null, 2), 'utf-8');
    } catch (err) {
      this.logger.error(`[SessionManager] Failed to save: ${err}`);
    }
  }

  /**
   * 从文件加载
   */
  private load(): void {
    try {
      if (!fs.existsSync(this.storePath)) return;

      const data = fs.readFileSync(this.storePath, 'utf-8');
      const snap: SessionSnapshot = JSON.parse(data);

      this.sessions = new Map(Object.entries(snap.sessions || {}));
      this.activeSession = new Map(Object.entries(snap.activeSession || {}));
      this.counter = snap.counter || 0;

      this.logger.info(`[SessionManager] Loaded ${this.sessions.size} sessions`);
    } catch (err) {
      this.logger.error(`[SessionManager] Failed to load: ${err}`);
    }
  }
}