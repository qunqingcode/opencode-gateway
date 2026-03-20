/**
 * 活跃会话上下文类型
 */
export interface ActiveContext {
  chatId: string;
  userId: string;
  sessionId: string;
  channelId: string;
  updatedAt: number;
}