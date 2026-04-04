// Hook System — PreToolUse, PostToolUse, PostToolUseFailure lifecycle hooks
// Lightweight, in-process hook registry for tool execution instrumentation

export type HookType = "pre_tool_use" | "post_tool_use" | "post_tool_use_failure";

export interface HookContext {
  toolName: string;
  input: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  agentId?: string;
  sessionId?: string;
}

export interface HookResult {
  cancelled?: boolean;
  modifiedInput?: Record<string, unknown>;
  modifiedOutput?: string;
  feedback?: string;
}

export type HookHandler = (ctx: HookContext) => Promise<HookResult>;

interface RegisteredHook {
  name: string;
  handler: HookHandler;
}

export class HookRegistry {
  private hooks: Map<HookType, RegisteredHook[]> = new Map();

  register(type: HookType, name: string, handler: HookHandler): void {
    const list = this.hooks.get(type) ?? [];
    list.push({ name, handler });
    this.hooks.set(type, list);
  }

  unregister(type: HookType, name: string): boolean {
    const list = this.hooks.get(type);
    if (!list) return false;
    const before = list.length;
    const filtered = list.filter(h => h.name !== name);
    this.hooks.set(type, filtered);
    return filtered.length < before;
  }

  async execute(type: HookType, ctx: HookContext): Promise<HookResult> {
    const list = this.hooks.get(type);
    if (!list || list.length === 0) return {};

    const merged: HookResult = {};

    for (const hook of list) {
      const result = await hook.handler(ctx);

      if (result.cancelled) {
        return { cancelled: true, feedback: result.feedback };
      }

      if (result.modifiedInput) {
        merged.modifiedInput = { ...merged.modifiedInput, ...result.modifiedInput };
      }

      if (result.modifiedOutput) {
        merged.modifiedOutput = result.modifiedOutput;
      }

      if (result.feedback) {
        merged.feedback = merged.feedback ? `${merged.feedback}\n${result.feedback}` : result.feedback;
      }
    }

    return merged;
  }
}

// Singleton instance
let registry: HookRegistry | null = null;

export function getHookRegistry(): HookRegistry {
  if (!registry) {
    registry = new HookRegistry();
  }
  return registry;
}
