#!/usr/bin/env node

/**
 * OpenCode Gateway CLI 入口
 * 
 * CLI 是 MCP Server 的另一个客户端
 * 调用正在运行的 MCP Server (localhost:3100)
 * 
 * 用法:
 *   gateway list                      列出所有工具
 *   gateway <tool.name> [--arg val]   执行工具
 *   gateway help                      显示帮助
 */

'use strict';

const http = require('http');
const path = require('path');

// 加载 .env
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const MCP_HOST = process.env.MCP_HOST || 'localhost';
const MCP_PORT = process.env.MCP_HTTP_PORT || 3100;

// ============================================================
// MCP Client - 通过 HTTP 调用 MCP Server
// ============================================================

async function callMCPTool(toolName, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ tool: toolName, args });
    
    const req = http.request({
      hostname: MCP_HOST,
      port: MCP_PORT,
      path: '/tools/call',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error(`Invalid response: ${data}`));
        }
      });
    });
    
    req.on('error', (e) => {
      if (e.code === 'ECONNREFUSED') {
        reject(new Error(`MCP Server not running at ${MCP_HOST}:${MCP_PORT}\nPlease run 'npm start' first.`));
      } else {
        reject(e);
      }
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.write(body);
    req.end();
  });
}

async function listMCPTools() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: MCP_HOST,
      port: MCP_PORT,
      path: '/tools',
      method: 'GET',
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error(`Invalid response: ${data}`));
        }
      });
    });
    
    req.on('error', (e) => {
      if (e.code === 'ECONNREFUSED') {
        reject(new Error(`MCP Server not running at ${MCP_HOST}:${MCP_PORT}\nPlease run 'npm start' first.`));
      } else {
        reject(e);
      }
    });
    
    req.end();
  });
}

// ============================================================
// CLI 主逻辑
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === 'help') {
    printHelp();
    process.exit(0);
  }
  
  if (args[0] === 'list') {
    await listTools();
    process.exit(0);
  }
  
  // 执行工具
  const toolName = args[0];
  const toolArgs = parseArgs(args.slice(1));
  
  await executeTool(toolName, toolArgs);
}

async function listTools() {
  try {
    const result = await listMCPTools();
    
    if (result.tools && Array.isArray(result.tools)) {
      console.log('\n可用工具:\n');
      
      // 按命名空间分组
      const groups = new Map();
      for (const tool of result.tools) {
        const [namespace] = tool.name.split('.');
        if (!groups.has(namespace)) {
          groups.set(namespace, []);
        }
        groups.get(namespace).push(tool);
      }
      
      // 输出
      for (const [namespace, tools] of groups) {
        console.log(`[${namespace}]`);
        for (const tool of tools) {
          const shortName = tool.name.replace(`${namespace}.`, '');
          console.log(`  ${shortName}: ${tool.description || ''}`);
        }
        console.log('');
      }
      
      console.log(`共 ${result.tools.length} 个工具`);
    } else {
      console.log('Tools:', JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

async function executeTool(toolName, args) {
  try {
    console.log(`\n🔄 Calling ${toolName}...`);
    const result = await callMCPTool(toolName, args);
    
    if (result.success !== false) {
      console.log('\n✅ Success:');
      console.log(JSON.stringify(result.output || result, null, 2));
    } else {
      console.error('\n❌ Error:', result.error || 'Unknown error');
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

function parseArgs(args) {
  const result = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      result[key] = value;
      if (value !== true) i++;
    }
  }
  
  return result;
}

function printHelp() {
  console.log(`
OpenCode Gateway CLI

CLI 是 MCP Server 的客户端，需要先启动服务：
  npm start

用法:
  gateway <tool.name> [--arg1 value1] [--arg2 value2]
  gateway list              列出所有工具
  gateway help              显示帮助

工具命名:
  <namespace>.<action>      如 gitlab.get_branches, zentao.get_bug

示例:
  # GitLab
  gateway gitlab.get_branches
  gateway gitlab.get_merge_requests --state open
  gateway gitlab.create_branch --name feature/new --ref main

  # 禅道
  gateway zentao.get_bug --bugId 123
  gateway zentao.get_bugs --status active
  gateway zentao.close_bug --bugId 123 --comment "已修复"

  # Workflow
  gateway workflow.get_linked_bugs --mrId 45
  gateway workflow.create_mr_for_bug --bugId 123

  # 飞书
  gateway feishu.send_file --filePath /path/to/file

  # 定时任务
  gateway cron.list
  gateway cron.create --cronExpr "0 9 * * 1-5" --prompt "生成日报"
`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});