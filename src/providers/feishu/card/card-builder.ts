/**
 * 飞书卡片构建器 (V2 Schema)
 * 
 * 提供流畅的 API 来构建飞书卡片
 * 
 * 核心功能：
 * - 链式调用构建卡片
 * - 支持各种卡片元素：Markdown、Button、Divider、Note 等
 * - 支持交互按钮
 * - 支持卡片头部和配置
 * 
 * 注意：使用 V2 Schema，按钮直接作为元素，不使用 action 包装
 */

import type { FeishuCardInteractionEnvelope } from "./card-interaction.js";

// ============================================================
// 卡片颜色模板
// ============================================================

/** 支持的卡片颜色模板 */
const FEISHU_CARD_TEMPLATES = new Set([
  "blue",
  "green",
  "red",
  "orange",
  "purple",
  "indigo",
  "wathet",
  "turquoise",
  "yellow",
  "grey",
  "carmine",
  "violet",
  "lime",
]);

/**
 * 解析卡片颜色模板
 */
export function resolveFeishuCardTemplate(template?: string): string | undefined {
  if (!template) return undefined;
  const normalized = template.toLowerCase();
  return FEISHU_CARD_TEMPLATES.has(normalized) ? normalized : undefined;
}

// ============================================================
// 类型定义
// ============================================================

/** 卡片元素 - V1 Schema */
export type CardElement =
  | { tag: "markdown"; content: string }
  | { tag: "div"; text?: { tag: "plain_text" | "lark_md"; content: string } }
  | { tag: "hr" }
  | { tag: "button"; text: { tag: "plain_text"; content: string }; type?: "default" | "primary" | "danger"; value?: FeishuCardInteractionEnvelope | Record<string, unknown> }
  | { tag: "note"; elements: CardElement[] }
  | { tag: "img"; img_key: string; alt?: { tag: "plain_text"; content: string } }
  | { tag: "chart"; chart_key: string }
  | { tag: "action"; actions: CardAction[] };

/** 卡片动作 */
export type CardAction = {
  tag: "button";
  text: { tag: "plain_text"; content: string };
  type?: "default" | "primary" | "danger";
  value: FeishuCardInteractionEnvelope | Record<string, unknown>;
};

/** 卡片头部 */
export type CardHeader = {
  title: { tag: "plain_text"; content: string };
  template?: string;
  subtitle?: { tag: "plain_text"; content: string };
};

/** 卡片配置 */
export type CardConfig = {
  wide_screen_mode?: boolean;
  enable_forward?: boolean;
  update_multi?: boolean;
};

/** 完整卡片 - V1 Schema */
export type FeishuCard = {
  config?: CardConfig;
  header?: CardHeader;
  elements: CardElement[];
};

/** 按钮类型 */
export type ButtonType = "default" | "primary" | "danger";

/** 颜色模板 */
export type CardTemplate =
  | "blue"
  | "green"
  | "red"
  | "orange"
  | "purple"
  | "indigo"
  | "wathet"
  | "turquoise"
  | "yellow"
  | "grey"
  | "carmine"
  | "violet"
  | "lime";

// ============================================================
// 卡片构建器类
// ============================================================

/**
 * 飞书卡片构建器
 * 
 * 使用链式调用构建卡片
 * 
 * @example
 * ```ts
 * const card = new FeishuCardBuilder()
 *   .header("通知", "blue")
 *   .markdown("**重要**: 请确认操作")
 *   .actionRow()
 *     .button("确认", "primary", envelope)
 *     .button("取消", "danger", cancelEnvelope)
 *     .build()
 *   .build();
 * ```
 */
export class FeishuCardBuilder {
  private config: CardConfig = { wide_screen_mode: true };
  private header?: CardHeader;
  private elements: CardElement[] = [];

  /**
   * 设置卡片配置
   */
  setConfig(config: Partial<CardConfig>): this {
    this.config = { ...this.config, ...config };
    return this;
  }

  /**
   * 设置卡片头部
   */
  setHeader(title: string, template?: CardTemplate | string, subtitle?: string): this {
    this.header = {
      title: { tag: "plain_text", content: title },
      ...(template ? { template: resolveFeishuCardTemplate(template) ?? "blue" } : {}),
      ...(subtitle ? { subtitle: { tag: "plain_text", content: subtitle } } : {}),
    };
    return this;
  }

  /**
   * 添加 Markdown 元素
   */
  addMarkdown(content: string): this {
    this.elements.push({ tag: "markdown", content });
    return this;
  }

  /**
   * 添加分隔线
   */
  addDivider(): this {
    this.elements.push({ tag: "hr" });
    return this;
  }

  /**
   * 添加图片
   */
  addImage(imgKey: string, alt?: string): this {
    this.elements.push({
      tag: "img",
      img_key: imgKey,
      ...(alt ? { alt: { tag: "plain_text", content: alt } } : {}),
    });
    return this;
  }

