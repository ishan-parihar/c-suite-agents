import { logger } from "../logger.js";
import { EventEmitter } from "node:events";

const OPENCODE_SERVER_URL = process.env.OPENCODE_SERVER_URL || "http://127.0.0.1:4096";

export interface ACPEvent {
  type: "step_start" | "text" | "step_finish" | "reasoning" | "error";
  sessionId: string;
  text?: string;
  data: unknown;
  timestamp: number;
}

export interface SendMessageResult {
  sessionId: string;
  text: string;
  tokens?: {
    total: number;
    input: number;
    output: number;
    reasoning: number;
  };
}

export class OpenCodeClient extends EventEmitter {
  private serverUrl: string;
  private connected = false;

  constructor(serverUrl?: string) {
    super();
    this.serverUrl = serverUrl || OPENCODE_SERVER_URL;
  }

  async start(cwd: string): Promise<void> {
    logger.info({ cwd, serverUrl: this.serverUrl }, "OpenCode client starting (HTTP mode)");
    
    // Test connection
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(`${this.serverUrl}/config`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      
      this.connected = true;
      logger.info("OpenCode client connected to HTTP server");
    } catch (err: any) {
      logger.error({ err: err.message }, "Failed to connect to OpenCode server");
      throw err;
    }
  }

  async createSession(cwd: string, options?: { agent?: string }): Promise<string> {
    logger.info({ cwd, agent: options?.agent }, "Creating OpenCode session");

    const body: any = {};
    if (options?.agent) body.agent = options.agent;
    // Pass cwd to OpenCode so the session operates in the agent's workspace directory
    body.cwd = cwd;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${this.serverUrl}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.status}`);
      }

      const data = await response.json();
      const sessionId = data.id;

      logger.info({ sessionId, agent: options?.agent }, "OpenCode session created");
      return sessionId;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  async resumeSession(sessionId: string): Promise<boolean> {
    logger.info({ sessionId }, "Resuming OpenCode session (session persists on server)");
    return true;
  }

  async sendMessage(sessionId: string, message: string, cwd?: string, options?: { agent?: string; system?: string }): Promise<SendMessageResult> {
    logger.debug({ sessionId, agent: options?.agent, message: message.substring(0, 100) }, "Sending message to OpenCode");

    const body: any = {
      parts: [{ type: "text", text: message }]
    };
    if (options?.agent) body.agent = options.agent;
    if (options?.system) body.system = options.system;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(`${this.serverUrl}/session/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenCode error: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    
    // Extract text from parts
    let responseText = "";
    let tokens: SendMessageResult["tokens"];
    
    if (data.parts && Array.isArray(data.parts)) {
      for (const part of data.parts) {
        if (part.type === "text" && part.text) {
          responseText += part.text;
          this.emit("session_update", {
            type: "text",
            sessionId,
            text: part.text,
            data: part,
            timestamp: part.time?.start || Date.now()
          } as ACPEvent);
        } else if (part.type === "step-start") {
          this.emit("session_update", {
            type: "step_start",
            sessionId,
            data: part,
            timestamp: Date.now()
          } as ACPEvent);
        } else if (part.type === "step-finish" && part.tokens) {
          tokens = part.tokens;
          this.emit("session_update", {
            type: "step_finish",
            sessionId,
            data: part,
            timestamp: Date.now()
          } as ACPEvent);
        } else if (part.type === "reasoning" && part.text) {
          this.emit("session_update", {
            type: "reasoning",
            sessionId,
            text: part.text,
            data: part,
            timestamp: part.time?.start || Date.now()
          } as ACPEvent);
        }
      }
    }
    
    logger.debug({ sessionId, reply: responseText.substring(0, 200), tokens }, "OpenCode response received");
    
    return {
      sessionId,
      text: responseText.trim(),
      tokens
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  async injectContext(sessionId: string, context: string, options?: { agent?: string }): Promise<void> {
    const body: any = {
      noReply: true,
      parts: [{ type: "text", text: context }]
    };
    if (options?.agent) body.agent = options.agent;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${this.serverUrl}/session/${sessionId}/prompt_async`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        logger.warn({ sessionId, status: response.status }, `Context injection failed: ${error}`);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      logger.warn({ sessionId, err }, "Context injection failed (timeout or network error)");
    }
  }

  async verifySession(sessionId: string): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${this.serverUrl}/session/${sessionId}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      clearTimeout(timeoutId);
      return false;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      await fetch(`${this.serverUrl}/session/${sessionId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      logger.info({ sessionId }, "OpenCode session deleted");
    } catch (err: any) {
      clearTimeout(timeoutId);
      logger.warn({ sessionId, err: err.message }, "Failed to delete session");
    }
  }

  async close(): Promise<void> {
    this.connected = false;
    logger.info("OpenCode client closed");
  }
}

let client: OpenCodeClient | null = null;

export function getOpenCodeClient(): OpenCodeClient {
  if (!client) {
    client = new OpenCodeClient();
  }
  return client;
}
