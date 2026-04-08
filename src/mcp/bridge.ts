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

/**
 * Strip fields from args that are not defined in the tool's input schema.
 * External MCP servers often use additionalProperties: false and reject
 * injected/LLM-added fields like agent_id, from, from_agent, etc.
 */
function stripUnknownFields(
  args: Record<string, unknown>,
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return args;
  const props = (schema as any).properties;
  if (!props || typeof props !== 'object') return args;
  // Only strip if additionalProperties is explicitly false
  if ((schema as any).additionalProperties !== false) return args;
  const allowed = new Set(Object.keys(props));
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (allowed.has(key)) cleaned[key] = value;
  }
  return cleaned;
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

  // Build a lookup for MCP tool schemas (needed for field stripping)
  const mcpSchemaMap = new Map<string, Record<string, unknown>>();
  for (const conn of connections) {
    for (const tool of conn.tools) {
      mcpSchemaMap.set(tool.name, (tool.inputSchema || {}) as Record<string, unknown>);
    }
  }

  const executor: ToolExecutor = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> => {
    const mcpEntry = mcpToolMap.get(name);
    if (mcpEntry) {
      // Strip fields not in the external tool's schema (handles agent_id injection)
      const schema = mcpSchemaMap.get(name);
      const cleanedArgs = stripUnknownFields(args, schema);

      const MAX_RETRIES = 2;
      let lastErr: Error | null = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await mcpEntry.conn.callTool(
            mcpEntry.toolName,
            cleanedArgs,
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
        { tool: name, err: err?.message },
        "Native tool execution failed",
      );
      return { success: false, content: "", error: err?.message ?? String(err) ?? "Unknown error" };
    }
  };

  return { executor, definitions, mcpToolMap };
}
