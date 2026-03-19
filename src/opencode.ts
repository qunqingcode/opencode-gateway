/**
 * OpenCode SDK Wrapper (TypeScript 版本)
 * 
 * Features:
 * - SDK initialization
 * - Session management (全局 Session 策略，像老网关一样)
 * - AI interaction
 * - Code change request handling
 * 
 * Note: 文件路径提取功能已移至 src/utils/file.ts
 */

import { CONFIG } from './config';

// ============================================================
// 类型定义
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenCodeClient = any; // 使用 any 类型，SDK 类型定义不完整

/** 代码修改请求 */
export type CodeChangeRequest = {
  id: string;
  branchName: string;
  summary: string;
  changelog?: string;
  files: string[];
  docUrl?: string;
};

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

interface ChatResult {
  type: 'response' | 'code_change' | 'permission' | 'question';
  data: string | CodeChangeRequest | PermissionRequest | QuestionRequest;
}

// ============================================================
// 日志
// ============================================================

import { appLogger as logger } from './utils/logger';

// ============================================================
// 状态
// ============================================================

let client: OpenCodeClient | null = null;
let initPromise: Promise<OpenCodeClient | null> | null = null;

// 基于 chatId 的 Session 隔离映射
const sessionMap = new Map<string, string>();

// 默认超时时间（毫秒）- 和老网关一致
const DEFAULT_TIMEOUT = 600000; // 10 分钟

// ============================================================
// SDK 初始化
// ============================================================

/**
 * Initialize OpenCode SDK
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
}

// ============================================================
// Permission / Question API
// ============================================================

/**
 * 获取待处理的权限请求
 */
export async function getPendingPermissions(sessionId?: string): Promise<PermissionRequest[]> {
  try {
    const url = sessionId 
      ? `${CONFIG.opencode.url}/permission?session_id=${encodeURIComponent(sessionId)}`
      : `${CONFIG.opencode.url}/permission`;
    const response = await fetch(url);
    if (!response.ok) return [];
    const permissions = await response.json();
    return Array.isArray(permissions) ? permissions : [];
  } catch (error) {
    logger.error('[OpenCode] Failed to get permissions:', (error as Error).message);
    return [];
  }
}

/**
 * 获取待处理的问题请求
 */
export async function getPendingQuestions(sessionId?: string): Promise<QuestionRequest[]> {
  try {
    const url = sessionId 
      ? `${CONFIG.opencode.url}/question?session_id=${encodeURIComponent(sessionId)}`
      : `${CONFIG.opencode.url}/question`;
    const response = await fetch(url);
    if (!response.ok) return [];
    const questions = await response.json();
    return Array.isArray(questions) ? questions : [];
  } catch (error) {
    logger.error('[OpenCode] Failed to get questions:', (error as Error).message);
    return [];
  }
}

/**
 * 回复权限请求
 * @param requestID 权限请求 ID
 * @param reply "once" | "always" | "reject"
 */
