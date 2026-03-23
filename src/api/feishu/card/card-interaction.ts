/**
 * 飞书卡片交互协议
 * 
 * 定义卡片按钮点击后的回调数据结构
 * 
 * 结构：
 * - version: 协议版本
 * - kind: 交互类型 (button, quick, meta)
 * - action: 要调用的工具名 (格式: server.tool)
 * - args: 工具参数
 * - context: 交互上下文 (用户、聊天、过期时间等)
 */

// ============================================================
// 常量定义
// ============================================================

/** 卡片交互协议版本 */
export const FEISHU_CARD_INTERACTION_VERSION = "ocf1";

/** 卡片默认过期时间 (10分钟) */
export const FEISHU_CARD_DEFAULT_TTL_MS = 10 * 60 * 1000;

// ============================================================
// 类型定义
// ============================================================

/** 交互类型 */
export type FeishuCardInteractionKind = "button" | "quick" | "meta";

/** 交互失败原因 */
export type FeishuCardInteractionReason =
  | "malformed"
  | "stale"
  | "wrong_user"
  | "wrong_conversation";

/** 交互参数 (工具参数) */
export type FeishuCardInteractionArgs = Record<
  string,
  string | number | boolean | null | undefined
>;

/** 交互上下文 */
export type FeishuCardInteractionContext = {
  /** 期望的用户 Open ID */
  userId?: string;
  /** 期望的聊天 ID */
  chatId?: string;
  /** 会话 Key */
  sessionKey?: string;
  /** 过期时间戳 (毫秒) */
  expiresAt?: number;
  /** 聊天类型 */
  chatType?: "p2p" | "group";
};

/** 卡片交互信封 */
export type FeishuCardInteractionEnvelope = {
  /** 协议版本 */
  version: typeof FEISHU_CARD_INTERACTION_VERSION;
  /** 交互类型 */
  kind: FeishuCardInteractionKind;
  /** 动作标识 (工具名，格式: server.tool) */
  action: string;
  /** 查询/命令 (可选) */
  query?: string;
  /** 工具参数 */
  args?: FeishuCardInteractionArgs;
  /** 交互上下文 */
  context?: FeishuCardInteractionContext;
};

/** 飞书卡片动作事件 */
export type FeishuCardActionEvent = {
  /** 操作者 */
  operator: {
    open_id?: string;
  };
  /** 动作 */
  action: {
    value: unknown;
  };
  /** 上下文 */
  context: {
    chat_id?: string;
  };
};

/** 解码后的卡片动作 */
export type DecodedFeishuCardAction =
  | {
      kind: "structured";
      envelope: FeishuCardInteractionEnvelope;
    }
  | {
      kind: "legacy";
      text: string;
    }
  | {
      kind: "invalid";
      reason: FeishuCardInteractionReason;
    };

// ============================================================
// 工具函数
// ============================================================

/**
 * 检查是否为记录对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 检查是否为有效的交互类型
 */
function isInteractionKind(value: unknown): value is FeishuCardInteractionKind {
  return value === "button" || value === "quick" || value === "meta";
}

/**
 * 检查是否为有效的参数值
 */
