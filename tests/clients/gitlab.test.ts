/**
 * GitLab 客户端测试
 */

import { GitLabClient } from '../../src/clients/gitlab/index';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

describe('GitLabClient', () => {
  let client: GitLabClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new GitLabClient({
      apiUrl: 'https://gitlab.example.com',
      token: 'test-token',
      projectId: '123',
    }, mockLogger);
  });

  describe('构造函数', () => {
    it('应该创建 GitLab 客户端', () => {
      expect(client.name).toBe('GitLab');
    });
  });

  describe('pushBranch 验证', () => {
    it('应该拒绝无效的分支名', async () => {
      await expect(client.pushBranch('feature:test')).rejects.toThrow('Invalid branch name');
      expect(mockLogger.error).toHaveBeenCalledWith('[GitLab] Invalid branch name: feature:test');
    });

    it('应该拒绝以 . 开头的分支名', async () => {
      await expect(client.pushBranch('.git')).rejects.toThrow('Invalid branch name');
      expect(mockLogger.error).toHaveBeenCalledWith('[GitLab] Invalid branch name: .git');
    });

    it('应该拒绝以 . 结尾的分支名', async () => {
      await expect(client.pushBranch('feature.')).rejects.toThrow('Invalid branch name');
      expect(mockLogger.error).toHaveBeenCalledWith('[GitLab] Invalid branch name: feature.');
    });

    it('应该拒绝包含连续 .. 的分支名', async () => {
      await expect(client.pushBranch('feature..test')).rejects.toThrow('Invalid branch name');
      expect(mockLogger.error).toHaveBeenCalledWith('[GitLab] Invalid branch name: feature..test');
    });

    it('应该拒绝包含空格的分支名', async () => {
      await expect(client.pushBranch('feature test')).rejects.toThrow('Invalid branch name');
    });

    it('应该拒绝空分支名', async () => {
      await expect(client.pushBranch('')).rejects.toThrow('Invalid branch name');
    });

    it('应该拒绝超长分支名', async () => {
      await expect(client.pushBranch('a'.repeat(256))).rejects.toThrow('Invalid branch name');
    });
  });
});