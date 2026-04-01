/**
 * OpenCode Agent 实现
 */

import type { Logger } from '../../types';
import type {
  IAgent,
  AgentConfig,
  AgentEventHandler,
  AgentEvent,
  PermissionRequest,
  QuestionRequest,
} from '../interface';

// ============================================================
// 工具常量
// ============================================================

/** 默认请求超时时间（毫秒） */
const DEFAULT_REQUEST_TIMEOUT = 600000;

/** SSE 读取超时时间（毫秒） */
const SSE_READ_TIMEOUT = 5000;

// ============================================================
// 内部工具函数
// ============================================================

/**
 * 带超时的 fetch 请求
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number = DEFAULT_REQUEST_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw error;
  }
}

// ============================================================
// OpenCode Agent
// ============================================================

export class OpenCodeAgent implements IAgent {
  readonly name = 'opencode';

  private config: AgentConfig;
  private logger: Logger;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  private eventHandlers: AgentEventHandler[] = [];

  constructor(config: AgentConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  async init(): Promise<void> {
    try {
      const sdk = await import('@opencode-ai/sdk');
      this.client = sdk.createOpencodeClient({
        baseUrl: this.config.url,
      });
      this.logger.info('[OpenCodeAgent] Initialized');
    } catch (error) {
      this.logger.error(`[OpenCodeAgent] Init failed: ${(error as Error).message}`);
      throw error;
    }
  }

  async createSession(): Promise<string> {
    if (!this.client) {
      throw new Error('Agent not initialized');
    }

    const body: Record<string, unknown> = { agent: 'build' };

    if (this.config.modelId && this.config.providerId) {
      body.model = {
        providerID: this.config.providerId,
        modelID: this.config.modelId,
      };
    }

    const result = await this.client.session.create({ body });
    const sessionId = result?.data?.id;

    if (!sessionId) {
      throw new Error('Failed to create session');
    }

    this.logger.info(`[OpenCodeAgent] Created session: ${sessionId}`);
    return sessionId;
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<string | null> {
    if (!this.client) {
      throw new Error('Agent not initialized');
    }

    const timeout = this.config.timeout || DEFAULT_REQUEST_TIMEOUT;
    const progressConfig = this.config.progress || {};

    this.logger.info(`[OpenCodeAgent] Sending prompt to session ${sessionId}`);

    try {
      if (progressConfig.enabled !== false) {
        return await this.sendPromptWithSSE(sessionId, prompt, timeout, progressConfig);
      }
    } catch (sseError) {
      this.logger.warn(`[OpenCodeAgent] SSE failed, falling back: ${(sseError as Error).message}`);
    }

    return this.sendPromptSync(sessionId, prompt);
  }

  onEvent(handler: AgentEventHandler): void {
    this.eventHandlers.push(handler);
  }

  async replyPermission(sessionId: string, permissionId: string, response: 'allow' | 'deny'): Promise<void> {
    if (!this.client) {
      throw new Error('Agent not initialized');
    }

    await this.client.postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionId },
      body: { response },
    });

    this.logger.info(`[OpenCodeAgent] Permission ${permissionId} ${response}ed`);
  }

  async replyQuestion(requestId: string, answer: unknown): Promise<void> {
    const timeout = this.config.timeout || DEFAULT_REQUEST_TIMEOUT;

    this.logger.info(`[OpenCodeAgent] Replying to question ${requestId} with timeout ${timeout}ms`);

    try {
      await fetchWithTimeout(
        `${this.config.url}/question/${requestId}/reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: answer }),
        },
        timeout
      );

      this.logger.info(`[OpenCodeAgent] Question ${requestId} replied successfully`);
    } catch (error) {
      this.logger.error(`[OpenCodeAgent] Question ${requestId} reply failed: ${(error as Error).message}`);
      throw error;
    }
  }

  async rejectQuestion(requestId: string): Promise<void> {
    const timeout = this.config.timeout || DEFAULT_REQUEST_TIMEOUT;

    this.logger.info(`[OpenCodeAgent] Rejecting question ${requestId} with timeout ${timeout}ms`);

    try {
      await fetchWithTimeout(
        `${this.config.url}/question/${requestId}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        timeout
      );

      this.logger.info(`[OpenCodeAgent] Question ${requestId} rejected successfully`);
    } catch (error) {
      this.logger.error(`[OpenCodeAgent] Question ${requestId} reject failed: ${(error as Error).message}`);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.logger.info('[OpenCodeAgent] Shutdown');
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private async sendPromptWithSSE(
    sessionId: string,
    prompt: string,
    timeout: number,
    progressConfig: { showTextOutput?: boolean; showToolStatus?: boolean }
  ): Promise<string | null> {
    if (!this.client) {
      throw new Error('Agent not initialized');
    }

    this.logger.info('[OpenCodeAgent] Starting SSE mode');

    const eventStream = await this.client.event.subscribe();
    if (!eventStream?.stream) {
      throw new Error('Event stream not available');
    }

    const body: Record<string, unknown> = {
      parts: [{ type: 'text' as const, text: prompt }],
    };

    if (this.config.modelId && this.config.providerId) {
      body.model = {
        providerID: this.config.providerId,
        modelID: this.config.modelId,
      };
    }

    const promptPromise = this.client.session.prompt({
      path: { id: sessionId },
      body,
    });

    const textParts: Record<number, string> = {};
    let completed = false;
    const startTime = Date.now();

    const streamIterator = eventStream.stream[Symbol.asyncIterator]();

    while (!completed && Date.now() - startTime < timeout) {
      let eventResult;
      try {
        eventResult = await Promise.race([
          streamIterator.next(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('read_timeout')), 5000)
          ),
        ]);
      } catch (err) {
        if ((err as Error).message === 'read_timeout') {
          continue;
        }
        throw err;
      }

      if (eventResult.done) break;

      const event = eventResult.value;
      const eventType = (event as { type?: string }).type;
      const props = (event as { properties?: Record<string, unknown> }).properties || {};

      // 过滤非当前 session 的事件
      // message.part.updated: sessionID 在 part 中
      // session.idle/session.error: sessionID 在 properties 中
      const partSessionId = (props.part as { sessionID?: string })?.sessionID;
      const eventSessionId =
        props.sessionID || (props.info as { sessionID?: string })?.sessionID || partSessionId;
      if (eventSessionId && eventSessionId !== sessionId) continue;

      switch (eventType) {
        case 'message.part.updated': {
          const part = props.part as Record<string, unknown> | undefined;
          if (!part) break;

          if (part.type === 'text' && part.text) {
            const partIndex = (part.index as number) ?? 0;
            const isFinal = part.ignored !== true;
            textParts[partIndex] = part.text as string;

            if (progressConfig.showTextOutput && isFinal) {
              await this.emitEvent({
                type: 'text_chunk',
                data: { text: part.text as string, isFinal, sessionId },
              });
            }
          }

          if (part.type === 'tool' && progressConfig.showToolStatus) {
            const state = part.state as { status?: string } | undefined;
            const toolName = (part.tool || part.name || 'unknown') as string;

            if (state?.status) {
              await this.emitEvent({
                type: 'tool_status',
                data: { name: toolName, status: state.status as 'running' | 'completed' | 'error', sessionId },
              });
            }
          }
          break;
        }

        case 'session.idle':
          completed = true;
          break;

        case 'session.error': {
          const error = props.error as { message?: string; name?: string } | undefined;
          const errorSessionId = props.sessionID as string | undefined;
          // 只有当错误属于当前 session 或是全局错误（无 sessionID）时才抛出
          if (!errorSessionId || errorSessionId === sessionId) {
            const errorMsg = error?.message || (error?.name || 'Session error');
            this.logger.error(`[OpenCodeAgent] Session error: ${errorMsg}`);
            throw new Error(errorMsg);
          }
          // 其他 session 的错误，忽略并继续监听
          break;
        }

        case 'permission.updated':
          await this.emitEvent({
            type: 'permission',
            data: this.mapPermission(props, sessionId),
          });
          break;

        case 'question.asked':
          await this.emitEvent({
            type: 'question',
            data: this.mapQuestion(props, sessionId),
          });
          break;
      }
    }

    // 等待 prompt 完成
    try {
      await Promise.race([
        promptPromise,
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3000)),
      ]);
    } catch {
      /* ignore */
    }

    const response = Object.keys(textParts)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => textParts[Number(k)])
      .join('\n\n');

    return response || null;
  }

  private async sendPromptSync(sessionId: string, prompt: string): Promise<string | null> {
    if (!this.client) {
      throw new Error('Agent not initialized');
    }

    this.logger.info('[OpenCodeAgent] Using sync mode');

    const body: Record<string, unknown> = {
      parts: [{ type: 'text' as const, text: prompt }],
    };

    if (this.config.modelId && this.config.providerId) {
      body.model = {
        providerID: this.config.providerId,
        modelID: this.config.modelId,
      };
    }

    const result = await this.client.session.prompt({
      path: { id: sessionId },
      body,
    });

    const data = result?.data;
    if (data?.parts && Array.isArray(data.parts)) {
      const textParts = data.parts
        .filter((p: { type: string }) => p.type === 'text')
        .map((p: { text: string }) => p.text)
        .join('\n');
      return textParts || null;
    }

    return null;
  }

  private async emitEvent(event: AgentEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (err) {
        this.logger.error(`[OpenCodeAgent] Event handler error: ${(err as Error).message}`);
      }
    }
  }

  private mapPermission(props: Record<string, unknown>, sessionId: string): PermissionRequest {
    return {
      id: (props.id as string) || '',
      sessionId,
      title: (props.title as string) || '需要您的确认',
      type: (props.type as string) || 'unknown',
    };
  }

  private mapQuestion(props: Record<string, unknown>, sessionId: string): QuestionRequest {
    const questions = (props.questions as Array<{
      question?: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
    }>) || [];

    return {
      id: (props.id as string) || '',
      sessionId,
      questions: questions.map((q) => ({
        question: q.question || '',
        header: q.header,
        options: q.options,
      })),
    };
  }
}