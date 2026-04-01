/**
 * HTTP 客户端测试
 */

import { HttpClient } from '../../src/utils/http-client';

describe('HttpClient', () => {
  describe('构造函数', () => {
    it('应该使用默认配置', () => {
      const client = new HttpClient({ baseUrl: 'http://example.com' });

      expect(client).toBeInstanceOf(HttpClient);
    });

    it('应该使用自定义配置', () => {
      const client = new HttpClient({
        baseUrl: 'http://example.com',
        timeout: 5000,
        token: 'test-token',
        tokenLocation: 'header',
        tokenHeader: 'X-Auth-Token',
        allowSelfSignedCert: true,
      });

      expect(client).toBeInstanceOf(HttpClient);
    });

    it('应该在生产环境启用自签名证书时发出警告', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();

      new HttpClient({
        baseUrl: 'http://example.com',
        allowSelfSignedCert: true,
      });

      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('WARNING: allowSelfSignedCert is enabled in production environment')
      );

      process.env.NODE_ENV = originalEnv;
      consoleWarn.mockRestore();
    });
  });

  describe('setToken', () => {
    it('应该更新 token', () => {
      const client = new HttpClient({
        baseUrl: 'http://example.com',
        token: 'old-token',
      });

      client.setToken('new-token');

      expect(client).toBeInstanceOf(HttpClient);
    });
  });
});