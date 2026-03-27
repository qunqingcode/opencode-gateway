/**
 * Session 管理器 (参考 cc-connect/core/session.go)
 * 
 * 功能：
 * 1. 多用户多 Session 支持
 * 2. 活跃 Session 追踪
 * 3. 持久化到 JSON 文件
 * 4. Session 列表、切换、历史记录
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '../types';

// ============================================================
// 常量
// ============================================================

/** Sentinel value for AgentSessionID to use --continue (resume most recent session) */
export const CONTINUE_SESSION = '__continue__';

// ============================================================
// 类型定义
// ============================================================

/** 历史记录条目 */
export interface HistoryEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/** Session 定义 */
export interface Session {
  id: string;
  name: string;
  agentSessionId: string;
  agentType?: string;
  history: HistoryEntry[];
  createdAt: number;
  updatedAt: number;
}

/** 用户元数据 */
export interface UserMeta {
  userName?: string;
  chatName?: string;
}

/** Session 快照 (用于持久化) */
interface SessionSnapshot {
  sessions: Record<string, Session>;
  activeSession: Record<string, string>;
  userSessions: Record<string, string[]>;
  counter: number;
  sessionNames: Record<string, string>;
  userMeta: Record<string, UserMeta>;
}

// ============================================================
// Session 类
// ============================================================

/** Session 实例 */
export class SessionImpl implements Session {
  id: string;
  name: string;
  agentSessionId: string = '';
  agentType?: string;
  history: HistoryEntry[] = [];
  createdAt: number;
  updatedAt: number;

  private _busy: boolean = false;
  private _lockPromise: Promise<void> | null = null;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  /** 尝试锁定 Session (非阻塞) */
  tryLock(): boolean {
    if (this._busy) return false;
    this._busy = true;
    return true;
  }

  /** 解锁 Session */
  unlock(): void {
    this._busy = false;
    this.updatedAt = Date.now();
  }

  /** 添加历史记录 */
  addHistory(role: 'user' | 'assistant' | 'system', content: string): void {
    this.history.push({
      role,
      content,
      timestamp: Date.now(),
    });
  }

  /** 设置 Agent 信息 */
  setAgentInfo(agentSessionId: string, agentType: string, name: string): void {
    if (agentSessionId === CONTINUE_SESSION) {
      agentSessionId = '';
    }
    this.agentSessionId = agentSessionId;
    this.agentType = agentType;
    this.name = name;
  }

  /** 获取 Agent Session ID */
  getAgentSessionId(): string {
    return this.agentSessionId;
  }

  /** 设置 Agent Session ID */
  setAgentSessionId(id: string, agentType: string): void {
    if (id === CONTINUE_SESSION) return;
    this.agentSessionId = id;
    this.agentType = agentType;
  }

  /** 比较并设置 Agent Session ID (仅在空或 CONTINUE_SESSION 时设置) */
  compareAndSetAgentSessionId(id: string, agentType: string): boolean {
    if (!id || id === CONTINUE_SESSION) return false;
    if (this.agentSessionId && this.agentSessionId !== CONTINUE_SESSION) return false;
    this.agentSessionId = id;
    this.agentType = agentType;
    return true;
  }

  /** 清除历史记录 */
  clearHistory(): void {
    this.history = [];
  }

  /** 获取历史记录 (最近 n 条) */
  getHistory(n: number = 0): HistoryEntry[] {
    if (n <= 0 || n > this.history.length) {
      return [...this.history];
    }
    return this.history.slice(-n);
  }

  /** 清除 CONTINUE_SESSION sentinel */
  stripContinueSessionSentinel(): void {
    if (this.agentSessionId === CONTINUE_SESSION) {
      this.agentSessionId = '';
    }
  }

