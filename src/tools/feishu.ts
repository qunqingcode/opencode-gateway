/**
 * 飞书消息发送工具集
 * 
 * 提供飞书特有的消息发送能力：
 * - 发送文件
 * - 发送图片
 * - 发送富文本
 */

import type { Logger } from '../types';
import { BaseTool } from './base';
import type { ToolDefinition, ToolResult, ToolContext, ITool } from './types';

// ============================================================
// 工具定义
// ============================================================

/** 发送文件 */
class SendFileTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'feishu.send_file',
    description: '发送文件到飞书',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '文件路径' },
      },
      required: ['filePath'],
    },
  };

  constructor(logger: Logger) {
    super(logger);
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = args.filePath as string;

    if (!filePath) {
      return this.error('filePath is required');
    }

    if (!context.sendFile) {
      return this.error('sendFile not supported in current context');
    }

    await context.sendFile(filePath);

    return this.success({
      message: `File sent: ${filePath}`,
    });
  }
}

/** 发送图片 */
class SendImageTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'feishu.send_image',
    description: '发送图片到飞书',
    inputSchema: {
      type: 'object',
      properties: {
        imagePath: { type: 'string', description: '图片路径' },
      },
      required: ['imagePath'],
    },
  };

  constructor(logger: Logger) {
    super(logger);
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const imagePath = args.imagePath as string;

    if (!imagePath) {
      return this.error('imagePath is required');
    }

    // 图片可以复用 sendFile
    if (context.sendFile) {
      await context.sendFile(imagePath);
      return this.success({
        message: `Image sent: ${imagePath}`,
      });
    }

    return this.error('sendImage not supported in current context');
  }
}

/** 发送富文本 */
class SendRichTextTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'feishu.send_rich_text',
    description: '发送富文本消息到飞书（文本+图片）',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '文本内容' },
        images: {
          type: 'array',
          items: { type: 'string' },
          description: '图片路径列表（可选）',
        },
      },
      required: [],
    },
  };

  constructor(logger: Logger) {
    super(logger);
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const text = args.text as string;
    const images = args.images as string[] | undefined;

    if (!text && !images?.length) {
      return this.error('text or images is required');
    }

    if (!context.sendRichText) {
      // 降级：只发送文本
      await context.sendText(text || '');
      return this.success({
        message: 'Rich text sent (fallback to plain text)',
      });
    }

    await context.sendRichText(text || '', images || []);

    return this.success({
      message: 'Rich text sent',
    });
  }
}

// ============================================================
// 工具集工厂
// ============================================================

/**
 * 飞书工具集
 * 
 * 创建所有飞书相关的独立工具
 */
export function createFeishuTools(logger: Logger): ITool[] {
  return [
    new SendFileTool(logger),
    new SendImageTool(logger),
    new SendRichTextTool(logger),
  ];
}