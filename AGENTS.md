# AGENTS.md - OpenCode Gateway

> Guidance for agentic coding agents operating in this repository.

## Project Overview

TypeScript gateway connecting **飞书 (Feishu/Lark)** and **OpenCode AI** for DevOps tool operations (GitLab, 禅道/Zentao).

**Six-layer architecture**: `callers/ → gateway/ → agents/ + tools/ → channels/ + clients/`

---

## Build / Lint / Test Commands

```bash
npm run build              # rimraf dist && tsc
npm run build:watch        # Watch mode
npm run dev                # ts-node index.ts (no compilation)
npm run typecheck          # tsc --noEmit
npm run clean              # rimraf dist
npm test                   # Placeholder: "No tests yet" (exit 0)
npm start                  # Build + run dist/index.js
```

**Tests**: Not implemented. When adding: `jest path/to/test.ts` or `vitest run path/to/test.ts`

---

## TypeScript Configuration

- Target: ES2022, Module: NodeNext
- **Strict mode**: `noImplicitAny`, `noImplicitReturns`, `noFallthroughCasesInSwitch`
- Node 18+ required

---

## Code Style

### Imports

```typescript
import type { Logger } from '../types';           // Type-only (PREFERRED)
import type { ToolResult, ToolContext } from './types';
import { BaseTool } from './base';                // Value imports separate
import { GitLabClient } from '../clients/gitlab';
```

### File Structure

```typescript
/**
 * 文件描述
 */

import ...;

// ============================================================
// Section Name (中文)
// ============================================================

export class MyClass { ... }
```

Use `// ============================================================` dividers with Chinese section names.

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Interfaces | `I` prefix | `ITool`, `IChannel`, `IAgent` |
| Classes | PascalCase | `BaseTool`, `GitLabClient` |
| Methods | camelCase | `processMessage` |
| Config types | `XConfig` suffix | `GitLabToolConfig` |
| Context types | `XContext` suffix | `ToolContext` |
| Result types | `XResult` suffix | `ToolResult` |
| Constants | UPPER_SNAKE_CASE | `FEISHU_CARD_DEFAULT_TTL_MS` |

### Classes

```typescript
export abstract class BaseTool implements ITool {
  abstract readonly definition: ToolDefinition;   // abstract readonly
  protected logger: Logger;                        // protected for deps

  constructor(logger: Logger) { this.logger = logger; }
  abstract execute(...): Promise<ToolResult>;
  protected success(output: unknown): ToolResult { return { success: true, output }; }
  protected error(message: string): ToolResult { return { success: false, error: message }; }
}
```

### Error Handling

```typescript
try {
  const result = await this.client.doSomething(args);
  return this.success(result);
} catch (error) {
  return this.error((error as Error).message);   // Always typed
}
```

### Logging

```typescript
this.logger.info('[ComponentName] Action description');
this.logger.error('[ComponentName] Error: ${(error as Error).message}');
```

Prefix log messages with `[ModuleName]`.

---

## Adding New Tools

```typescript
// src/tools/my-tool.ts
import type { Logger } from '../types';
import { BaseTool } from './base';
import type { ToolDefinition, ToolResult, ToolContext, ITool } from './types';

class MyActionTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'namespace.action',           // Format: namespace.action
    description: '工具描述',
    inputSchema: { type: 'object', properties: { param1: { type: 'string' } }, required: ['param1'] },
    requiresApproval: false,            // true for sensitive ops
    internal: false,                    // true for internal tools
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    return this.success(await this.client.doSomething(args.param1 as string));
  }
}

export function createMyTools(config: MyConfig, logger: Logger): ITool[] {
  return [new MyActionTool(new MyClient(config, logger), logger)];
}
```

---

## Adding New Clients

```typescript
// src/clients/my-client/index.ts
export class MyClient extends BaseClient {
  readonly name = 'my_client';
  constructor(config: MyConfig, logger: Logger) { super(config.baseUrl, logger); }
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try { return { healthy: true, message: 'OK' }; }
    catch (error) { return { healthy: false, message: (error as Error).message }; }
  }
}
```

---

## Configuration (.env)

```ini
FEISHU_APP_ID=cli_xxx           # Required
FEISHU_APP_SECRET=xxx           # Required
OPENCODE_API_URL=http://127.0.0.1:4096
OPENCODE_MODEL_ID=glm-4.7
GITLAB_URL=https://gitlab.com/api/v4
GITLAB_TOKEN=glpat-xxx
ZENTAO_BASE_URL=https://zentao/api.php/v1
```

---

## Important Rules

1. **Chinese comments** for file descriptions/section headers
2. **Tool naming**: `namespace.action` format (e.g., `gitlab.create_mr`)
3. **Approval flow**: Set `requiresApproval: true` for sensitive ops, send Feishu cards
4. **No ESLint/Prettier** - follow existing patterns
5. **Strict TypeScript**: Never use `as any`, `@ts-ignore`, `@ts-expect-error`
6. **Async**: Always `async/await`, never raw Promises
7. **Error messages**: Use `(error as Error).message` pattern