/**
 * OpenCode SDK 封装
 * 
 * 核心职责：
 * 1. SDK 客户端管理
 * 2. Session 会话管理（多租户隔离）
 * 3. AI 对话交互
 * 4. 权限/问题请求处理
 */

import { CONFIG } from '../../config';
import { appLogger as logger } from '../../utils/logger';

// ============================================================
// 类型定义
// ============================================================

/** OpenCode SDK 客户端类型（使用 any 避免类型冲突） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenCodeClient = any;

/** 响应部分 */
interface ResponsePart {
  type: 'text' | 'patch' | 'tool';
  text?: string;
  ignored?: boolean;
  files?: string[];
  tool?: string;
  state?: {
    status: 'pending' | 'running' | 'completed' | 'error';
    output?: string;
    input?: Record<string, unknown>;
  };
}

/** 代码修改请求 */
export interface CodeChangeRequest {
  id: string;
  branchName: string;
  summary: string;
  changelog?: string;
  files: string[];
  docUrl?: string;
}

/** 权限请求 */
export interface PermissionRequest {
  id: string;
  type: string;
  title?: string;
  pattern?: string | string[];
  metadata?: {
    path?: string;
    command?: string;
    url?: string;
    query?: string;
  };
}

/** 问题请求 */
export interface QuestionRequest {
  id: string;
  questions: Array<{
    question: string;
    options?: string[];
  }>;
}

/** 会话结果 */
export interface ChatResult {
  type: 'response' | 'code_change' | 'permission' | 'question';
  data: string | CodeChangeRequest | PermissionRequest | QuestionRequest;
}

/** 回调函数类型 */
export type CodeChangeCallback = (chatId: string, codeChange: CodeChangeRequest) => Promise<void>;
export type PermissionCallback = (chatId: string, permission: PermissionRequest) => Promise<void>;
export type QuestionCallback = (chatId: string, question: QuestionRequest) => Promise<void>;

export interface ChatCallbacks {
  onPermission?: PermissionCallback;
  onQuestion?: QuestionCallback;
  onCodeChange?: CodeChangeCallback;
}

// ============================================================
// 常量配置
// ============================================================

const DEFAULT_TIMEOUT_MS = 600000; // 10 分钟
const SESSION_TTL_MS = 3600000;   // 1 小时
const CONTINUE_POLL_INTERVAL_MS = 1000;
const CONTINUE_POLL_MAX_ATTEMPTS = 15;

// ============================================================
// SDK 客户端管理
// ============================================================

let client: OpenCodeClient | null = null;
let initPromise: Promise<OpenCodeClient | null> | null = null;

/**
 * 初始化 OpenCode SDK
 * 支持并发安全，多次调用只初始化一次
 */
