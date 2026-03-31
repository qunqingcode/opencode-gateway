/**
 * 飞书消息发送工具
 * 
 * 提供飞书特有的消息发送能力：
 * - 发送文件
 * - 发送图片
 * - 发送富文本
 */

import type { Logger } from '../types';
import { BaseTool } from './base';
import type { ToolDefinition, ToolResult, ToolContext } from './types';

// ============================================================
// 飞书工具
// ============================================================

export class FeishuTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'feishu',
    description: '飞书消息发送工具：发送文件、图片、富文本',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型: send_file, send_image, send_rich_text',
        },
      },
      required: ['action'],
    },
  };

  constructor(logger: Logger) {
    super(logger);
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = args.action as string;

    switch (action) {
      case 'send_file':
        return this.sendFile(args, context);
      case 'send_image':
        return this.sendImage(args, context);
      case 'send_rich_text':
        return this.sendRichText(args, context);
      default:
        return this.error(`Unknown action: ${action}`);
    }
  }

  // ============================================================
  // 发送文件
  // ============================================================

  private async sendFile(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
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

  // ============================================================
  // 发送图片
  // ============================================================

  private async sendImage(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const imagePath = args.imagePath as string;

    if (!imagePath) {
      return this.error('imagePath is required');
    }

    // 图片可以复用 sendFile，或者用 sendRichText
    if (context.sendFile) {
      await context.sendFile(imagePath);
      return this.success({
        message: `Image sent: ${imagePath}`,
      });
    }

    return this.error('sendImage not supported in current context');
  }

  // ============================================================
  // 发送富文本
  // ============================================================

  private async sendRichText(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
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