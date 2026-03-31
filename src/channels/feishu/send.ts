/**
 * 飞书消息发送模块
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { isImageFile } from '../../utils/file';

// ============================================================
// 类型定义
// ============================================================

/** 消息发送结果 */
export interface FeishuSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

// ============================================================
// 客户端创建
// ============================================================

export function createFeishuClient(account: {
  appId: string;
  appSecret: string;
  domain?: 'feishu' | 'lark';
}): InstanceType<typeof Lark.Client> {
  const sdkDomain = account.domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu;

  return new Lark.Client({
    appId: account.appId,
    appSecret: account.appSecret,
    domain: sdkDomain,
    appType: Lark.AppType.SelfBuild,
    loggerLevel: Lark.LoggerLevel.info,
  });
}

// ============================================================
// ID 类型解析
// ============================================================

function resolveReceiveIdType(id: string): 'chat_id' | 'open_id' | 'union_id' {
  if (id.startsWith('ou_')) return 'open_id';
  if (id.startsWith('on_')) return 'union_id';
  return 'chat_id';
}

// ============================================================
// 文本消息
// ============================================================

export async function sendTextMessage(
  client: InstanceType<typeof Lark.Client>,
  chatId: string,
  text: string,
  replyToId?: string
): Promise<FeishuSendResult> {
  if (!chatId?.trim()) {
    return { ok: false, error: 'No chat_id provided' };
  }

  try {
    if (replyToId) {
      const res = await client.im.message.reply({
        path: { message_id: replyToId },
        data: {
          content: JSON.stringify({ text }),
          msg_type: 'text',
        },
      });
      if (res.code !== 0) {
        return { ok: false, error: `Feishu API Error [${res.code}]: ${res.msg}` };
      }
      return { ok: true, messageId: res?.data?.message_id ?? '' };
    }

    const res = await client.im.message.create({
      params: { receive_id_type: resolveReceiveIdType(chatId.trim()) },
      data: {
        receive_id: chatId.trim(),
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
    if (res.code !== 0) {
      return { ok: false, error: `Feishu API Error [${res.code}]: ${res.msg}` };
    }
    return { ok: true, messageId: res?.data?.message_id ?? '' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// 富文本消息（文本 + 图片）
// ============================================================

/**
 * 发送富文本消息（文本和图片在一条消息里）
 */
export async function sendRichTextMessage(
  client: InstanceType<typeof Lark.Client>,
  chatId: string,
  text: string,
  imageKeys: string[],
  replyToId?: string
): Promise<FeishuSendResult> {
  if (!chatId?.trim()) {
    return { ok: false, error: 'No chat_id provided' };
  }

  try {
    // 构建富文本内容
    const content: Array<Array<{ tag: string; text?: string; image_key?: string }>> = [];
    
    // 按行分割文本
    const lines = text.split('\n');
    
    for (const line of lines) {
      if (line.trim()) {
        content.push([{ tag: 'text', text: line }]);
      }
    }
    
    // 添加图片（每个图片独立一个段落）
    for (const imageKey of imageKeys) {
      content.push([{ tag: 'img', image_key: imageKey }]);
    }

    const postContent = {
      zh_cn: {
        title: '',
        content,
      },
    };

    if (replyToId) {
      const res = await client.im.message.reply({
        path: { message_id: replyToId },
        data: {
          content: JSON.stringify(postContent),
          msg_type: 'post',
        },
      });
      if (res.code !== 0) {
        return { ok: false, error: `Feishu API Error [${res.code}]: ${res.msg}` };
      }
      return { ok: true, messageId: res?.data?.message_id ?? '' };
    }

    const res = await client.im.message.create({
      params: { receive_id_type: resolveReceiveIdType(chatId.trim()) },
      data: {
        receive_id: chatId.trim(),
        msg_type: 'post',
        content: JSON.stringify(postContent),
      },
    });
    if (res.code !== 0) {
      return { ok: false, error: `Feishu API Error [${res.code}]: ${res.msg}` };
    }
    return { ok: true, messageId: res?.data?.message_id ?? '' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 上传图片并返回 image_key
 */
export async function uploadImage(
  client: InstanceType<typeof Lark.Client>,
  filePath: string
): Promise<{ ok: boolean; imageKey?: string; error?: string }> {
  const fs = await import('fs');
  
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: 'File not found' };
    }

    const file = fs.readFileSync(filePath);
    
    const response = await client.im.image.create({
      data: { image_type: 'message', image: file }
    });
    
    const imageKey = (response as any).image_key 
      || (response as any).data?.image_key;
    
    if (!imageKey) {
      return { ok: false, error: 'No image_key returned' };
    }
    
    return { ok: true, imageKey };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// 媒体消息
// ============================================================

export async function sendMediaMessage(
  client: InstanceType<typeof Lark.Client>,
  chatId: string,
  mediaUrl: string,
  text?: string
): Promise<FeishuSendResult> {
  if (!chatId?.trim()) {
    return { ok: false, error: 'No chat_id provided' };
  }
  if (!mediaUrl?.trim()) {
    return { ok: false, error: 'No media URL provided' };
  }

  // TODO: 实现媒体下载和上传
  // 目前先降级为文本 + URL
  const fallbackText = text ? `${text}\n${mediaUrl}` : mediaUrl;
  return sendTextMessage(client, chatId, fallbackText);
}

// ============================================================
// 卡片消息
// ============================================================

export async function sendCardMessage(
  client: InstanceType<typeof Lark.Client>,
  chatId: string,
  card: object,
  replyToId?: string
): Promise<FeishuSendResult> {
  try {
    if (replyToId) {
      const res = await client.im.message.reply({
        path: { message_id: replyToId },
        data: {
          content: JSON.stringify(card),
          msg_type: 'interactive',
        },
      });
      if (res.code !== 0) {
        return { ok: false, error: `Feishu API Error [${res.code}]: ${res.msg}` };
      }
      return { ok: true, messageId: res?.data?.message_id ?? '' };
    }

    const res = await client.im.message.create({
      params: { receive_id_type: resolveReceiveIdType(chatId.trim()) },
      data: {
        receive_id: chatId.trim(),
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });
    if (res.code !== 0) {
      return { ok: false, error: `Feishu API Error [${res.code}]: ${res.msg}` };
    }
    return { ok: true, messageId: res?.data?.message_id ?? '' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// 消息操作
// ============================================================

export async function updateMessage(
  client: InstanceType<typeof Lark.Client>,
  messageId: string,
  text: string
): Promise<FeishuSendResult> {
  try {
    await client.im.message.update({
      path: { message_id: messageId },
      data: {
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
    return { ok: true, messageId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function deleteMessage(
  client: InstanceType<typeof Lark.Client>,
  messageId: string
): Promise<void> {
  try {
    await client.im.message.delete({ path: { message_id: messageId } });
  } catch {
    // Best-effort
  }
}

export async function addReaction(
  client: InstanceType<typeof Lark.Client>,
  messageId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await client.im.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: 'OK' } },
    });
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

// ============================================================
// 文件上传
// ============================================================

/**
 * 上传并发送文件
 * @param client 飞书客户端
 * @param filePath 文件路径
 * @param chatId 聊天 ID
 * @param messageId 回复的消息 ID
 * @param logger 日志记录器
 */
export async function uploadAndSendFile(
  client: InstanceType<typeof Lark.Client>,
  filePath: string,
  chatId: string,
  messageId: string,
  logger?: { info: (msg: string) => void; error: (msg: string) => void }
): Promise<FeishuSendResult> {
  const fs = await import('fs');
  const path = await import('path');

  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return { ok: false, error: 'Not a file' };
    }

    // 限制文件大小为 30MB
    if (stats.size > 30 * 1024 * 1024) {
      logger?.error(`[文件上传跳过] 文件过大 (${(stats.size / 1024 / 1024).toFixed(2)}MB): ${filePath}`);
      return { ok: false, error: 'File too large (max 30MB)' };
    }

    const file = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const isImage = isImageFile(filePath);

    logger?.info(`[DEBUG] 准备发送文件: ${filePath} (图片: ${isImage})`);

    let content: string;
    let msgType: string;

    if (isImage) {
      const response = await client.im.image.create({
        data: { image_type: 'message', image: file }
      });
      const imageKey = (response as { image_key?: string; data?: { image_key?: string } })?.image_key
        || (response as { data?: { image_key?: string } })?.data?.image_key;
      if (!imageKey) throw new Error('上传图片未返回 image_key');
      content = JSON.stringify({ image_key: imageKey });
      msgType = 'image';
    } else {
      const response = await client.im.file.create({
        data: { file_type: 'stream', file_name: fileName, file: file }
      });
      const fileKey = (response as { file_key?: string; data?: { file_key?: string } })?.file_key
        || (response as { data?: { file_key?: string } })?.data?.file_key;
      if (!fileKey) throw new Error('上传文件未返回 file_key');
      content = JSON.stringify({ file_key: fileKey });
      msgType = 'file';
    }

    // 根据 replyToId 决定使用 reply 还是 create
    if (messageId) {
      // 回复消息模式
      await client.im.message.reply({
        path: { message_id: messageId },
        data: { content, msg_type: msgType }
      });
    } else if (chatId) {
      // 主动发送消息模式
      await client.im.message.create({
        params: { receive_id_type: resolveReceiveIdType(chatId.trim()) },
        data: {
          receive_id: chatId.trim(),
          msg_type: msgType,
          content,
        },
      });
    } else {
      return { ok: false, error: 'No messageId or chatId provided' };
    }

    logger?.info(`[${isImage ? '图片' : '文件'}发送成功] ${filePath}`);
    return { ok: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger?.error(`[上传/发送失败] ${filePath}: ${errorMsg}`);
    return { ok: false, error: errorMsg };
  }
}