export async function replyPermission(requestID: string, reply: 'once' | 'always' | 'reject'): Promise<boolean> {
  try {
    const response = await fetch(`${CONFIG.opencode.url}/permission/${requestID}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply }),
    });
    return response.ok;
  } catch (error) {
    logger.error('[OpenCode] Failed to reply permission:', (error as Error).message);
    return false;
  }
}

/**
 * 回复问题
 * @param requestID 问题请求 ID
 * @param answers 答案数组
 */
export async function replyQuestion(requestID: string, answers: string[]): Promise<boolean> {
  try {
    const response = await fetch(`${CONFIG.opencode.url}/question/${requestID}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    return response.ok;
  } catch (error) {
    logger.error('[OpenCode] Failed to reply question:', (error as Error).message);
    return false;
  }
}

/**
 * 拒绝问题
 * @param requestID 问题请求 ID
 */
export async function rejectQuestion(requestID: string): Promise<boolean> {
  try {
    const response = await fetch(`${CONFIG.opencode.url}/question/${requestID}/reject`, {
      method: 'POST',
    });
    return response.ok;
  } catch (error) {
    logger.error('[OpenCode] Failed to reject question:', (error as Error).message);
    return false;
  }
}

// ============================================================
// Session 管理（基于 chatId 的隔离）
// ============================================================

/**
 * 获取或创建用户的 Session
 * 通过 chatId 实现多用户会话隔离
 */
async function getOrCreateSession(chatId: string): Promise<string> {
  if (sessionMap.has(chatId)) {
    return sessionMap.get(chatId)!;
  }

  const sdk = await init();
  if (!sdk) throw new Error('SDK not initialized');

  logger.info(`[OpenCode] Creating new session for chat: ${chatId}...`);

  const sessionOptions: Record<string, unknown> = { agent: 'build' };
  
  if (CONFIG.opencode.modelId) {
    sessionOptions.model_id = CONFIG.opencode.modelId;
  }
  if (CONFIG.opencode.providerId) {
    sessionOptions.provider_id = CONFIG.opencode.providerId;
  }

  const session = await sdk.session.create({
    body: sessionOptions,
  });
  
  const newSessionId = (session as { data?: { id?: string } })?.data?.id;
  if (!newSessionId) throw new Error('Failed to create session');
  
  sessionMap.set(chatId, newSessionId);
  logger.info(`[OpenCode] Session created for ${chatId}: ${newSessionId}`);

  return newSessionId;
}

// ============================================================
// 格式化
// ============================================================

function formatResponse(parts: Array<{ type: string; text?: string; ignored?: boolean; files?: string[] }>): string {
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
 * 检测代码修改关键字并提取信息
 * 现在强制要求大模型返回标准 JSON 格式的代码修改请求。
 */
function extractCodeChangeFromText(text: string): CodeChangeRequest | null {
  logger.info('[CodeChange] Checking text for CodeChangeRequest JSON...');
  
  const jsonBlocks: string[] = [];
  
  // 方法1: 提取 ```json ... ``` 代码块中的内容
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const content = match[1].trim();
    if (content.startsWith('{') && content.endsWith('}')) {
      jsonBlocks.push(content);
    }
  }
  
  // 方法2: 如果没找到代码块，尝试直接提取 JSON 对象（使用括号匹配）
  if (jsonBlocks.length === 0) {
    // 查找所有可能的 JSON 起始位置
    let startIdx = text.indexOf('{');
    while (startIdx !== -1) {
      const extracted = extractCompleteJson(text, startIdx);
      if (extracted) {
        jsonBlocks.push(extracted);
        // 继续查找下一个可能的 JSON
        startIdx = text.indexOf('{', startIdx + extracted.length);
      } else {
        startIdx = text.indexOf('{', startIdx + 1);
      }
    }
  }

  for (const block of jsonBlocks) {
    try {
      const parsed = JSON.parse(block);
      
      // 检查特征字段以确认这是代码修改请求
      if (parsed.action === 'code_change' || (parsed.summary && parsed.files)) {
        logger.info(`[CodeChange] Successfully parsed JSON code change request.`);
        
        const files = Array.isArray(parsed.files) 
          ? parsed.files 
          : String(parsed.files).split(',').map(f => f.trim()).filter(Boolean);

        if (!parsed.summary || files.length === 0) {
          logger.warn('[CodeChange] Parsed JSON missing required fields (summary or files).');
          continue;
        }

        return {
          id: `code_change_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          branchName: parsed.branch || parsed.branchName || `ai-change-${Date.now()}`,
          summary: parsed.summary,
          changelog: parsed.changelog,
          files: files,
          docUrl: parsed.docUrl || parsed.doc_url,
        };
      }
    } catch (e) {
      // 忽略解析失败的非相关 JSON 块
      logger.debug(`[CodeChange] Failed to parse JSON block: ${(e as Error).message}`);
    }
  }
  
  logger.info('[CodeChange] No valid JSON code change request found.');
  return null;
}

/**
 * 从指定位置提取完整的 JSON 对象（使用括号匹配）
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

function stripCodeChangeMarker(text: string): string {
  // 移除包含特定特征的 JSON 块
  let result = text.replace(/```(?:json)?\s*\{[\s\S]*?(?:\"action\"\s*:\s*\"code_change\"|\"summary\"[\s\S]*?\"files\")[\s\S]*?\}\s*```/g, '');
  return result.trim();
}

// ============================================================
// 重新导出文件工具（保持向后兼容）
// ============================================================


// ============================================================
// 主交互
// ============================================================

export type CodeChangeCallback = (chatId: string, codeChange: CodeChangeRequest) => Promise<void>;
export type PermissionCallback = (chatId: string, permission: PermissionRequest) => Promise<void>;
export type QuestionCallback = (chatId: string, question: QuestionRequest) => Promise<void>;

export interface ChatCallbacks {
  onPermission?: PermissionCallback;
  onQuestion?: QuestionCallback;
  onCodeChange?: CodeChangeCallback;
}

/**
 * Call AI
 * 支持权限确认、问题确认、代码修改回调
 */
export async function chat(
  prompt: string,
  chatId: string,
  callbacks: ChatCallbacks = {}
): Promise<ChatResult> {
  const { onPermission, onQuestion, onCodeChange } = callbacks;
  
  try {
    const sdk = await init();
    if (!sdk) throw new Error('SDK not initialized');

    const sessionId = await getOrCreateSession(chatId);

    logger.info(`[OpenCode] Processing: ${prompt.substring(0, 50)}...`);

    // Injected system prompt to force JSON output for code changes
    const systemPrompt = `
If you need to make code changes, you MUST output a raw JSON block wrapped in \`\`\`json. 
The JSON object must have the following schema:
{
  "action": "code_change",
  "branchName": "feature-branch-name",
  "summary": "Short description of changes",
  "changelog": "Detailed bullet points...",
  "files": ["path/to/file1.ts", "path/to/file2.ts"]
}
Do NOT use custom tags like [CODE_CHANGE_REQUEST]. Use standard JSON.
`;

    // AI 调用，带超时控制
    const timeout = CONFIG.opencode.timeout || DEFAULT_TIMEOUT;
    const result = await Promise.race([
      sdk.session.prompt({
        path: { id: sessionId },
        body: { parts: [{ type: 'text', text: systemPrompt + '\n\n' + prompt }] },
      }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`AI 响应超时 (${timeout / 1000}s)，请稍后重试`)), timeout)
      )
    ]);

    logger.debug('[OpenCode] Response:', JSON.stringify(result.data, null, 2));

    logger.info('[OpenCode] Checking result.data...');
    if (!result.data) {
      logger.warn('[OpenCode] result.data is empty');
      return { type: 'response', data: 'Empty response from API' };
    }

    // 检查是否有待处理的权限请求
    const permissions = await getPendingPermissions(sessionId);
    if (permissions.length > 0 && onPermission) {
      const perm = permissions[0];
      logger.info(`[OpenCode] Permission request: ${perm.type} (${perm.id})`);
      await onPermission(chatId, perm);
      return { type: 'permission', data: perm };
    }

    // 检查是否有待处理的问题请求
    const questions = await getPendingQuestions(sessionId);
    if (questions.length > 0 && onQuestion) {
      const q = questions[0];
      logger.info(`[OpenCode] Question request: ${q.id}`);
      await onQuestion(chatId, q);
      return { type: 'question', data: q };
    }

    logger.info('[OpenCode] Destructuring result.data...');
    const { info, parts } = result.data;
    logger.info(`[OpenCode] info: ${JSON.stringify(info)}, parts: ${Array.isArray(parts) ? parts.length : 'not array'}`);

    if (info?.error) {
      logger.warn(`[OpenCode] info.error exists: ${JSON.stringify(info.error)}`);
      
      // 特殊处理：如果是权限请求导致的报错，尝试拉取 pending permission
      if (info.error.data?.message?.includes('permission') || info.error.message?.includes('permission')) {
        logger.info('[OpenCode] Error indicates permission needed, trying to fetch pending permissions...');
        const permissions = await getPendingPermissions(sessionId);
        if (permissions.length > 0 && onPermission) {
          const perm = permissions[0];
          logger.info(`[OpenCode] Found pending Permission request: ${perm.type} (${perm.id})`);
          await onPermission(chatId, perm);
          return { type: 'permission', data: perm };
        }
      }

      return { type: 'response', data: `AI Error: ${info.error.data?.message || info.error.message || info.error.name}` };
    }

    if (!Array.isArray(parts) || parts.length === 0) {
      logger.warn('[OpenCode] parts is not array or empty');
      return { type: 'response', data: 'AI returned no content' };
    }

    logger.info('[OpenCode] Filtering textContent...');
    const textContent = parts
      .filter((p: { type: string; ignored?: boolean; text?: string }) => p.type === 'text' && !p.ignored && p.text)
      .map((p: { text: string }) => p.text)
      .join('\n\n');

    logger.info(`[OpenCode] textContent length: ${textContent.length}`);
    const codeChange = extractCodeChangeFromText(textContent);
    if (codeChange && onCodeChange) {
      await onCodeChange(chatId, codeChange);
      return { type: 'code_change', data: codeChange };
    }

    const cleanedText = stripCodeChangeMarker(textContent);
    return { type: 'response', data: cleanedText || formatResponse(parts) };
  } catch (error) {
    logger.error('[OpenCode] Call failed:', (error as Error).message);
    return { type: 'response', data: `❌ 处理出错: ${(error as Error).message}` };
  }
}

/**
 * Continue after permission/question is answered
 */
export async function continueAfterReply(chatId: string): Promise<ChatResult> {
  const sessionId = sessionMap.get(chatId);
  if (!sessionId) {
    return { type: 'response', data: 'Session not found or expired.' };
  }

  // 轮询等待 AI 恢复处理 (最多等待 15 秒)
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    
    // 检查是否有更多的权限/问题请求
    const permissions = await getPendingPermissions(sessionId);
    if (permissions.length > 0) {
      return { type: 'permission', data: permissions[0] };
    }

    const questions = await getPendingQuestions(sessionId);
    if (questions.length > 0) {
      return { type: 'question', data: questions[0] };
    }
  }

  // 这里的实际实现应该取决于 OpenCode 后端如何恢复。
  // 如果后端需要重新 prompt 才能拿到后续输出，可能需要调用特定的继续接口，
  // 目前我们返回状态提示，告知用户正在处理中。
  return { type: 'response', data: '操作已确认，AI 正在后台继续处理...' };
}