/**
 * API Client 基类
 * 
 * 所有 API Client（飞书、GitLab、禅道）的基类
 * 参考 OpenClaw 的 Provider 设计
 */

import type { Logger } from '../types';

// ============================================================
// API Client 基类
// ============================================================

export abstract class BaseClient {
  abstract readonly name: string;
  
  protected logger: Logger;
  protected baseUrl: string;

  constructor(baseUrl: string, logger: Logger) {
    this.baseUrl = baseUrl;
    this.logger = logger;
  }

  /**
   * 健康检查
   */
  abstract healthCheck(): Promise<{ healthy: boolean; message: string }>;
}