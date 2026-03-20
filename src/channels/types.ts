/**
 * Channels 层类型定义
 * 
 * 参考 OpenClaw ChannelPlugin 设计
 * 职责：统一不同消息平台的接口
 */

// ============================================================
// 基础类型
// ============================================================

/** 渠道类型 */
export type ChannelType = 'feishu' | 'dingtalk' | 'wecom' | 'slack';

/** 消息来源 */
export interface MessageSource {
  /** 渠道 ID */
  channelId: string;
  /** 渠道类型 */
  channelType?: ChannelType;
  /** 会话 ID (聊天 ID) */
  chatId: string;
  /** 用户 ID */
  userId: string;
  /** 消息 ID */
  messageId: string;
  /** 发送者 ID (可能是不同的用户) */
  senderId?: string;
  /** 聊天类型 */
  chatType: 'p2p' | 'group';
}

/** 标准化消息 */
export interface StandardMessage {
  /** 消息来源 */
  source: MessageSource;
  /** 消息内容 */
  content: {
    text?: string;
    media?: MediaPayload[];
  };
  /** 原始数据 (平台特定) */
  raw?: unknown;
}

/** 媒体负载 */
export interface MediaPayload {
  type: 'image' | 'video' | 'audio' | 'file';
  url: string;
  name?: string;
  size?: number;
}

/** 卡片动作 */
export interface CardAction {
  action: string;
  label: string;
  style?: 'primary' | 'danger' | 'default';
}

/** 审批卡片 */
export interface ApprovalCard {
  type: 'approval';
  title: string;
  content: string;
  actions: CardAction[];
  metadata: {
    tool: string;
    args: Record<string, unknown>;
    requestId: string;
  };
}

// ============================================================
// 适配器接口
// ============================================================

/** 消息发送适配器 */
export interface OutboundAdapter {
  /** 发送文本消息 */
  sendText(chatId: string, text: string, options?: { replyTo?: string }): Promise<{ ok: boolean; messageId?: string }>;
  
  /** 发送卡片 */
  sendCard?(chatId: string, card: unknown): Promise<{ ok: boolean; messageId?: string }>;
  
  /** 发送媒体 */
  sendMedia?(chatId: string, media: MediaPayload, text?: string): Promise<{ ok: boolean; messageId?: string }>;
  
  /** 添加表情回应 */
  addReaction?(chatId: string, messageId: string, emoji: string): Promise<boolean>;
}

/** 认证适配器 */
export interface AuthAdapter {
  /** 登录 */
  login(): Promise<void>;
  
  /** 登出 */
  logout(): Promise<void>;
  
  /** 检查是否已认证 */
  isAuthenticated(): boolean;
}

/** 安全策略适配器 */
export interface SecurityAdapter {
  /** 检查 DM 权限 */
  checkDM?(userId: string): boolean;
  
  /** 检查白名单 */
  checkWhitelist?(chatId: string): boolean;
  
  /** 检查群组权限 */
  checkGroup?(chatId: string): boolean;
}

/** 生命周期适配器 */
export interface LifecycleAdapter {
  /** 启动 */
  start(): Promise<void>;
  
  /** 停止 */
  stop(): Promise<void>;
  
  /** 健康检查 */
  healthCheck(): Promise<{ healthy: boolean; message: string; details?: Record<string, unknown> }>;
}

// ============================================================
// Channel Plugin 接口
// ============================================================

/** Channel 插件接口 */
export interface ChannelPlugin {
  /** 渠道 ID */
  id: string;
  
  /** 渠道类型 */
  type: ChannelType;
  
  /** 渠道名称 */
  name: string;
  
  /** 消息发送 */
  outbound: OutboundAdapter;
  
  /** 认证 (可选) */
  auth?: AuthAdapter;
  
  /** 安全策略 (可选) */
  security?: SecurityAdapter;
  
  /** 生命周期 */
  lifecycle: LifecycleAdapter;
  
  /** 注册消息处理器 */
  onMessage(handler: MessageHandler): void;
  
  /** 注册交互处理器 */
  onInteraction?(handler: InteractionHandler): void;
}

/** 消息处理器 */
export type MessageHandler = (message: StandardMessage) => Promise<void>;

/** 交互处理器 */
export type InteractionHandler = (event: InteractionEvent) => Promise<InteractionResult>;

/** 交互事件 */
export interface InteractionEvent {
  /** 渠道 ID */
  channelId: string;
  /** 用户 ID */
  userId: string;
  /** 聊天 ID */
  chatId: string;
  /** 消息 ID */
  messageId: string;
  /** 动作 */
  action: string;
  /** 动作值 */
  value: Record<string, unknown>;
}

/** 交互结果 */
export interface InteractionResult {
  /** Toast 提示 */
  toast?: {
    type: 'success' | 'error' | 'info' | 'warning';
    content: string;
  };
  /** 更新的卡片 */
  card?: unknown;
}

// ============================================================
// 工厂类型
// ============================================================

/** Channel 配置 */
export interface ChannelConfig {
  id: string;
  type: ChannelType;
  enabled: boolean;
  [key: string]: unknown;
}

/** Channel 工厂函数 */
export type ChannelFactory<TConfig extends ChannelConfig = ChannelConfig> = (
  config: TConfig,
  logger: Logger
) => ChannelPlugin;

/** 日志接口 */
export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}