/**
 * 客户端层导出
 * 
 * 纯 API 封装，无业务逻辑，无状态
 * 
 * 区分：
 * - clients/ = 纯 API 客户端
 * - channels/ = IM 渠道（有连接、有状态）
 */

// GitLab
export { GitLabClient, type GitLabClientConfig } from './gitlab';

// 禅道
export { ZentaoClient, type ZentaoClientConfig } from './zentao';