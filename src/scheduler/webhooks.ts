// Webhook Handler — External system triggers for agent actions
// External systems POST to webhook URLs to trigger agent actions.
// Each webhook is associated with an agent and includes a transformation template.

import { createHmac, randomBytes } from "crypto";
import { homedir } from "os";
import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { logger } from "../logger.js";
import { SystemEventQueue } from "./system-events.js";

const WEBHOOKS_FILE = join(homedir(), ".strategos", "webhooks.json");

export interface WebhookConfig {
  id: string;
  agentId: string;
  path: string; // URL path segment
  method: "POST" | "GET";
  secret?: string; // HMAC verification
  transformTemplate?: string; // Template to convert payload to agent instructions
  enabled: boolean;
  createdAt: Date;
}

function uid(): string {
  return `wh-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

function generateHmac(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function applyTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, key: string) => {
    const parts = key.split(".");
    let value: unknown = payload;
    for (const part of parts) {
      if (value === null || value === undefined || typeof value !== "object") return "";
      value = (value as Record<string, unknown>)[part];
    }
    if (value === null || value === undefined) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

async function loadConfigs(): Promise<WebhookConfig[]> {
  try {
    const raw = await readFile(WEBHOOKS_FILE, "utf-8");
    const parsed: Array<Record<string, unknown>> = JSON.parse(raw);
    return parsed.map((p) => ({
      id: p.id as string,
      agentId: p.agentId as string,
      path: p.path as string,
      method: (p.method as "POST" | "GET") || "POST",
      secret: p.secret as string | undefined,
      transformTemplate: p.transformTemplate as string | undefined,
      enabled: Boolean(p.enabled),
      createdAt: new Date(p.createdAt as string),
    }));
  } catch {
    return [];
  }
}

async function saveConfigs(configs: WebhookConfig[]): Promise<void> {
  const dir = join(homedir(), ".strategos");
  await mkdir(dir, { recursive: true });
  // Atomic write: write to temp file then rename
  const tmp = WEBHOOKS_FILE + ".tmp";
  const serializable = configs.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
  }));
  await writeFile(tmp, JSON.stringify(serializable, null, 2), "utf-8");
  await require("fs/promises").rename(tmp, WEBHOOKS_FILE);
}

export class WebhookHandler {
  private configs: Map<string, WebhookConfig> = new Map(); // keyed by path
  private initialized = false;

  /**
   * Load persisted webhook configs from disk.
   * Call once at startup before registering new webhooks.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    const persisted = await loadConfigs();
    for (const cfg of persisted) {
      this.configs.set(cfg.path, cfg);
    }
    this.initialized = true;
    logger.info({ count: this.configs.size }, "WebhookHandler initialized from persistence");
  }

  /**
   * Register a new webhook config and persist it.
   */
  async register(config: WebhookConfig): Promise<void> {
    this.configs.set(config.path, config);
    await this.persist();
    logger.info({ webhookId: config.id, path: config.path, agentId: config.agentId }, "Webhook registered");
  }

  /**
   * Unregister a webhook by its ID and persist the change.
   */
  async unregister(id: string): Promise<void> {
    let found = false;
    for (const [path, cfg] of this.configs) {
      if (cfg.id === id) {
        this.configs.delete(path);
        found = true;
        break;
      }
    }
    if (found) {
      await this.persist();
      logger.info({ webhookId: id }, "Webhook unregistered");
    } else {
      logger.warn({ webhookId: id }, "Webhook not found for unregister");
    }
  }

  /**
   * List all webhooks, optionally filtered by agentId.
   */
  list(agentId?: string): WebhookConfig[] {
    const all = Array.from(this.configs.values());
    return agentId ? all.filter((c) => c.agentId === agentId) : all;
  }

  /**
   * Handle an incoming webhook request.
   * Returns an HTTP-like response object.
   */
  async handleRequest(
    path: string,
    method: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }> {
    // Strip leading slash for matching
    const cleanPath = path.replace(/^\/+/, "");

    const webhook = this.configs.get(cleanPath);
    if (!webhook) {
      logger.warn({ path: cleanPath }, "Webhook not found");
      return { status: 404, body: "Webhook not found" };
    }

    if (!webhook.enabled) {
      logger.warn({ webhookId: webhook.id, path: cleanPath }, "Webhook disabled");
      return { status: 410, body: "Webhook disabled" };
    }

    // Method check
    const upperMethod = method.toUpperCase();
    if (upperMethod !== webhook.method) {
      logger.warn({ path: cleanPath, method: upperMethod, expected: webhook.method }, "Webhook method mismatch");
      return { status: 405, body: "Method not allowed" };
    }

    // HMAC verification
    if (webhook.secret) {
      const signature = headers["x-webhook-signature"] || headers["X-Webhook-Signature"] || "";
      const bodyStr = typeof body === "string" ? body : JSON.stringify(body ?? "");
      const expected = generateHmac(webhook.secret, bodyStr);

      // Constant-time comparison
      let match = true;
      if (signature.length !== expected.length) {
        match = false;
      } else {
        for (let i = 0; i < signature.length; i++) {
          if (signature.charCodeAt(i) !== expected.charCodeAt(i)) {
            match = false;
            break;
          }
        }
      }

      if (!match) {
        logger.warn({ webhookId: webhook.id, path: cleanPath }, "Webhook HMAC signature verification failed");
        return { status: 401, body: "Unauthorized" };
      }
    }

    // Build instruction text
    let instruction: string;
    const payload = (body && typeof body === "object" && !Array.isArray(body))
      ? (body as Record<string, unknown>)
      : { _raw: body };

    if (webhook.transformTemplate) {
      instruction = applyTemplate(webhook.transformTemplate, payload);
    } else {
      instruction = `Webhook triggered (${webhook.id}):\n${JSON.stringify(payload, null, 2)}`;
    }

    // Enqueue as a system event for the target agent
    SystemEventQueue.enqueue({
      agentId: webhook.agentId,
      text: instruction,
      contextKey: `webhook:${webhook.id}`,
      priority: "P3",
    });

    logger.info(
      { webhookId: webhook.id, path: cleanPath, agentId: webhook.agentId, method: upperMethod },
      "Webhook delivered — system event enqueued",
    );

    return { status: 200, body: "Accepted" };
  }

  /**
   * Persist current configs to disk.
   */
  private async persist(): Promise<void> {
    await saveConfigs(Array.from(this.configs.values()));
  }
}

// Singleton instance
let singleton: WebhookHandler | null = null;

export function getWebhookHandler(): WebhookHandler {
  if (!singleton) {
    singleton = new WebhookHandler();
  }
  return singleton;
}
