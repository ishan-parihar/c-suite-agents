import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger } from "../logger.js";

export interface McpCatalogTool {
  serverName: string;
  toolName: string;
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface McpServerConnection {
  serverName: string;
  tools: McpCatalogTool[];
  callTool: (toolName: string, args: Record<string, unknown>) => Promise<any>;
  dispose: () => Promise<void>;
}

interface McpLocalConfig {
  type: "local";
  command: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

interface McpRemoteConfig {
  type: "remote";
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

type McpServerConfig = McpLocalConfig | McpRemoteConfig;

const CONNECTION_TIMEOUT_MS = 10_000;
const MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000; // 5 minutes cap
const INITIAL_RECONNECT_DELAY_MS = 2000; // 2 seconds

async function connectWithTimeout(
  client: Client,
  transport: { close: () => Promise<void> },
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Connection timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref();
    client.connect(transport as any).then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function listAllTools(client: Client) {
  const tools: any[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = (page as any).nextCursor;
  } while (cursor);
  return tools;
}

async function connectLocal(
  config: McpLocalConfig,
  serverName: string,
  onReconnect?: (newConn: McpServerConnection) => void,
  reconnectAttempt = 0,
): Promise<McpServerConnection | null> {
  const [cmd, ...args] = config.command;

  const transport = new StdioClientTransport({
    command: cmd,
    args,
    env: { ...process.env, ...config.env } as Record<string, string>,
  });

  const client = new Client(
    { name: "strategos-mcp-client", version: "0.1.0" },
    { capabilities: {} },
  );

  try {
    await connectWithTimeout(client, transport, CONNECTION_TIMEOUT_MS);
    const listedTools = await listAllTools(client);

    const tools: McpCatalogTool[] = listedTools
      .filter((t: any) => t.name?.trim())
      .map((t: any) => ({
        serverName,
        toolName: t.name,
        name: `${serverName}__${t.name}`,
        description: t.description?.trim() || `Tool from ${serverName}`,
        inputSchema: t.inputSchema,
      }));

    logger.info(
      { server: serverName, toolCount: tools.length },
      `Connected to ${serverName} (${tools.length} tools)`,
    );

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const doDispose = async () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
  await client.close().catch((err: unknown) => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "Cleanup error"));
      await transport.close().catch((err) => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "Cleanup error"));
    };

    // Auto-reconnect on transport close with exponential backoff
    transport.onclose = async () => {
      if (disposed) return;
      const delay = Math.min(
        INITIAL_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempt),
        MAX_RECONNECT_DELAY_MS,
      );
      logger.warn(
        { server: serverName, attempt: reconnectAttempt + 1, delayMs: delay },
        "MCP server disconnected, scheduling reconnect",
      );
      reconnectTimer = setTimeout(async () => {
        if (disposed) return;
        try {
          const newConn = await connectLocal(config, serverName, onReconnect, 0);
          if (newConn) {
            logger.info({ server: serverName }, "MCP server reconnected");
            onReconnect?.(newConn);
          }
        } catch (err: any) {
          logger.error({ server: serverName, err: err.message }, "MCP reconnect failed");
        }
      }, delay);
      reconnectTimer.unref();
    };

    return {
      serverName,
      tools,
      callTool: async (toolName, args) =>
        client.callTool({ name: toolName, arguments: args }),
      dispose: doDispose,
    };
  } catch (err: any) {
    logger.warn(
      { server: serverName, error: err.message },
      `Failed to connect to ${serverName}: ${err.message}`,
    );
    await client.close().catch((err) => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "Cleanup error"));
    await transport.close().catch((err) => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "Cleanup error"));
    return null;
  }
}

