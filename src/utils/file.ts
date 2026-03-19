/**
 * 文件工具函数
 * 
 * 用于文件路径提取、类型判断、路径解析等
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// 文件类型判断
// ============================================================

/** 图片扩展名列表 */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff'];

/**
 * 判断是否为图片文件
 */
export function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * 判断是否为支持的文件类型（可上传到飞书）
 */
export function isSupportedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const supportedExtensions = [
    ...IMAGE_EXTENSIONS,
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.rar', '.tar', '.gz',
    '.txt', '.log', '.json', '.xml', '.yaml', '.yml', '.md',
  ];
  return supportedExtensions.includes(ext);
}

// ============================================================
// 文件路径提取
// ============================================================

/**
 * 提取文本中的文件路径（包括图片和其他文件）
 * 支持 Markdown 链接格式和裸露路径
 */
export function extractFilePaths(text: string): string[] {
  const paths = new Set<string>();

  // 1. 匹配 Markdown 链接/图片 ![alt](path) 或 [alt](path)
  const markdownRegex = /(!?\[.*?\])\((.*?)\)/g;
  let match;
  while ((match = markdownRegex.exec(text)) !== null) {
    if (!match[2].startsWith('http')) {
      paths.add(match[2]);
    }
  }

  // 2. 如果没有找到 Markdown 链接，尝试匹配裸露的文件路径
  if (paths.size === 0) {
    const extRegex = /([a-zA-Z0-9_\-\.\/\\\:]+\.(png|jpg|jpeg|gif|webp|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|tar|gz|txt|log|json|xml|yaml|yml|md))/gi;
    while ((match = extRegex.exec(text)) !== null) {
      if (!match[1].startsWith('http') && !match[1].includes('node_modules')) {
        paths.add(match[1]);
      }
    }
  }

  return [...paths];
}

// ============================================================
// 路径解析
// ============================================================

/**
 * 寻找真实存在的文件路径
 * 尝试多种可能的路径组合
 */
export function resolveExistingFilePath(filePath: string): string | null {
  const projectRoot = process.cwd();
  const possiblePaths = [
    path.resolve(filePath),
    path.resolve(projectRoot, filePath),
    path.resolve(projectRoot, filePath.replace(/^[/\\]/, '')),
    path.join(projectRoot, filePath),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * 获取文件信息
 */
export function getFileInfo(filePath: string): {
  exists: boolean;
  size?: number;
  isFile?: boolean;
  isDirectory?: boolean;
  extension?: string;
  basename?: string;
} {
  try {
    const stats = fs.statSync(filePath);
    return {
      exists: true,
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      extension: path.extname(filePath).toLowerCase(),
      basename: path.basename(filePath),
    };
  } catch {
    return { exists: false };
  }
}

/**
 * 确保目录存在
 */
export function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}