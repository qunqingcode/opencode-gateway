/**
 * 通用 HTTP 客户端
 * 
 * 统一处理：
 * - HTTP/HTTPS 请求
 * - 超时控制
 * - 错误处理
 * - Token 认证
 * - 自签名证书支持
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

// ============================================================
// 配置
// ============================================================

export interface HttpClientConfig {
  /** 基础 URL */
  baseUrl: string;
  /** 请求超时（毫秒），默认 30000 */
  timeout?: number;
  /** 认证 Token */
  token?: string;
  /** Token 放置位置 */
  tokenLocation?: 'header' | 'query' | 'private-token';
  /** Token Header 名称 */
  tokenHeader?: string;
  /** 是否允许自签名证书 */
  allowSelfSignedCert?: boolean;
  /** 默认请求头 */
  defaultHeaders?: Record<string, string>;
}

// ============================================================
// 响应类型
// ============================================================

export interface HttpResponse<T = unknown> {
  /** 响应数据 */
  data: T;
  /** HTTP 状态码 */
  statusCode: number;
  /** 响应头 */
  headers: http.IncomingHttpHeaders;
}

export interface HttpError extends Error {
  /** HTTP 状态码 */
  statusCode?: number;
  /** 响应体 */
  body?: unknown;
}

// ============================================================
// HTTP 客户端
// ============================================================

export class HttpClient {
  private readonly config: Required<Pick<HttpClientConfig, 'baseUrl' | 'timeout' | 'allowSelfSignedCert'>> & HttpClientConfig;

  constructor(config: HttpClientConfig) {
    this.config = {
      timeout: 30000,
      tokenLocation: 'header',
      tokenHeader: 'Authorization',
      allowSelfSignedCert: false,
      defaultHeaders: {},
      ...config,
    };
  }

  /**
   * GET 请求
   */
  async get<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
    const query = params ? `?${new URLSearchParams(params).toString()}` : '';
    const response = await this.request<T>('GET', `${path}${query}`);
    return response.data;
  }

  /**
   * POST 请求
   */
  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const response = await this.request<T>('POST', path, body);
    return response.data;
  }

  /**
   * PUT 请求
   */
  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    const response = await this.request<T>('PUT', path, body);
    return response.data;
  }

  /**
   * DELETE 请求
   */
  async delete<T = unknown>(path: string): Promise<T> {
    const response = await this.request<T>('DELETE', path);
    return response.data;
  }

  /**
   * 通用请求方法
   */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<HttpResponse<T>> {
    const url = new URL(`${this.config.baseUrl.replace(/\/+$/, '')}${path}`);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    const postData = body ? JSON.stringify(body) : undefined;

    // 构建请求头
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      ...this.config.defaultHeaders,
    };

    // 添加 Token
    if (this.config.token) {
      switch (this.config.tokenLocation) {
        case 'private-token':
          headers['PRIVATE-TOKEN'] = this.config.token;
          break;
        case 'query':
          // 通过 query 参数传递，在 URL 中处理
          break;
        case 'header':
        default:
          headers[this.config.tokenHeader!] = this.config.token;
          break;
      }
    }

    if (postData) {
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
      };

      // HTTPS 自签名证书支持
      if (isHttps && this.config.allowSelfSignedCert) {
        options.agent = new https.Agent({
          rejectUnauthorized: false,
        });
      }

      const req = httpModule.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          // 空响应处理
          if (!data || data.trim() === '') {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve({
                data: {} as T,
                statusCode: res.statusCode,
                headers: res.headers,
              });
            } else {
              const error: HttpError = new Error(`HTTP ${res.statusCode}: Empty response`);
              error.statusCode = res.statusCode;
              reject(error);
            }
            return;
          }

          try {
            const parsed = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve({
                data: parsed as T,
                statusCode: res.statusCode,
                headers: res.headers,
              });
            } else {
              const error: HttpError = new Error(
                parsed.message || parsed.error || `HTTP ${res.statusCode}`
              );
              error.statusCode = res.statusCode;
              error.body = parsed;
              reject(error);
            }
          } catch {
            const error: HttpError = new Error(`Failed to parse response: ${data.substring(0, 100)}`);
            error.statusCode = res.statusCode;
            reject(error);
          }
        });
      });

      req.on('error', (err) => {
        const error: HttpError = new Error(`Request failed: ${err.message}`);
        reject(error);
      });

      req.setTimeout(this.config.timeout, () => {
        req.destroy();
        const error: HttpError = new Error(`Request timeout after ${this.config.timeout}ms`);
        reject(error);
      });

      if (postData) req.write(postData);
      req.end();
    });
  }

  /**
   * 更新 Token
   */
  setToken(token: string): void {
    this.config.token = token;
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createHttpClient(config: HttpClientConfig): HttpClient {
  return new HttpClient(config);
}