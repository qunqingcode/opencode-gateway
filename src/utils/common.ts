/**
 * 通用工具函数
 */

// ============================================================
// ID 生成
// ============================================================

/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 生成带前缀的 ID
 */
export function generatePrefixedId(prefix: string): string {
  return `${prefix}_${generateId()}`;
}

// ============================================================
// 延迟
// ============================================================

/**
 * 延迟执行
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 重试
// ============================================================

/**
 * 重试函数
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delay?: number;
    backoff?: boolean;
  } = {}
): Promise<T> {
  const { maxAttempts = 3, delay = 1000, backoff = true } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxAttempts) {
        const waitTime = backoff ? delay * attempt : delay;
        await sleep(waitTime);
      }
    }
  }

  throw lastError;
}

// ============================================================
// 超时
// ============================================================

/**
 * 带超时的 Promise
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = 'Timeout'
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

// ============================================================
// 类型检查
// ============================================================

/**
 * 检查是否为对象
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 检查是否为数组
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * 检查是否为字符串
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * 检查是否为数字
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}