  /**
   * 添加图表
   */
  addChart(chartKey: string): this {
    this.elements.push({ tag: "chart", chart_key: chartKey });
    return this;
  }

  /**
   * 添加按钮行（V1 Schema 兼容：按钮需要放在 action 容器中）
   * 注意：飞书卡片要求按钮放在 tag: "action" 的容器中，不能直接作为 elements
   */
  addActionRow(actions: CardAction[]): this {
    if (actions.length > 0) {
      // V1 兼容：将按钮包装在 action 容器中
      this.elements.push({
        tag: "action" as const,
        actions: actions.map(action => ({
          tag: "button" as const,
          text: action.text,
          type: action.type,
          value: action.value,
        })),
      } as CardElement);
    }
    return this;
  }

  /**
   * 添加 Note
   */
  addNote(content: string): this {
    this.elements.push({
      tag: "note",
      elements: [{ tag: "markdown", content: `<font color="grey">${content}</font>` }],
    });
    return this;
  }

  /**
   * 构建卡片
   */
  build(): FeishuCard {
    const card: FeishuCard = {
      elements: this.elements,
    };

    if (Object.keys(this.config).length > 0) {
      card.config = this.config;
    }

    if (this.header) {
      card.header = this.header;
    }

    return card;
  }

  /**
   * 构建 JSON 字符串
   */
  buildJson(): string {
    return JSON.stringify(this.build());
  }

  /**
   * 重置构建器
   */
  reset(): this {
    this.config = { wide_screen_mode: true };
    this.header = undefined;
    this.elements = [];
    return this;
  }
}

// ============================================================
// 动作构建器类
// ============================================================

/**
 * 动作行构建器
 * 
 * 用于构建卡片中的按钮行
 */
export class ActionBuilder {
  private actions: CardAction[] = [];

  /**
   * 添加按钮
   */
  addButton(
    label: string,
    type: ButtonType,
    value: FeishuCardInteractionEnvelope | Record<string, unknown>
  ): this {
    this.actions.push({
      tag: "button",
      text: { tag: "plain_text", content: label },
      type,
      value,
    });
    return this;
  }

  /**
   * 添加默认按钮
   */
  addDefaultButton(label: string, value: FeishuCardInteractionEnvelope | Record<string, unknown>): this {
    return this.addButton(label, "default", value);
  }

  /**
   * 添加主要按钮
   */
  addPrimaryButton(label: string, value: FeishuCardInteractionEnvelope | Record<string, unknown>): this {
    return this.addButton(label, "primary", value);
  }

  /**
   * 添加危险按钮
   */
  addDangerButton(label: string, value: FeishuCardInteractionEnvelope | Record<string, unknown>): this {
    return this.addButton(label, "danger", value);
  }

  /**
   * 构建动作数组
   */
  build(): CardAction[] {
    return this.actions;
  }

  /**
   * 重置
   */
  reset(): this {
    this.actions = [];
    return this;
  }
}

// ============================================================
// 便捷函数
// ============================================================

/**
 * 构建飞书卡片按钮
 */
export function buildFeishuCardButton(params: {
  label: string;
  value: FeishuCardInteractionEnvelope | Record<string, unknown>;
  type?: ButtonType;
}): CardAction {
  return {
    tag: "button",
    text: { tag: "plain_text", content: params.label },
    type: params.type ?? "default",
    value: params.value,
  };
}

/**
 * 快速创建简单文本卡片
 */
export function createTextCard(title: string, content: string, template?: CardTemplate): FeishuCard {
  return new FeishuCardBuilder()
    .setHeader(title, template)
    .addMarkdown(content)
    .build();
}

/**
 * 快速创建确认卡片
 */
export function createConfirmCard(params: {
  title: string;
  content: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmValue: FeishuCardInteractionEnvelope | Record<string, unknown>;
  cancelValue: FeishuCardInteractionEnvelope | Record<string, unknown>;
  template?: CardTemplate;
}): FeishuCard {
  const actionBuilder = new ActionBuilder()
    .addPrimaryButton(params.confirmLabel ?? "确认", params.confirmValue)
    .addDangerButton(params.cancelLabel ?? "取消", params.cancelValue);

  return new FeishuCardBuilder()
    .setHeader(params.title, params.template ?? "orange")
    .addMarkdown(params.content)
    .addActionRow(actionBuilder.build())
    .build();
}

/**
 * 快速创建列表卡片
 */
export function createListCard(params: {
  title: string;
  items: string[];
  template?: CardTemplate;
}): FeishuCard {
  const builder = new FeishuCardBuilder()
    .setHeader(params.title, params.template ?? "blue");

  for (const item of params.items) {
    builder.addMarkdown(`• ${item}`);
  }

  return builder.build();
}