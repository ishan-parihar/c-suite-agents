import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const AGENTS = [
  { id: 'ceo', name: 'CEO', role: 'Strategic Leadership' },
  { id: 'coo', name: 'COO', role: 'Operations' },
  { id: 'cpo', name: 'CPO', role: 'Psychology' },
  { id: 'cro', name: 'CRO', role: 'Relations' },
  { id: 'cfo', name: 'CFO', role: 'Finance' },
  { id: 'cmo', name: 'CMO', role: 'Content' },
  { id: 'cio', name: 'CIO', role: 'Intelligence' },
  { id: 'physician', name: 'Physician', role: 'Health' },
];

const DEFAULT_PERMISSIONS = { bash: false, web: true, file: true, db: false };
const DEFAULT_MODEL = 'gpt-4';
const DEFAULT_MAX_TOKENS = 4096;

const DATA_DIR = path.join(process.cwd(), 'data');
const FALLBACK_CONFIG_PATH = path.join(DATA_DIR, 'agent-config.json');
const RUNTIME_CONFIG_PATH = path.join(os.homedir(), '.operant', 'config.json');

interface AgentConfig {
  permissions: Record<string, boolean>;
  model: string;
  maxTokens: number;
}

function getDefaultAgents(): Array<{
  id: string;
  name: string;
  role: string;
  model: string;
  maxTokens: number;
  permissions: typeof DEFAULT_PERMISSIONS;
}> {
  return AGENTS.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    model: DEFAULT_MODEL,
    maxTokens: DEFAULT_MAX_TOKENS,
    permissions: { ...DEFAULT_PERMISSIONS },
  }));
}

function readRuntimeConfig(): Record<string, AgentConfig> | null {
  try {
    if (!fs.existsSync(RUNTIME_CONFIG_PATH)) return null;
    const raw = fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);

    // Check if agent-level overrides exist in the runtime config
    const agentOverrides: Record<string, AgentConfig> = {};
    const agentsSection = config?.agents;
    if (agentsSection && typeof agentsSection === 'object') {
      for (const agent of AGENTS) {
        const override = agentsSection[agent.id];
        if (override && typeof override === 'object') {
          agentOverrides[agent.id] = {
            permissions: override.permissions ?? { ...DEFAULT_PERMISSIONS },
            model: override.model ?? DEFAULT_MODEL,
            maxTokens: override.maxTokens ?? DEFAULT_MAX_TOKENS,
          };
        }
      }
    }
    return Object.keys(agentOverrides).length > 0 ? agentOverrides : null;
  } catch {
    return null;
  }
}

function readFallbackConfig(): Record<string, AgentConfig> | null {
  try {
    if (!fs.existsSync(FALLBACK_CONFIG_PATH)) return null;
    const raw = fs.readFileSync(FALLBACK_CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeFallbackConfig(config: Record<string, AgentConfig>): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(FALLBACK_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export async function GET() {
  // Try runtime config first, then fallback, then defaults
  const runtimeOverrides = readRuntimeConfig();
  const fallbackConfig = readFallbackConfig();
  const overrides = runtimeOverrides ?? fallbackConfig ?? {};

  const agents = AGENTS.map((a) => {
    const override = overrides[a.id];
    return {
      id: a.id,
      name: a.name,
      role: a.role,
      model: override?.model ?? DEFAULT_MODEL,
      maxTokens: override?.maxTokens ?? DEFAULT_MAX_TOKENS,
      permissions: override?.permissions ?? { ...DEFAULT_PERMISSIONS },
    };
  });

  return NextResponse.json({ agents });
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, config }: { agentId: string; config: AgentConfig } = body;

    if (!agentId || !config) {
      return NextResponse.json(
        { error: 'Missing required fields: agentId and config' },
        { status: 400 }
      );
    }

    const validAgent = AGENTS.find((a) => a.id === agentId);
    if (!validAgent) {
      return NextResponse.json({ error: `Unknown agent: ${agentId}` }, { status: 404 });
    }

    // Try updating runtime config if it has agent overrides
    try {
      if (fs.existsSync(RUNTIME_CONFIG_PATH)) {
        const raw = fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf-8');
        const runtimeConfig = JSON.parse(raw);

        if (!runtimeConfig.agents) runtimeConfig.agents = {};
        runtimeConfig.agents[agentId] = {
          ...runtimeConfig.agents[agentId],
          permissions: config.permissions,
          model: config.model,
          maxTokens: config.maxTokens,
        };

        // Atomic write
        const tmpPath = RUNTIME_CONFIG_PATH + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(runtimeConfig, null, 2), 'utf-8');
        fs.renameSync(tmpPath, RUNTIME_CONFIG_PATH);

        return NextResponse.json({ success: true, source: 'runtime-config' });
      }
    } catch {
      // Fall through to fallback storage
    }

    // Fallback: store in dashboard/data/agent-config.json
    const existing = readFallbackConfig() ?? {};
    existing[agentId] = config;
    writeFallbackConfig(existing);

    return NextResponse.json({ success: true, source: 'fallback-config' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body', details: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
