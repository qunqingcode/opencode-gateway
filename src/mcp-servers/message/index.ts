/**
 * Message MCP Server
 * 
 * 提供通用的消息发送能力，适用于所有 Channel（飞书、钉钉等）
 * 
 * 设计理念：
 * - AI 显式调用工具发送文件，而不是依赖网关自动检测
 * - 明确的意图，避免误判
 * - 支持文本、图片、文件、富文本等多种消息类型
 */

import { BaseMCPServer } from '../base';
import { createTool, ToolDefinition } from '../types';
import type { ToolContext } from '../../gateway/types';
import type { Logger } from '../../channels/types';
import { getFileInfo, isImageFile } from '../../utils/file';

// ============================================================
// 配置
// ============================================================

export interface MessageMCPServerConfig {
  /** 文件大小限制（字节），默认 30MB */
  maxFileSize?: number;
}

// ============================================================
// Message MCP Server 实现
// ============================================================

export class MessageMCPServer extends BaseMCPServer {
  readonly name = 'message';
  readonly description = '消息发送工具，支持发送文件、图片、文本到当前对话';

  private maxFileSize: number;

  constructor(config: MessageMCPServerConfig, logger: Logger) {
    super(config as unknown as Record<string, unknown>, logger);
    this.maxFileSize = config.maxFileSize || 30 * 1024 * 1024; // 默认 30MB
    this.registerTools(this.createTools());
  }

  // ============================================================
  // 工具定义
  // ============================================================

  private createTools(): ToolDefinition[] {
    return [
      // ========== 发送文件 ==========
      createTool({
        name: 'send_file',
        description: '发送文件到当前对话。支持图片、PDF、ZIP、截图等。最大 30MB。适用于所有 Channel。',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: '文件的绝对路径。Windows 如 C:/Users/xxx/project/screenshot.png，Unix 如 /home/user/report.pdf',
            },
            caption: {
              type: 'string',
              description: '文件说明（可选），会作为文件的标题或描述显示',
            },
          },
          required: ['file_path'],
        },
        execute: async (args, context: ToolContext) => {
          const filePath = args.file_path as string;
          const caption = args.caption as string | undefined;

          this.logger.info(`[message] send_file: ${filePath}`);

          // 验证文件
          const fileInfo = getFileInfo(filePath);
          if (!fileInfo.exists) {
            return { success: false, error: `文件不存在: ${filePath}` };
          }
          if (!fileInfo.isFile) {
            return { success: false, error: `路径不是文件: ${filePath}` };
          }
          if (fileInfo.size && fileInfo.size > this.maxFileSize) {
            const sizeMB = (fileInfo.size / 1024 / 1024).toFixed(2);
            return { success: false, error: `文件过大 (${sizeMB}MB)，最大支持 30MB` };
          }

          // 检查是否有 sendFile 能力
          if (!context.sendFile) {
            return { success: false, error: '当前 Channel 不支持发送文件' };
          }

          try {
            // 发送文件
            await context.sendFile(filePath);

            // 如果有说明，再发送一条文本消息
            if (caption) {
              await context.sendText(caption);
            }

            const fileType = isImageFile(filePath) ? '图片' : '文件';
            this.logger.info(`[message] ${fileType}发送成功: ${fileInfo.basename}`);

            return {
              success: true,
              output: `✅ ${fileType}已发送: ${fileInfo.basename}`,
            };
          } catch (error) {
            this.logger.error(`[message] 发送失败: ${(error as Error).message}`);
            return {
              success: false,
              error: `发送失败: ${(error as Error).message}`,
            };
          }
        },
      }),

      // ========== 发送图片 ==========
      createTool({
        name: 'send_image',
        description: '发送图片到当前对话。支持 PNG、JPG、GIF、WebP 等常见格式。如果需要同时发送文字和图片，建议使用 send_rich_text。',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: '图片文件的绝对路径',
            },
            caption: {
              type: 'string',
              description: '图片说明（可选）',
            },
          },
          required: ['file_path'],
        },
        execute: async (args, context: ToolContext) => {
          const filePath = args.file_path as string;
          const caption = args.caption as string | undefined;

          this.logger.info(`[message] send_image: ${filePath}`);

          // 验证文件
          const fileInfo = getFileInfo(filePath);
          if (!fileInfo.exists) {
            return { success: false, error: `图片不存在: ${filePath}` };
          }
          if (!isImageFile(filePath)) {
            return { success: false, error: `不是图片文件: ${filePath}。支持格式: png, jpg, jpeg, gif, webp, bmp` };
          }

          // 检查是否有 sendFile 能力
          if (!context.sendFile) {
            return { success: false, error: '当前 Channel 不支持发送图片' };
          }

          try {
            // 发送图片
            await context.sendFile(filePath);

            // 如果有说明，再发送一条文本消息
            if (caption) {
              await context.sendText(caption);
            }

            this.logger.info(`[message] 图片发送成功: ${fileInfo.basename}`);
            return {
              success: true,
              output: `✅ 图片已发送: ${fileInfo.basename}`,
            };
          } catch (error) {
            this.logger.error(`[message] 图片发送失败: ${(error as Error).message}`);
            return {
              success: false,
              error: `发送失败: ${(error as Error).message}`,
            };
          }
        },
      }),

      // ========== 发送富文本 ==========
      createTool({
        name: 'send_rich_text',
        description: '发送富文本消息（文本 + 图片在一条消息里）。适用于需要图文并茂的场景。',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: '文本内容',
            },
            images: {
              type: 'array',
              items: { type: 'string' },
              description: '图片文件的绝对路径数组，支持多张图片',
            },
          },
          required: ['text'],
        },
        execute: async (args, context: ToolContext) => {
          const text = args.text as string;
          const images = (args.images as string[]) || [];

          this.logger.info(`[message] send_rich_text: text=${text.length} chars, images=${images.length}`);

          // 检查是否有 sendRichText 能力
          if (!context.sendRichText) {
            // 降级：先发文本，再发图片
            this.logger.info(`[message] sendRichText 不可用，降级为分别发送`);
            await context.sendText(text);
            if (context.sendFile && images.length > 0) {
              for (const imagePath of images) {
                const fileInfo = getFileInfo(imagePath);
                if (fileInfo.exists && fileInfo.isFile) {
                  await context.sendFile(imagePath);
                }
              }
            }
            return { success: true, output: '✅ 消息已发送（降级模式）' };
          }

          try {
            // 验证图片路径
            const validImages: string[] = [];
            for (const imagePath of images) {
              const fileInfo = getFileInfo(imagePath);
              if (fileInfo.exists && fileInfo.isFile && isImageFile(imagePath)) {
                validImages.push(imagePath);
              } else {
                this.logger.warn(`[message] 图片无效，跳过: ${imagePath}`);
              }
            }

            await context.sendRichText(text, validImages);
            this.logger.info(`[message] 富文本发送成功`);
            return { success: true, output: '✅ 富文本消息已发送' };
          } catch (error) {
            this.logger.error(`[message] 富文本发送失败: ${(error as Error).message}`);
            return {
              success: false,
              error: `发送失败: ${(error as Error).message}`,
            };
          }
        },
      }),
    ];
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createMessageMCPServer(
  config: MessageMCPServerConfig,
  logger: Logger
): MessageMCPServer {
  return new MessageMCPServer(config, logger);
}