export async function init(): Promise<OpenCodeClient | null> {
  if (client) return client;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const sdk = await import('@opencode-ai/sdk');
      client = sdk.createOpencodeClient({
        baseUrl: CONFIG.opencode.url,
      });
      logger.info('[OpenCode] SDK initialized');
      return client;
    } catch (error) {
      logger.error('[OpenCode] SDK init failed:', (error as Error).message);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

/**
 * 预初始化 SDK（服务启动时调用）
 */
export async function preInit(): Promise<void> {
  logger.info('[OpenCode] Pre-initializing SDK...');
  await init();
  logger.info('[OpenCode] SDK ready');
}

/**
 * 获取 SDK 客户端
 */
function getClient(): OpenCodeClient {
  if (!client) throw new Error('SDK not initialized');
  return client;
}

// ============================================================
// Session 管理（支持过期清理）
// ============================================================

interface SessionEntry {
  id: string;
  createdAt: number;
}

const sessionMap = new Map<string, SessionEntry>();

/**
 * 清理过期 Session
 */
function cleanupExpiredSessions(): void {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [chatId, entry] of sessionMap) {
    if (now - entry.createdAt > SESSION_TTL_MS) {
      sessionMap.delete(chatId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.info(`[Session] Cleaned ${cleaned} expired sessions`);
  }
}

/**
 * 获取或创建 Session
 * 通过 chatId 实现多租户会话隔离
 */
async function getOrCreateSession(chatId: string): Promise<string> {
  // 定期清理过期 session
  if (sessionMap.size > 100) {
    cleanupExpiredSessions();
  }

  const existing = sessionMap.get(chatId);
  if (existing) {
    return existing.id;
  }

  const sdk = getClient();
  logger.info(`[Session] Creating new session for chat: ${chatId}`);

  const sessionOptions: Record<string, unknown> = { agent: 'build' };
  
  if (CONFIG.opencode.modelId) {
    sessionOptions.model_id = CONFIG.opencode.modelId;
  }
  if (CONFIG.opencode.providerId) {
    sessionOptions.provider_id = CONFIG.opencode.providerId;
  }

  const session = await sdk.session.create({ body: sessionOptions });
  const sessionId = session?.data?.id;
  
  if (!sessionId) {
    throw new Error('Failed to create session');
  }

  sessionMap.set(chatId, { id: sessionId, createdAt: Date.now() });
  logger.info(`[Session] Created: ${chatId} -> ${sessionId}`);

  return sessionId;
}

/**
 * 获取 Session ID（用于 continueAfterReply）
 */
function getSessionId(chatId: string): string | undefined {
  return sessionMap.get(chatId)?.id;
}

// ============================================================
// Permission / Question API
// ============================================================

/** 构建完整 URL */
function buildUrl(path: string, sessionId?: string): string {
  const base = CONFIG.opencode.url;
  if (sessionId) {
    return `${base}${path}?session_id=${encodeURIComponent(sessionId)}`;
  }
  return `${base}${path}`;
}

/** 通用 GET 请求 */
async function apiGet<T>(path: string, sessionId?: string): Promise<T[]> {
  try {
    const response = await fetch(buildUrl(path, sessionId));
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    logger.error(`[OpenCode] GET ${path} failed:`, (error as Error).message);
    return [];
  }
}

/** 通用 POST 请求 */
async function apiPost(path: string, body?: object): Promise<boolean> {
  try {
    const response = await fetch(`${CONFIG.opencode.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.ok;
  } catch (error) {
    logger.error(`[OpenCode] POST ${path} failed:`, (error as Error).message);
    return false;
  }
}

/** 获取待处理的权限请求 */
export async function getPendingPermissions(sessionId?: string): Promise<PermissionRequest[]> {
  return apiGet<PermissionRequest>('/permission', sessionId);
}

/** 获取待处理的问题请求 */
export async function getPendingQuestions(sessionId?: string): Promise<QuestionRequest[]> {
  return apiGet<QuestionRequest>('/question', sessionId);
}

/** 回复权限请求 */
export async function replyPermission(requestId: string, reply: 'once' | 'always' | 'reject'): Promise<boolean> {
  return apiPost(`/permission/${requestId}/reply`, { reply });
}

/** 回复问题 */
export async function replyQuestion(requestId: string, answers: string[]): Promise<boolean> {
  return apiPost(`/question/${requestId}/reply`, { answers });
}

/** 拒绝问题 */
export async function rejectQuestion(requestId: string): Promise<boolean> {
  return apiPost(`/question/${requestId}/reject`);
}

// ============================================================
// 代码修改请求解析
// ============================================================

/**
 * 从文本中提取完整的 JSON 对象
 */
function extractCompleteJson(text: string, startIndex: number): string | null {
  if (text[startIndex] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return text.substring(startIndex, i + 1);
        }
      }
    }
  }

  return null;
}

/**
 * 从文本中提取代码修改请求
 */
function extractCodeChangeFromText(text: string): CodeChangeRequest | null {
  // 提取 ```json ... ``` 代码块
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  let match;
  
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const content = match[1].trim();
    if (!content.startsWith('{')) continue;
    
    try {
      const parsed = JSON.parse(content);
      
      if (parsed.action === 'code_change' || (parsed.summary && parsed.files)) {
        const files = Array.isArray(parsed.files) 
          ? parsed.files.map(String)
          : typeof parsed.files === 'string'
            ? parsed.files.split(',').map((f: string) => f.trim()).filter(Boolean)
            : [];
        
        if (files.length === 0) continue;
        
        return {
          id: `code_change_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          branchName: (parsed.branchName || parsed.branch || `ai-change-${Date.now()}`) as string,
          summary: parsed.summary as string,
          changelog: parsed.changelog as string | undefined,
          files,
          docUrl: (parsed.docUrl || parsed.doc_url) as string | undefined,
        };
      }
    } catch {
      // 忽略非 JSON 内容
    }
  }

  // 如果没找到代码块，尝试直接提取 JSON
  let startIdx = text.indexOf('{');
  while (startIdx !== -1) {
    const extracted = extractCompleteJson(text, startIdx);
    if (extracted) {
      try {
        const parsed = JSON.parse(extracted);
        
        if (parsed.action === 'code_change' || (parsed.summary && parsed.files)) {
          const files = Array.isArray(parsed.files) 
            ? parsed.files.map(String)
            : typeof parsed.files === 'string'
              ? parsed.files.split(',').map((f: string) => f.trim()).filter(Boolean)
              : [];
          
          if (files.length > 0) {
            return {
              id: `code_change_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
              branchName: (parsed.branchName || parsed.branch || `ai-change-${Date.now()}`) as string,
              summary: parsed.summary as string,
              changelog: parsed.changelog as string | undefined,
              files,
              docUrl: (parsed.docUrl || parsed.doc_url) as string | undefined,
            };
          }
        }
      } catch {
        // 忽略非 JSON 内容
      }
      startIdx = text.indexOf('{', startIdx + extracted.length);
    } else {
      startIdx = text.indexOf('{', startIdx + 1);
    }
  }

  return null;
}

/**
 * 移除文本中的代码修改 JSON 块
 */
function stripCodeChangeJson(text: string): string {
  return text
    .replace(/```(?:json)?\s*\{[\s\S]*?(?:"action"\s*:\s*"code_change"|"summary"[\s\S]*?"files")[\s\S]*?\}\s*```/g, '')
    .trim();
}

// ============================================================
// AI 对话交互
// ============================================================

/**
 * 格式化 AI 响应
 */
function formatResponse(parts: ResponsePart[]): string {
  const texts = parts
    .filter(p => p.type === 'text' && !p.ignored && p.text)
    .map(p => p.text!);

  const changedFiles = parts
    .filter(p => p.type === 'patch')
    .flatMap(p => p.files || []);

  let response = texts.join('\n\n');

  if (changedFiles.length > 0) {
    response += `\n\n---\nModified files:\n${changedFiles.map(f => `- ${f}`).join('\n')}`;
  }

  return response || 'No valid content';
}

/**
 * 检查并处理权限请求
 */
async function checkPermissionRequest(
  sessionId: string,
  chatId: string,
  callback?: PermissionCallback
): Promise<ChatResult | null> {
  const permissions = await getPendingPermissions(sessionId);
  if (permissions.length === 0 || !callback) return null;

  const perm = permissions[0];
  logger.info(`[OpenCode] Permission request: ${perm.type} (${perm.id})`);
  await callback(chatId, perm);
  return { type: 'permission', data: perm };
}

/**
 * 检查并处理问题请求
 */
async function checkQuestionRequest(
  sessionId: string,
  chatId: string,
  callback?: QuestionCallback
): Promise<ChatResult | null> {
  const questions = await getPendingQuestions(sessionId);
  if (questions.length === 0 || !callback) return null;

  const q = questions[0];
  logger.info(`[OpenCode] Question request: ${q.id}`);
  await callback(chatId, q);
  return { type: 'question', data: q };
}

/**
 * 调用 AI 进行对话
 * 
 * @param prompt 用户输入
 * @param chatId 会话 ID（用于多租户隔离）
 * @param callbacks 回调函数（权限/问题/代码修改）
 */
export async function chat(
  prompt: string,
  chatId: string,
  callbacks: ChatCallbacks = {}
): Promise<ChatResult> {
  const { onPermission, onQuestion, onCodeChange } = callbacks;

  try {
    const sessionId = await getOrCreateSession(chatId);
    const sdk = getClient();
    const timeout = CONFIG.opencode.timeout || DEFAULT_TIMEOUT_MS;

    logger.info(`[OpenCode] Processing: ${prompt.substring(0, 50)}...`);

    // 调用 AI
    const result = await Promise.race([
      sdk.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text: prompt }],
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`AI 响应超时 (${timeout / 1000}s)`)), timeout)
      ),
    ]);

    // 检查响应数据
    if (!result.data) {
      logger.warn('[OpenCode] Empty response');
      return { type: 'response', data: 'AI 未返回内容' };
    }

    // 检查权限请求
    const permResult = await checkPermissionRequest(sessionId, chatId, onPermission);
    if (permResult) return permResult;

    // 检查问题请求
    const questionResult = await checkQuestionRequest(sessionId, chatId, onQuestion);
    if (questionResult) return questionResult;

    // 检查错误信息
    const { info, parts } = result.data;
    if (info?.error) {
      if (String(info.error.message || info.error.data?.message).includes('permission')) {
        const permResult = await checkPermissionRequest(sessionId, chatId, onPermission);
        if (permResult) return permResult;
      }
      
      return {
        type: 'response',
        data: `AI Error: ${info.error.data?.message || info.error.message || info.error.name}`,
      };
    }

    // 处理响应内容
    if (!Array.isArray(parts) || parts.length === 0) {
      return { type: 'response', data: 'AI 返回空内容' };
    }

    // 提取文本内容
    const textContent = parts
      .filter((p: ResponsePart) => p.type === 'text' && !p.ignored && p.text)
      .map((p: ResponsePart) => p.text!)
      .join('\n\n');

    // 检查代码修改请求（从文本中解析）
    const codeChange = extractCodeChangeFromText(textContent);
    if (codeChange && onCodeChange) {
      await onCodeChange(chatId, codeChange);
      return { type: 'code_change', data: codeChange };
    }

    // 返回普通响应
    const cleanedText = stripCodeChangeJson(textContent);
    return { type: 'response', data: cleanedText || formatResponse(parts) };

  } catch (error) {
    logger.error('[OpenCode] Chat failed:', (error as Error).message);
    return { type: 'response', data: `❌ 处理出错: ${(error as Error).message}` };
  }
}

/**
 * 权限/问题回复后继续处理
 * 轮询检查是否有新的请求
 */
export async function continueAfterReply(chatId: string): Promise<ChatResult> {
  const sessionId = getSessionId(chatId);
  if (!sessionId) {
    return { type: 'response', data: 'Session 已过期，请重新发起对话' };
  }

  // 轮询检查新的请求
  for (let i = 0; i < CONTINUE_POLL_MAX_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, CONTINUE_POLL_INTERVAL_MS));

    const permissions = await getPendingPermissions(sessionId);
    if (permissions.length > 0) {
      return { type: 'permission', data: permissions[0] };
    }

    const questions = await getPendingQuestions(sessionId);
    if (questions.length > 0) {
      return { type: 'question', data: questions[0] };
    }
  }

  return { type: 'response', data: '操作已确认，AI 正在后台继续处理...' };
}