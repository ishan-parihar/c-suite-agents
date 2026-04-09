import type { ToolDefinition, ToolResult, ToolExecutor } from "../runtime/tool-bridge.js";
import { buildToolDefinitions, mcpResponseToToolResult } from "../runtime/tool-bridge.js";
import type { McpServerConnection } from "./client.js";
import { logger } from "../logger.js";
import { ErrorBus } from "../runtime/error-emitter.js";

export interface BridgeResult {
  executor: ToolExecutor;
  definitions: ToolDefinition[];
  /** Mutable map allowing callers to update MCP connections on reconnect */
  mcpToolMap: Map<string, { conn: McpServerConnection; toolName: string }>;
  /** Mutable map of MCP tool input schemas, updated on reconnect */
  mcpSchemaMap: Map<string, Record<string, unknown>>;
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
  if (!schema?.properties || typeof schema.properties !== 'object' || Object.keys(schema.properties).length === 0) return args;
  const props = (schema as any).properties;
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
  const mcpSchemaMap = new Map<string, Record<string, unknown>>();

  for (const conn of connections) {
    for (const tool of conn.tools) {
      mcpToolMap.set(tool.name, { conn, toolName: tool.toolName });
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
            await new Promise((r) => {
              const delay = 500 * (attempt + 1) + Math.random() * 200;
              setTimeout(r, delay).unref();
            });
          }
        }
      }
      logger.error(
        { tool: name, err: lastErr?.message },
        "MCP tool execution failed after retries",
      );
      const errorMsg = lastErr?.message ?? "Unknown error";
      ErrorBus.emit({
        type: "tool:failed",
        severity: "warn",
        component: "mcp-bridge",
        error: lastErr ?? new Error(errorMsg),
        message: `MCP tool ${name} failed after ${MAX_RETRIES + 1} retries`,
        context: { toolName: name, serverName: mcpEntry.conn.serverName },
      });
      return { success: false, content: "", error: errorMsg };
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
      const errorMsg = err?.message ?? String(err) ?? "Unknown error";
      ErrorBus.emit({
        type: "tool:failed",
        severity: "warn",
        component: "mcp-bridge",
        error: err instanceof Error ? err : new Error(errorMsg),
        message: `Native tool ${name} execution failed`,
        context: { toolName: name },
      });
      return { success: false, content: "", error: errorMsg };
    }
  };

  return { executor, definitions, mcpToolMap, mcpSchemaMap };
}