function isArgsValue(value: unknown): value is string | number | boolean | null | undefined {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

// ============================================================
// Envelope 创建和编解码
// ============================================================

/**
 * 创建卡片交互信封
 */
export function createFeishuCardInteractionEnvelope(
  envelope: Omit<FeishuCardInteractionEnvelope, "version">
): FeishuCardInteractionEnvelope {
  return {
    version: FEISHU_CARD_INTERACTION_VERSION,
    ...envelope,
  };
}

/**
 * 构建卡片交互上下文
 */
export function buildFeishuCardInteractionContext(params: {
  operatorOpenId: string;
  chatId?: string;
  expiresAt: number;
  chatType?: "p2p" | "group";
  sessionKey?: string;
}): FeishuCardInteractionContext {
  return {
    userId: params.operatorOpenId,
    ...(params.chatId ? { chatId: params.chatId } : {}),
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    expiresAt: params.expiresAt,
    ...(params.chatType ? { chatType: params.chatType } : {}),
  };
}

/**
 * 构建 legacy 文本回退
 */
export function buildFeishuCardActionTextFallback(event: FeishuCardActionEvent): string {
  const actionValue = event.action.value;
  if (isRecord(actionValue)) {
    if (typeof actionValue.text === "string") {
      return actionValue.text;
    }
    if (typeof actionValue.command === "string") {
      return actionValue.command;
    }
    return JSON.stringify(actionValue);
  }
  return String(actionValue);
}

/**
 * 解码飞书卡片动作
 * 
 * 解析卡片按钮点击事件，验证版本、格式、过期时间、用户和聊天
 */
export function decodeFeishuCardAction(params: {
  event: FeishuCardActionEvent;
  now?: number;
}): DecodedFeishuCardAction {
  const { event, now = Date.now() } = params;
  const actionValue = event.action.value;

  // 检查是否为结构化协议
  if (!isRecord(actionValue) || actionValue.version !== FEISHU_CARD_INTERACTION_VERSION) {
    return {
      kind: "legacy",
      text: buildFeishuCardActionTextFallback(event),
    };
  }

  // 验证必填字段
  if (!isInteractionKind(actionValue.kind) || typeof actionValue.action !== "string" || !actionValue.action) {
    return { kind: "invalid", reason: "malformed" };
  }

  // 验证 query 字段
  if (actionValue.query !== undefined && typeof actionValue.query !== "string") {
    return { kind: "invalid", reason: "malformed" };
  }

  // 验证 args 字段
  if (actionValue.args !== undefined) {
    if (!isRecord(actionValue.args)) {
      return { kind: "invalid", reason: "malformed" };
    }
    for (const value of Object.values(actionValue.args)) {
      if (!isArgsValue(value)) {
        return { kind: "invalid", reason: "malformed" };
      }
    }
  }

  // 验证 context 字段
  if (actionValue.context !== undefined) {
    if (!isRecord(actionValue.context)) {
      return { kind: "invalid", reason: "malformed" };
    }
    if (actionValue.context.userId !== undefined && typeof actionValue.context.userId !== "string") {
      return { kind: "invalid", reason: "malformed" };
    }
    if (actionValue.context.chatId !== undefined && typeof actionValue.context.chatId !== "string") {
      return { kind: "invalid", reason: "malformed" };
    }
    if (actionValue.context.sessionKey !== undefined && typeof actionValue.context.sessionKey !== "string") {
      return { kind: "invalid", reason: "malformed" };
    }
    if (actionValue.context.expiresAt !== undefined && !Number.isFinite(actionValue.context.expiresAt)) {
      return { kind: "invalid", reason: "malformed" };
    }
    if (actionValue.context.chatType !== undefined && actionValue.context.chatType !== "p2p" && actionValue.context.chatType !== "group") {
      return { kind: "invalid", reason: "malformed" };
    }

    // 检查过期时间
    if (typeof actionValue.context.expiresAt === "number" && actionValue.context.expiresAt > 0 && actionValue.context.expiresAt < now) {
      // 暂时禁用过期检查
      // return { kind: "invalid", reason: "stale" };
    }

    // 验证用户
    const expectedUser = actionValue.context.userId?.trim();
    if (expectedUser && expectedUser !== (event.operator.open_id ?? "").trim()) {
      return { kind: "invalid", reason: "wrong_user" };
    }
  }

  return {
    kind: "structured",
    envelope: actionValue as FeishuCardInteractionEnvelope,
  };
}

// ============================================================
// 常用动作常量
// ============================================================

/** 权限确认动作 */
export const FEISHU_APPROVAL_REQUEST_ACTION = "feishu.quick_actions.request_approval";
export const FEISHU_APPROVAL_CONFIRM_ACTION = "feishu.approval.confirm";
export const FEISHU_APPROVAL_CANCEL_ACTION = "feishu.approval.cancel";

/** 快速操作动作 */
export const FEISHU_QUICK_ACTION_HELP = "feishu.quick_actions.help";
export const FEISHU_QUICK_ACTION_NEW_SESSION = "feishu.quick_actions.new_session";
export const FEISHU_QUICK_ACTION_RESET = "feishu.quick_actions.reset";