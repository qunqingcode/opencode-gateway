/**
 * OpenCode 工具：代码修改确认
 * 
 * 用途：当 AI 完成代码修改后，调用此工具确认修改内容。
 * Gateway 会解析返回值，推送确认卡片给用户。
 */

import { tool } from "@opencode-ai/plugin"

export default tool({
  description: `
当完成代码修改后，调用此工具确认修改内容。
参数：
- branchName: 新分支名称
- summary: 修改摘要
- changelog: 详细变更说明
- files: 修改的文件列表

返回格式：
\`\`\`json
{
  "action": "code_change",
  "branchName": "feature-xxx",
  "summary": "修改摘要",
  "changelog": "详细说明",
  "files": ["file1.ts", "file2.ts"]
}
\`\`\`
`.trim(),

  args: {
    branchName: tool.schema
      .string()
      .describe("新分支名称，如 feature-login-fix"),

    summary: tool.schema
      .string()
      .describe("修改摘要，一句话描述"),

    changelog: tool.schema
      .string()
      .optional()
      .describe("详细变更说明"),

    files: tool.schema
      .array(tool.schema.string())
      .describe("修改的文件列表"),
  },

  async execute(args) {
    const result = {
      action: "code_change",
      branchName: args.branchName,
      summary: args.summary,
      changelog: args.changelog,
      files: args.files,
    }

    // 返回 JSON 字符串，Gateway 会解析
    return `\`\`\`json
${JSON.stringify(result, null, 2)}
\`\`\`

✅ 代码修改已确认，请查看变更内容。`
  },
})