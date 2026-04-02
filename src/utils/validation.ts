/**
 * 输入验证工具
 *
 * 提供常用的输入验证函数，防止安全风险
 */

// ============================================================
// 验证函数
// ============================================================

/**
 * 验证 Git 分支名
 *
 * Git 分支命名规则：
 * - 不能以 . 开头或结尾
 * - 不能包含连续的 ..
 * - 不能包含 : ? * [ ~ ^ @ 等特殊字符
 * - 不能包含空格或控制字符
 *
 * @param name 分支名
 * @returns 是否有效
 */
export function isValidGitBranchName(name: string): boolean {
  if (!name || name.length === 0 || name.length > 255) {
    return false;
  }

  // 不能以 . 开头或结尾
  if (name.startsWith('.') || name.endsWith('.')) {
    return false;
  }

  // 不能包含连续的 ..
  if (name.includes('..')) {
    return false;
  }

  // 允许的字符：字母、数字、_、-、/、.、中文
  const pattern = /^[a-zA-Z0-9_\-/.\u4e00-\u9fa5]+$/;
  return pattern.test(name);
}

/**
 * 验证 URL
 *
 * @param url URL 字符串
 * @param protocols 允许的协议（默认 http/https）
 * @returns 是否有效
 */
export function isValidUrl(url: string, protocols: string[] = ['http:', 'https:']): boolean {
  try {
    const parsed = new URL(url);
    return protocols.includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * 验证 Bug/Issue ID
 *
 * @param id Bug ID
 * @returns 是否有效
 */
export function isValidBugId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
}

/**
 * 验证用户 ID（如飞书 open_id）
 *
 * @param userId 用户 ID
 * @returns 是否有效
 */
export function isValidUserId(userId: string): boolean {
  // 飞书 open_id 通常是 18-32 位字母数字下划线或连字符
  const pattern = /^[a-zA-Z0-9_-]{18,32}$/;
  return pattern.test(userId);
}

/**
 * 验证 Chat ID
 *
 * @param chatId Chat ID
 * @returns 是否有效
 */
export function isValidChatId(chatId: string): boolean {
  // 飞书 chat_id 通常是 oc_ 开头的字符串
  const pattern = /^oc_[a-zA-Z0-9_-]+$/;
  return pattern.test(chatId);
}

/**
 * 验证文本长度
 *
 * @param text 文本内容
 * @param minLength 最小长度（默认 0）
 * @param maxLength 最大长度（默认 10000）
 * @returns 是否有效
 */
export function isValidTextLength(text: string, minLength = 0, maxLength = 10000): boolean {
  if (typeof text !== 'string') {
    return false;
  }
  return text.length >= minLength && text.length <= maxLength;
}

/**
 * 验证 Cron 表达式
 *
 * @param expr Cron 表达式
 * @returns 是否有效（简单验证）
 */
export function isValidCronExpression(expr: string): boolean {
  if (!expr || typeof expr !== 'string') {
    return false;
  }
  const parts = expr.trim().split(/\s+/);
  // 标准 cron 表达式 5-6 部分
  return parts.length >= 5 && parts.length <= 6;
}

/**
 * 清理和转义 Markdown 文本
 *
 * @param text 原始文本
 * @returns 转义后的文本
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/`/g, '\\`')
    .replace(/#/g, '\\#');
}

/**
 * 清理敏感信息用于日志
 *
 * @param message 原始消息
 * @returns 清理后的消息
 */
export function sanitizeForLog(message: string): string {
  return message
    .replace(/(token|password|secret|key)=["']?[^"'\s]+["']?/gi, '$1=***')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+/gi, 'Bearer ***')
    .replace(/PRIVATE-TOKEN:\s*[A-Za-z0-9\-._~+/]+/gi, 'PRIVATE-TOKEN: ***');
}

// ============================================================
// 验证错误类
// ============================================================

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ============================================================
// 验证器类
// ============================================================

export class InputValidator {
  /**
   * 验证 Git 分支名
   */
  static validateBranchName(name: string, fieldName = 'branchName'): void {
    if (!isValidGitBranchName(name)) {
      throw new ValidationError(
        `Invalid ${fieldName}: ${name}`,
        fieldName,
        name
      );
    }
  }

  /**
   * 验证 URL
   */
  static validateUrl(url: string, fieldName = 'url', protocols: string[] = ['http:', 'https:']): void {
    if (!isValidUrl(url, protocols)) {
      throw new ValidationError(
        `Invalid ${fieldName}: ${url}`,
        fieldName,
        url
      );
    }
  }

  /**
   * 验证 Bug ID
   */
  static validateBugId(id: number, fieldName = 'bugId'): void {
    if (!isValidBugId(id)) {
      throw new ValidationError(
        `Invalid ${fieldName}: ${id}`,
        fieldName,
        id
      );
    }
  }

  /**
   * 验证文本长度
   */
  static validateTextLength(
    text: string,
    fieldName = 'text',
    minLength = 0,
    maxLength = 10000
  ): void {
    if (!isValidTextLength(text, minLength, maxLength)) {
      throw new ValidationError(
        `${fieldName} must be between ${minLength} and ${maxLength} characters`,
        fieldName,
        text
      );
    }
  }

  /**
   * 批量验证
   */
  static validateAll(validators: Array<() => void>): void {
    const errors: ValidationError[] = [];

    for (const validator of validators) {
      try {
        validator();
      } catch (error) {
        if (error instanceof ValidationError) {
          errors.push(error);
        } else {
          throw error;
        }
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Validation failed with ${errors.length} error(s)`
      );
    }
  }
}