async function connectRemote(
  config: McpRemoteConfig,
  serverName: string,
  onReconnect?: (newConn: McpServerConnection) => void,
  reconnectAttempt = 0,
): Promise<McpServerConnection | null> {
  const client = new Client(
    { name: "strategos-mcp-client", version: "0.1.0" },
    { capabilities: {} },
  );

  const requestInit: RequestInit | undefined = config.headers
    ? { headers: config.headers as HeadersInit }
    : undefined;

  const transportCreators: Array<() => any> = [
    () =>
      new StreamableHTTPClientTransport(new URL(config.url), { requestInit }),
    () => new SSEClientTransport(new URL(config.url), { requestInit }),
  ];

  for (const createTransport of transportCreators) {
    let transport: any;
    try {
      transport = createTransport();
    } catch {
      continue;
    }

    try {
      await connectWithTimeout(client, transport, CONNECTION_TIMEOUT_MS);
      const listedTools = await listAllTools(client);

      const tools: McpCatalogTool[] = listedTools
        .filter((t: any) => t.name?.trim())
        .map((t: any) => ({
          serverName,
          toolName: t.name,
          name: `${serverName}__${t.name}`,
          description: t.description?.trim() || `Tool from ${serverName}`,
          inputSchema: t.inputSchema,
        }));

      logger.info(
        { server: serverName, toolCount: tools.length },
        `Connected to ${serverName} (${tools.length} tools)`,
      );

      let disposed = false;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      const doDispose = async () => {
        disposed = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        await client.close().catch((err: unknown) => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "Cleanup error"));
        if (typeof transport.terminateSession === "function") {
          await transport.terminateSession().catch((err: unknown) => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "Cleanup error"));
        }
        await transport.close().catch((err: unknown) => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "Cleanup error"));
      };

      // Auto-reconnect on transport close with exponential backoff
      transport.onclose = async () => {
        if (disposed) return;
        const delay = Math.min(
          INITIAL_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempt),
          MAX_RECONNECT_DELAY_MS,
        );
        logger.warn(
          { server: serverName, attempt: reconnectAttempt + 1, delayMs: delay },
          "Remote MCP server disconnected, scheduling reconnect",
        );
        reconnectTimer = setTimeout(async () => {
          if (disposed) return;
          try {
            const newConn = await connectRemote(config, serverName, onReconnect, 0);
            if (newConn) {
              logger.info({ server: serverName }, "Remote MCP server reconnected");
              onReconnect?.(newConn);
            }
          } catch (err: any) {
            logger.error({ server: serverName, err: err.message }, "Remote MCP reconnect failed");
          }
        }, delay);
        reconnectTimer.unref();
      };

      return {
        serverName,
        tools,
        callTool: async (toolName, args) =>
          client.callTool({ name: toolName, arguments: args }),
        dispose: doDispose,
      };
    } catch {
      await transport.close().catch((err: unknown) => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "Cleanup error"));
    }
  }

  logger.warn(
    { server: serverName },
    `Failed to connect to ${serverName}: all transports failed`,
  );
  await client.close().catch((err) => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "Cleanup error"));
  return null;
}

export async function connectMcpServer(
  serverName: string,
  config: McpServerConfig,
  onReconnect?: (newConn: McpServerConnection) => void,
): Promise<McpServerConnection | null> {
  if (config.enabled === false) {
    logger.debug(
      { server: serverName },
      `Skipping disabled MCP server: ${serverName}`,
    );
    return null;
  }

  if (config.type === "local") {
    if (!config.command?.length) {
      logger.warn(
        { server: serverName },
        `Failed to connect to ${serverName}: no command specified`,
      );
      return null;
    }
    return connectLocal(config, serverName, onReconnect);
  }

  if (config.type === "remote") {
    if (!config.url) {
      logger.warn(
        { server: serverName },
        `Failed to connect to ${serverName}: no URL specified`,
      );
      return null;
    }
    return connectRemote(config, serverName, onReconnect);
  }

  logger.warn(
    { server: serverName },
    `Failed to connect to ${serverName}: unknown server type`,
  );
  return null;
}

export async function connectAllMcpServers(
  mcpConfig: Record<string, unknown>,
  onReconnect?: (serverName: string, newConn: McpServerConnection) => void,
): Promise<McpServerConnection[]> {
  const connections: McpServerConnection[] = [];

  for (const [serverName, rawConfig] of Object.entries(mcpConfig)) {
    const conn = await connectMcpServer(
      serverName,
      rawConfig as McpServerConfig,
      onReconnect ? (newConn) => onReconnect(serverName, newConn) : undefined,
    );
    if (conn) {
      connections.push(conn);
    }
  }

  return connections;
}
