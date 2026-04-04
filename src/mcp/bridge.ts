import type { ToolDefinition, ToolResult, ToolExecutor } from "../runtime/tool-bridge.js";
import { buildToolDefinitions, mcpResponseToToolResult } from "../runtime/tool-bridge.js";
import type { McpServerConnection } from "./client.js";
import { logger } from "../logger.js";

export interface BridgeResult {
  executor: ToolExecutor;
  definitions: ToolDefinition[];
  /** Mutable map allowing callers to update MCP connections on reconnect */
  mcpToolMap: Map<string, { conn: McpServerConnection; toolName: string }>;
}

const MAX_TOOL_RESULT_CHARS = 50_000;

function truncateResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_CHARS) return content;
  const omitted = content.length - MAX_TOOL_RESULT_CHARS;
  const suffix = `\n\n[Result truncated: ${omitted} chars omitted. Use more specific queries.]`;

  // If content is valid JSON, truncate raw — JSON is data, not line-oriented
  try {
    JSON.parse(content);
    return content.slice(0, MAX_TOOL_RESULT_CHARS) + suffix;
  } catch {
    // Not JSON — truncate at last newline to avoid cutting mid-line
    const truncated = content.slice(0, MAX_TOOL_RESULT_CHARS);
    const lastNewline = truncated.lastIndexOf("\n");
    if (lastNewline > MAX_TOOL_RESULT_CHARS * 0.8) {
      return truncated.slice(0, lastNewline) + suffix;
    }
    return truncated + suffix;
  }
}

export function createBridge(
  nativeToolImpls: Record<string, (args: any) => Promise<any>>,
  connections: McpServerConnection[],
  nativeToolNames: string[],
  existingMap?: Map<string, { conn: McpServerConnection; toolName: string }>,
): BridgeResult {
  const nativeDefs = buildToolDefinitions(nativeToolNames);

  const mcpDefs: ToolDefinition[] = [];
  for (const conn of connections) {
    for (const tool of conn.tools) {
      mcpDefs.push({
        name: tool.name,
        description: tool.description,
        parameters: (tool.inputSchema || {}) as Record<string, unknown>,
      });
    }
  }

  const definitions = [...nativeDefs, ...mcpDefs];

  const mcpToolMap = existingMap ?? new Map<
    string,
    { conn: McpServerConnection; toolName: string }
  >();
  if (!existingMap) {
    for (const conn of connections) {
      for (const tool of conn.tools) {
        mcpToolMap.set(tool.name, { conn, toolName: tool.toolName });
      }
    }
  }

  const executor: ToolExecutor = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> => {
    const mcpEntry = mcpToolMap.get(name);
    if (mcpEntry) {
      const MAX_RETRIES = 2;
      let lastErr: Error | null = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await mcpEntry.conn.callTool(
            mcpEntry.toolName,
            args,
          );
          if (response?.content && Array.isArray(response.content)) {
            const r = mcpResponseToToolResult(response);
            return { ...r, content: truncateResult(r.content) };
          }
          return {
            success: true,
            content: truncateResult(
              typeof response === "string"
                ? response
                : JSON.stringify(response),
            ),
          };
        } catch (err: any) {
          lastErr = err;
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      }
      logger.error(
        { tool: name, err: lastErr?.message },
        "MCP tool execution failed after retries",
      );
      return { success: false, content: "", error: lastErr?.message ?? "Unknown error" };
    }

    const impl = nativeToolImpls[name];
    if (!impl) {
      return { success: false, content: "", error: `Unknown tool: ${name}` };
    }

    try {
      const result = await impl(args);
      if (result?.content && Array.isArray(result.content)) {
        const r = mcpResponseToToolResult(result);
        return { ...r, content: truncateResult(r.content) };
      }
      return {
        success: true,
        content: truncateResult(
          typeof result === "string" ? result : JSON.stringify(result),
        ),
      };
    } catch (err: any) {
      logger.error(
        { tool: name, err: err.message },
        "Native tool execution failed",
      );
      return { success: false, content: "", error: err.message };
    }
  };

  return { executor, definitions, mcpToolMap };
}
