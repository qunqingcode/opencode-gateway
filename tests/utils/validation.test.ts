/**
 * 输入验证工具测试
 */

import {
  isValidGitBranchName,
  isValidUrl,
  isValidBugId,
  isValidUserId,
  isValidChatId,
  isValidTextLength,
  isValidCronExpression,
  escapeMarkdown,
  sanitizeForLog,
  ValidationError,
  InputValidator,
} from '../../src/utils/validation';

describe('输入验证工具', () => {
  describe('isValidGitBranchName', () => {
    it('应该接受有效的分支名', () => {
      expect(isValidGitBranchName('main')).toBe(true);
      expect(isValidGitBranchName('develop')).toBe(true);
      expect(isValidGitBranchName('feature/add-login')).toBe(true);
      expect(isValidGitBranchName('fix/bug-123')).toBe(true);
      expect(isValidGitBranchName('release/v1.0.0')).toBe(true);
      expect(isValidGitBranchName('hotfix/v1.0.1')).toBe(true);
      expect(isValidGitBranchName('12345')).toBe(true);
      expect(isValidGitBranchName('my_feature')).toBe(true);
    });

    it('应该拒绝无效的分支名', () => {
      expect(isValidGitBranchName('.git')).toBe(false); // 以 . 开头
      expect(isValidGitBranchName('feature.')).toBe(false); // 以 . 结尾
      expect(isValidGitBranchName('feature..test')).toBe(false); // 连续 ..
      expect(isValidGitBranchName('feature:test')).toBe(false); // 包含 :
      expect(isValidGitBranchName('feature?test')).toBe(false); // 包含 ?
      expect(isValidGitBranchName('feature*test')).toBe(false); // 包含 *
      expect(isValidGitBranchName('feature[test')).toBe(false); // 包含 [
      expect(isValidGitBranchName('feature~test')).toBe(false); // 包含 ~
      expect(isValidGitBranchName('feature@test')).toBe(false); // 包含 @
      expect(isValidGitBranchName('feature test')).toBe(false); // 包含空格
      expect(isValidGitBranchName('')).toBe(false); // 空字符串
      expect(isValidGitBranchName('a'.repeat(256))).toBe(false); // 超长
    });
  });

  describe('isValidUrl', () => {
    it('应该接受有效的 URL', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('https://example.com/path')).toBe(true);
      expect(isValidUrl('https://example.com?query=1')).toBe(true);
      expect(isValidUrl('https://example.com#anchor')).toBe(true);
    });

    it('应该拒绝无效的 URL', () => {
      expect(isValidUrl('ftp://example.com')).toBe(false); // 不允许的协议
      expect(isValidUrl('example.com')).toBe(false); // 缺少协议
      expect(isValidUrl('not a url')).toBe(false); // 无效格式
      expect(isValidUrl('')).toBe(false); // 空字符串
      expect(isValidUrl('javascript:alert(1)')).toBe(false); // 危险协议
    });

    it('应该支持自定义协议白名单', () => {
      expect(isValidUrl('http://example.com', ['http:', 'https:'])).toBe(true);
      expect(isValidUrl('ftp://example.com', ['ftp:'])).toBe(true);
      expect(isValidUrl('ftp://example.com', ['http:', 'https:'])).toBe(false);
    });
  });

  describe('isValidBugId', () => {
    it('应该接受有效的 Bug ID', () => {
      expect(isValidBugId(1)).toBe(true);
      expect(isValidBugId(100)).toBe(true);
      expect(isValidBugId(999999)).toBe(true);
    });

    it('应该拒绝无效的 Bug ID', () => {
      expect(isValidBugId(0)).toBe(false);
      expect(isValidBugId(-1)).toBe(false);
      expect(isValidBugId(NaN)).toBe(false);
    });
  });

  describe('isValidUserId', () => {
    it('应该接受有效的用户 ID', () => {
      expect(isValidUserId('ou_1234567890abcdef')).toBe(true);
      expect(isValidUserId('ou_1234567890abcdefghij')).toBe(true);
      expect(isValidUserId('user-123_abc-defghij')).toBe(true);
    });

    it('应该拒绝无效的用户 ID', () => {
      expect(isValidUserId('')).toBe(false);
      expect(isValidUserId('short')).toBe(false);
      expect(isValidUserId('user with spaces')).toBe(false);
      expect(isValidUserId('a'.repeat(33))).toBe(false);
    });
  });

  describe('isValidChatId', () => {
    it('应该接受有效的 Chat ID', () => {
      expect(isValidChatId('oc_1234567890abcdef')).toBe(true);
      expect(isValidChatId('oc_1234567890abcdefghij')).toBe(true);
    });

    it('应该拒绝无效的 Chat ID', () => {
      expect(isValidChatId('')).toBe(false);
      expect(isValidChatId('ou_1234567890abcdef')).toBe(false); // 错误前缀
      expect(isValidChatId('1234567890abcdef')).toBe(false); // 缺少前缀
      expect(isValidChatId('oc_ with spaces')).toBe(false);
    });
  });

  describe('isValidTextLength', () => {
    it('应该接受有效长度的文本', () => {
      expect(isValidTextLength('hello')).toBe(true);
      expect(isValidTextLength('', 0, 100)).toBe(true); // 允许空字符串
      expect(isValidTextLength('a'.repeat(100), 1, 100)).toBe(true);
    });

    it('应该拒绝无效长度的文本', () => {
      expect(isValidTextLength('', 1, 100)).toBe(false); // 不允许空字符串
      expect(isValidTextLength('hello', 10, 100)).toBe(false); // 太短
      expect(isValidTextLength('a'.repeat(101), 1, 100)).toBe(false); // 太长
    });
  });

  describe('isValidCronExpression', () => {
    it('应该接受有效的 Cron 表达式', () => {
      expect(isValidCronExpression('0 * * * *')).toBe(true);
      expect(isValidCronExpression('0 9 * * 1-5')).toBe(true);
      expect(isValidCronExpression('*/5 * * * *')).toBe(true);
      expect(isValidCronExpression('0 0 1 * *')).toBe(true);
      expect(isValidCronExpression('0 0 1 1 *')).toBe(true);
      expect(isValidCronExpression('0 0 * * 0')).toBe(true);
    });

    it('应该接受带秒的 Cron 表达式', () => {
      expect(isValidCronExpression('0 0 * * * *')).toBe(true);
      expect(isValidCronExpression('0 */5 * * * *')).toBe(true);
    });

    it('应该拒绝无效的 Cron 表达式', () => {
      expect(isValidCronExpression('')).toBe(false);
      expect(isValidCronExpression('* * *')).toBe(false); // 太少部分
      expect(isValidCronExpression('* * * * * * *')).toBe(false); // 太多部分
      expect(isValidCronExpression('invalid')).toBe(false);
    });
  });

  describe('escapeMarkdown', () => {
    it('应该转义 Markdown 特殊字符', () => {
      expect(escapeMarkdown('Hello *world*')).toBe('Hello \\*world\\*');
      expect(escapeMarkdown('Test_underscore_')).toBe('Test\\_underscore\\_');
      expect(escapeMarkdown('[link](url)')).toBe('\\[link\\]\\(url\\)');
      expect(escapeMarkdown('`code`')).toBe('\\`code\\`');
      expect(escapeMarkdown('# Heading')).toBe('\\# Heading');
      expect(escapeMarkdown('\\\\backslash')).toBe('\\\\\\\\backslash');
    });

    it('应该正确处理多个特殊字符', () => {
      expect(escapeMarkdown('*Bold_ and `code`*')).toBe('\\*Bold\\_ and \\`code\\`\\*');
    });
  });

  describe('sanitizeForLog', () => {
    it('应该移除敏感信息', () => {
      expect(sanitizeForLog('token=secret123')).toBe('token=***');
      expect(sanitizeForLog('password=mypass')).toBe('password=***');
      expect(sanitizeForLog('secret=key123')).toBe('secret=***');
      expect(sanitizeForLog('api_key=abc123')).toBe('api_key=***');
    });

    it('应该处理 Bearer token', () => {
      expect(sanitizeForLog('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe('Bearer ***');
    });

    it('应该处理 PRIVATE-TOKEN', () => {
      expect(sanitizeForLog('PRIVATE-TOKEN: glpat-abc123')).toBe('PRIVATE-TOKEN: ***');
    });

    it('应该保留非敏感内容', () => {
      expect(sanitizeForLog('User logged in successfully')).toBe('User logged in successfully');
      expect(sanitizeForLog('Request processed')).toBe('Request processed');
    });
  });

  describe('ValidationError', () => {
    it('应该创建验证错误', () => {
      const error = new ValidationError('Invalid value', 'field1', 'bad');
      expect(error.message).toBe('Invalid value');
      expect(error.field).toBe('field1');
      expect(error.value).toBe('bad');
      expect(error.name).toBe('ValidationError');
    });
  });

  describe('InputValidator', () => {
    describe('validateBranchName', () => {
      it('应该接受有效的分支名', () => {
        expect(() => InputValidator.validateBranchName('main')).not.toThrow();
        expect(() => InputValidator.validateBranchName('feature/test')).not.toThrow();
      });

      it('应该抛出错误给无效的分支名', () => {
        expect(() => InputValidator.validateBranchName('.git')).toThrow(ValidationError);
        expect(() => InputValidator.validateBranchName('feature:test')).toThrow(ValidationError);
      });
    });

    describe('validateUrl', () => {
      it('应该接受有效的 URL', () => {
        expect(() => InputValidator.validateUrl('https://example.com')).not.toThrow();
      });

      it('应该抛出错误给无效的 URL', () => {
        expect(() => InputValidator.validateUrl('not a url')).toThrow(ValidationError);
        expect(() => InputValidator.validateUrl('javascript:alert(1)')).toThrow(ValidationError);
      });
    });

    describe('validateBugId', () => {
      it('应该接受有效的 Bug ID', () => {
        expect(() => InputValidator.validateBugId(123)).not.toThrow();
      });

      it('应该抛出错误给无效的 Bug ID', () => {
        expect(() => InputValidator.validateBugId(0)).toThrow(ValidationError);
        expect(() => InputValidator.validateBugId(-1)).toThrow(ValidationError);
      });
    });

    describe('validateTextLength', () => {
      it('应该接受有效长度的文本', () => {
        expect(() => InputValidator.validateTextLength('hello', 'text', 1, 100)).not.toThrow();
      });

      it('应该抛出错误给无效长度的文本', () => {
        expect(() => InputValidator.validateTextLength('', 'text', 1, 100)).toThrow(ValidationError);
        expect(() => InputValidator.validateTextLength('a'.repeat(101), 'text', 1, 100)).toThrow(ValidationError);
      });
    });

    describe('validateAll', () => {
      it('应该通过所有验证', () => {
        expect(() =>
          InputValidator.validateAll([
            () => InputValidator.validateBranchName('main'),
            () => InputValidator.validateUrl('https://example.com'),
            () => InputValidator.validateBugId(123),
          ])
        ).not.toThrow();
      });

      it('应该在验证失败时抛出 AggregateError', () => {
        expect(() =>
          InputValidator.validateAll([
            () => InputValidator.validateBranchName('.git'),
            () => InputValidator.validateUrl('not a url'),
          ])
        ).toThrow(AggregateError);
      });
    });
  });
});