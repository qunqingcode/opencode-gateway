/**
 * 请求注册表
 * 
 * 管理待处理请求的映射（requestId -> chatId, senderId, messageId）
 * 用于卡片交互时查找原始请求上下文
 */

interface PendingRequest {
  chatId: string;
  senderId: string;
  messageId: string;
}

class RequestRegistry {
  private requests = new Map<string, PendingRequest>();

  set(requestId: string, data: PendingRequest): void {
    this.requests.set(requestId, data);
  }

  get(requestId: string): PendingRequest | undefined {
    return this.requests.get(requestId);
  }

  getChatId(requestId: string): string {
    return this.requests.get(requestId)?.chatId || '';
  }

  delete(requestId: string): void {
    this.requests.delete(requestId);
  }

  clear(): void {
    this.requests.clear();
  }

  get size(): number {
    return this.requests.size;
  }
}

export const requestRegistry = new RequestRegistry();