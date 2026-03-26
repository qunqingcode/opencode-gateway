/**
 * 消息类型检测工具
 * 
 * 根据 OpenCode 响应内容自动判断消息类型：
 * - 检测 HTTP 图片 URL（Markdown 格式或直接链接）
 * - 检测 HTTP 视频/音频链接
 * 
 * 注意：本地文件路径不会自动发送，需要 AI 调用 message.send_file 工具
 */

import type { DetectedMessage } from '../types';

// ============================================================
// 正则表达式
// ============================================================

/** Markdown 图片（仅 HTTP URL）: ![alt](http://...) */
const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;

/** 图片 URL（仅 HTTP） */
const IMAGE_URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico))/gi;

/** 视频 URL（仅 HTTP） */
const VIDEO_URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+\.(?:mp4|avi|mov|wmv|flv|webm))/gi;

/** 音频 URL（仅 HTTP） */
const AUDIO_URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+\.(?:mp3|wav|ogg|flac|aac))/gi;

// ============================================================
// 检测函数
// ============================================================

/**
 * 检测消息类型
 * 
 * 设计原则：
 * - 只自动处理 HTTP URL（图片、视频、音频）
 * - 本地文件路径不自动发送，需要 AI 显式调用 message.send_file 工具
 * 
 * 优先级：
 * 1. Markdown 图片（HTTP） → richText
 * 2. 图片 URL（HTTP） → richText
 * 3. 视频/音频 URL（HTTP） → media
 * 4. 纯文本 → text
 */
export function detectMessageType(content: string): DetectedMessage {
  if (!content || typeof content !== 'string') {
    return { type: 'text', text: content || '' };
  }

  // 1. 提取所有 HTTP 图片（Markdown + 直接 URL）
  const images = extractAllImages(content);
  
  if (images.length > 0) {
    // 移除图片后的文本内容
    const textWithoutImages = removeImages(content);
    
    return {
      type: 'richText',
      text: textWithoutImages.trim(),
      images,
    };
  }

  // 2. 检测视频 URL
  const videoUrls = extractUrls(content, VIDEO_URL_REGEX);
  if (videoUrls.length > 0) {
    const textWithoutMedia = content.replace(VIDEO_URL_REGEX, '').trim();
    return {
      type: 'media',
      text: textWithoutMedia,
      mediaUrl: videoUrls[0],
    };
  }

  // 3. 检测音频 URL
  const audioUrls = extractUrls(content, AUDIO_URL_REGEX);
  if (audioUrls.length > 0) {
    const textWithoutMedia = content.replace(AUDIO_URL_REGEX, '').trim();
    return {
      type: 'media',
      text: textWithoutMedia,
      mediaUrl: audioUrls[0],
    };
  }

  // 4. 纯文本
  return {
    type: 'text',
    text: content,
  };
}

/**
 * 提取所有 HTTP 图片（Markdown + 直接 URL）
 */
function extractAllImages(content: string): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  // 1. 提取 Markdown 图片（仅 HTTP URL）
  let match;
  const mdRegex = new RegExp(MARKDOWN_IMAGE_REGEX.source, 'g');
  while ((match = mdRegex.exec(content)) !== null) {
    const url = match[2];
    if (url && !seen.has(url)) {
      images.push(url);
      seen.add(url);
    }
  }

  // 2. 提取直接图片 URL（仅 HTTP，排除已在 Markdown 中的）
  const urlRegex = new RegExp(IMAGE_URL_REGEX.source, 'gi');
  while ((match = urlRegex.exec(content)) !== null) {
    const url = match[1];
    if (url && !seen.has(url)) {
      // 检查是否在 Markdown 格式中
      const beforeIndex = match.index;
      const surroundingText = content.slice(Math.max(0, beforeIndex - 5), beforeIndex);
      if (!surroundingText.includes('](')) {
        images.push(url);
        seen.add(url);
      }
    }
  }

  return images;
}

/**
 * 移除图片后的文本
 */
function removeImages(content: string): string {
  // 移除 Markdown 图片（仅 HTTP）
  let result = content.replace(MARKDOWN_IMAGE_REGEX, '');
  
  // 移除独立的图片 URL（仅 HTTP）
  result = result.replace(IMAGE_URL_REGEX, '');
  
  return result.trim();
}

/**
 * 提取 URL
 */
function extractUrls(content: string, regex: RegExp): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  
  let match;
  const globalRegex = new RegExp(regex.source, 'gi');
  while ((match = globalRegex.exec(content)) !== null) {
    const url = match[1] || match[0];
    if (url && !seen.has(url)) {
      urls.push(url);
      seen.add(url);
    }
  }
  
  return urls;
}

/**
 * 批量检测消息类型
 * 用于处理多段响应
 */
export function detectMessageTypes(contents: string[]): DetectedMessage[] {
  return contents.map(detectMessageType);
}