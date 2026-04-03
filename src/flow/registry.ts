/**
 * Flow 注册表
 * 
 * 管理 Flow 模板的加载、注册和查询
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { Logger } from '../types';
import type { FlowTemplate, FlowRegistryConfig } from './types';

// ============================================================
// Flow 注册表
// ============================================================

export class FlowRegistry {
  private flows = new Map<string, FlowTemplate>();
  private logger: Logger;
  private config: FlowRegistryConfig;

  constructor(config: FlowRegistryConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  // ============================================================
  // 初始化
  // ============================================================

  /**
   * 初始化：加载所有模板
   */
  async init(): Promise<void> {
    const templatesDir = this.config.templatesDir;

    if (!fs.existsSync(templatesDir)) {
      this.logger.warn(`[FlowRegistry] Templates directory not found: ${templatesDir}`);
      return;
    }

    const extensions = this.config.extensions || ['.yaml', '.yml', '.json'];
    const files = this.listFiles(templatesDir, extensions);

    for (const file of files) {
      try {
        const flow = await this.loadTemplate(file);
        if (flow) {
          this.register(flow);
        }
      } catch (error) {
        this.logger.error(`[FlowRegistry] Failed to load ${file}: ${(error as Error).message}`);
      }
    }

    this.logger.info(`[FlowRegistry] Loaded ${this.flows.size} flows`);
  }

  /**
   * 递归列出模板文件
   */
  private listFiles(dir: string, extensions: string[]): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...this.listFiles(fullPath, extensions));
      } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * 加载模板文件
   */
  private async loadTemplate(file: string): Promise<FlowTemplate | null> {
    const content = fs.readFileSync(file, 'utf-8');

    if (file.endsWith('.json')) {
      return JSON.parse(content) as FlowTemplate;
    }

    // YAML
    return yaml.load(content) as FlowTemplate;
  }

  // ============================================================
  // 注册
  // ============================================================

  /**
   * 注册 Flow
   */
  register(flow: FlowTemplate): void {
    if (!flow.name) {
      throw new Error('Flow must have a name');
    }

    if (!flow.steps || flow.steps.length === 0) {
      throw new Error(`Flow ${flow.name} must have at least one step`);
    }

    this.flows.set(flow.name, flow);
    this.logger.info(`[FlowRegistry] Registered: ${flow.name}`);
  }

  /**
   * 注销 Flow
   */
  unregister(name: string): boolean {
    return this.flows.delete(name);
  }

  // ============================================================
  // 查询
  // ============================================================

  /**
   * 获取 Flow
   */
  get(name: string): FlowTemplate | undefined {
    return this.flows.get(name);
  }

  /**
   * 检查 Flow 是否存在
   */
  has(name: string): boolean {
    return this.flows.has(name);
  }

  /**
   * 列出所有 Flow
   */
  list(): FlowTemplate[] {
    return Array.from(this.flows.values());
  }

  /**
   * 列出所有 Flow 名称
   */
  names(): string[] {
    return Array.from(this.flows.keys());
  }

  /**
   * 根据关键词匹配 Flow
   */
  matchByKeyword(input: string): FlowTemplate | null {
    const lowerInput = input.toLowerCase();

    for (const flow of this.flows.values()) {
      const keywords = flow.triggers?.keywords || [];
      if (keywords.some(kw => lowerInput.includes(kw.toLowerCase()))) {
        return flow;
      }
    }

    return null;
  }

  /**
   * 获取 Flow 描述（用于生成工具描述）
   */
  getFlowDescriptions(): string {
    const lines: string[] = [];

    for (const flow of this.flows.values()) {
      const paramNames = Object.keys(flow.params || {}).join(', ');
      lines.push(`- ${flow.name}: ${flow.description || '无描述'}${paramNames ? ` (参数: ${paramNames})` : ''}`);
    }

    return lines.join('\n');
  }
}