  /** 转换为纯数据对象 */
  toJSON(): Session {
    return {
      id: this.id,
      name: this.name,
      agentSessionId: this.agentSessionId === CONTINUE_SESSION ? '' : this.agentSessionId,
      agentType: this.agentType,
      history: [...this.history],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

// ============================================================
// SessionManager
// ============================================================

/**
 * Session 管理器
 * 
 * 支持多用户多 Session，持久化到 JSON 文件
 */
export class SessionManager {
  private sessions: Record<string, SessionImpl> = {};
  private activeSession: Record<string, string> = {};
  private userSessions: Record<string, string[]> = {};
  private sessionNames: Record<string, string> = {};
  private userMeta: Record<string, UserMeta> = {};
  private counter: number = 0;
  private storePath: string;
  private logger: Logger;

  constructor(storePath: string, logger: Logger) {
    this.storePath = storePath;
    this.logger = logger;
    if (storePath) {
      this.load();
    }
  }

  /** 生成下一个 Session ID */
  private nextId(): string {
    this.counter++;
    return `s${this.counter}`;
  }

  /** 获取或创建活跃 Session */
  getOrCreateActive(userKey: string): SessionImpl {
    const activeId = this.activeSession[userKey];
    if (activeId && this.sessions[activeId]) {
      return this.sessions[activeId];
    }
    const session = this.createLocked(userKey, 'default');
    this.save();
    return session;
  }

  /** 创建新 Session */
  newSession(userKey: string, name: string): SessionImpl {
    const session = this.createLocked(userKey, name);
    this.save();
    return session;
  }

  /** 创建独立 Session (不改变活跃 Session) */
  newSideSession(userKey: string, name: string): SessionImpl {
    const id = this.nextId();
    const now = Date.now();
    const session = new SessionImpl(id, name);
    session.createdAt = now;
    session.updatedAt = now;
    
    this.sessions[id] = session;
    if (!this.userSessions[userKey]) {
      this.userSessions[userKey] = [];
    }
    this.userSessions[userKey].push(id);
    this.save();
    return session;
  }

  /** 创建 Session (内部方法) */
  private createLocked(userKey: string, name: string): SessionImpl {
    const id = this.nextId();
    const now = Date.now();
    const session = new SessionImpl(id, name);
    session.createdAt = now;
    session.updatedAt = now;

    this.sessions[id] = session;
    this.activeSession[userKey] = id;
    
    if (!this.userSessions[userKey]) {
      this.userSessions[userKey] = [];
    }
    this.userSessions[userKey].push(id);

    return session;
  }

  /** 切换 Session */
  switchSession(userKey: string, target: string): SessionImpl | null {
    const userSessionIds = this.userSessions[userKey] || [];
    for (const sid of userSessionIds) {
      const session = this.sessions[sid];
      if (session && (session.id === target || session.name === target)) {
        this.activeSession[userKey] = session.id;
        this.save();
        return session;
      }
    }
    return null;
  }

  /** 列出用户的所有 Session */
  listSessions(userKey: string): SessionImpl[] {
    const ids = this.userSessions[userKey] || [];
    return ids
      .map(sid => this.sessions[sid])
      .filter((s): s is SessionImpl => s !== undefined);
  }

  /** 获取活跃 Session ID */
  activeSessionId(userKey: string): string | undefined {
    return this.activeSession[userKey];
  }

  /** 设置 Session 名称 */
  setSessionName(agentSessionId: string, name: string): void {
    if (!name) {
      delete this.sessionNames[agentSessionId];
    } else {
      this.sessionNames[agentSessionId] = name;
    }
    this.save();
  }

  /** 获取 Session 名称 */
  getSessionName(agentSessionId: string): string | undefined {
    return this.sessionNames[agentSessionId];
  }

  /** 更新用户元数据 */
  updateUserMeta(sessionKey: string, userName?: string, chatName?: string): void {
    if (!userName && !chatName) return;
    
    let meta = this.userMeta[sessionKey];
    if (!meta) {
      meta = {};
      this.userMeta[sessionKey] = meta;
    }
    if (userName) meta.userName = userName;
    if (chatName) meta.chatName = chatName;
  }

  /** 获取用户元数据 */
  getUserMeta(sessionKey: string): UserMeta | undefined {
    const meta = this.userMeta[sessionKey];
    if (!meta) return undefined;
    return { ...meta };
  }

  /** 获取所有 Session */
  allSessions(): SessionImpl[] {
    return Object.values(this.sessions);
  }

  /** 获取 Session Key 映射 */
  sessionKeyMap(): { idToKey: Record<string, string>; activeIds: Record<string, boolean> } {
    const idToKey: Record<string, string> = {};
    const activeIds: Record<string, boolean> = {};

    for (const [userKey, ids] of Object.entries(this.userSessions)) {
      for (const sid of ids) {
        idToKey[sid] = userKey;
      }
      const aid = this.activeSession[userKey];
      if (aid) activeIds[aid] = true;
    }

    return { idToKey, activeIds };
  }

  /** 按 ID 查找 Session */
  findById(id: string): SessionImpl | undefined {
    return this.sessions[id];
  }

  /** 按 ID 删除 Session */
  deleteById(id: string): boolean {
    if (!this.sessions[id]) return false;
    this.deleteByIdLocked(id);
    this.save();
    return true;
  }

  /** 按 Agent Session ID 删除 */
  deleteByAgentSessionId(agentSessionId: string): number {
    if (!agentSessionId) return 0;

    let removed = 0;
    for (const [id, session] of Object.entries(this.sessions)) {
      if (session.agentSessionId === agentSessionId) {
        this.deleteByIdLocked(id);
        removed++;
      }
    }
    if (removed > 0) this.save();
    return removed;
  }

  /** 删除 Session (内部方法) */
  private deleteByIdLocked(id: string): void {
    delete this.sessions[id];
    
    for (const [userKey, ids] of Object.entries(this.userSessions)) {
      const idx = ids.indexOf(id);
      if (idx >= 0) {
        ids.splice(idx, 1);
      }
      if (this.activeSession[userKey] === id) {
        delete this.activeSession[userKey];
      }
    }
  }

  /** 保存到文件 */
  save(): void {
    if (!this.storePath) return;

    const snapSessions: Record<string, Session> = {};
    for (const [id, s] of Object.entries(this.sessions)) {
      snapSessions[id] = s.toJSON();
    }

    const snap: SessionSnapshot = {
      sessions: snapSessions,
      activeSession: { ...this.activeSession },
      userSessions: { ...this.userSessions },
      counter: this.counter,
      sessionNames: { ...this.sessionNames },
      userMeta: { ...this.userMeta },
    };

    try {
      const data = JSON.stringify(snap, null, 2);
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storePath, data, 'utf-8');
    } catch (err) {
      this.logger.error(`[Session] Failed to save: ${err}`);
    }
  }

  /** 从文件加载 */
  private load(): void {
    try {
      if (!fs.existsSync(this.storePath)) return;
      
      const data = fs.readFileSync(this.storePath, 'utf-8');
      const snap: SessionSnapshot = JSON.parse(data);

      this.sessions = {};
      for (const [id, s] of Object.entries(snap.sessions || {})) {
        const session = new SessionImpl(s.id, s.name);
        session.agentSessionId = s.agentSessionId || '';
        session.agentType = s.agentType;
        session.history = s.history || [];
        session.createdAt = s.createdAt;
        session.updatedAt = s.updatedAt;
        session.stripContinueSessionSentinel();
        this.sessions[id] = session;
      }

      this.activeSession = snap.activeSession || {};
      this.userSessions = snap.userSessions || {};
      this.counter = snap.counter || 0;
      this.sessionNames = snap.sessionNames || {};
      this.userMeta = snap.userMeta || {};

      this.logger.info(`[Session] Loaded from disk: ${this.storePath}, sessions: ${Object.keys(this.sessions).length}`);
    } catch (err) {
      this.logger.error(`[Session] Failed to load: ${err}`);
    }
  }

  /** 清除不属于当前 Agent 的 Session ID */
  invalidateForAgent(agentType: string): void {
    let invalidated = 0;
    for (const session of Object.values(this.sessions)) {
      if (session.agentSessionId && session.agentType && session.agentType !== agentType) {
        this.logger.info(`[Session] Invalidating stale agent session: ${session.id}`);
        session.agentSessionId = '';
        session.agentType = agentType;
        invalidated++;
      }
    }
    if (invalidated > 0) this.save();
  }

  /** 获取存储路径 */
  getStorePath(): string {
    return this.storePath;
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 解析 Session Key
 * 格式: "platform:groupId:userId" 或 "platform:userId"
 */
export function parseSessionKey(key: string): { platform: string; groupUser: string } {
  const idx = key.indexOf(':');
  if (idx >= 0) {
    return { platform: key.slice(0, idx), groupUser: key.slice(idx + 1) };
  }
  return { platform: key, groupUser: '' };
}