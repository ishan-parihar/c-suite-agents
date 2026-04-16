import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const AGENT_REGISTRY: Record<string, { name: string; role: string; responsibilities: string }> = {
  operant: {
    name: "Operant",
    role: "CEO — Chief Executive Officer",
    responsibilities: "Overall system orchestration, strategic decisions, user communication",
  },
  "coo-productivity": {
    name: "COO",
    role: "COO — Chief Operating Officer",
    responsibilities: "Task management, kanban operations, workflow optimization",
  },
  "cpo-psychologist": {
    name: "CPO",
    role: "CPO — Chief Psychology Officer",
    responsibilities: "Mental health monitoring, behavioral analysis, mood tracking",
  },
  "cro-relational": {
    name: "CRO",
    role: "CRO — Chief Relational Officer",
    responsibilities: "Relationship management, social network analysis, people operations",
  },
  "cfo-financial": {
    name: "CFO",
    role: "CFO — Chief Financial Officer",
    responsibilities: "Financial tracking, budget analysis, revenue monitoring",
  },
  "cmo-content": {
    name: "CMO",
    role: "CMO — Chief Marketing Officer",
    responsibilities: "Content strategy, social media management, brand operations",
  },
  "cio-intelligence": {
    name: "CIO",
    role: "CIO — Chief Intelligence Officer",
    responsibilities: "Research, information synthesis, competitive analysis",
  },
  "physician-health": {
    name: "Physician",
    role: "Chief Health Officer",
    responsibilities: "Health metrics, diet tracking, exercise monitoring, vital analysis",
  },
};

function safeMkdir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function safeWriteFile(filePath: string, content: string): void {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, content, "utf-8");
  }
}

export async function createAgentOffice(agentId: string, baseDir: string): Promise<string> {
  const officePath = join(baseDir, agentId);
  safeMkdir(officePath);
  return officePath;
}

export async function seedBootstrapFiles(officePath: string): Promise<void> {
  // Determine agent metadata from directory name
  const agentId = officePath.split("/").pop() || "";
  const meta = AGENT_REGISTRY[agentId] ?? {
    name: agentId,
    role: "Agent",
    responsibilities: "General agent operations",
  };

  // AGENTS.md
  safeWriteFile(
    join(officePath, "AGENTS.md"),
    `# ${meta.name}

## Role
${meta.role}

## Responsibilities
${meta.responsibilities}
`
  );

  // BOOTSTRAP.md
  safeWriteFile(
    join(officePath, "BOOTSTRAP.md"),
    `# Bootstrap Protocol

This file triggers the first-run initialization ritual.
On completion, this file should be removed.

## Steps
1. Read IDENTITY.md for role context
2. Read USER.md for user context
3. Initialize memory systems
4. Report readiness to CEO
5. Remove this file
`
  );

  // IDENTITY.md
  safeWriteFile(
    join(officePath, "IDENTITY.md"),
    `# Identity

- **Agent**: ${meta.name}
- **Role**: ${meta.role}
- **Status**: Initializing
- **Office**: ${officePath}
`
  );

  // USER.md
  safeWriteFile(
    join(officePath, "USER.md"),
    `# User Context

This file will be populated during onboarding with user preferences,
working style, and context.
`
  );
}

export async function initializeWorkspace(config: any): Promise<void> {
  const home = homedir();
  const configDir = join(home, ".operant");

  // Create root config directory
  safeMkdir(configDir);

  // Determine paths from config or defaults
  const agentOfficesDir = config?.paths?.agentOffices ?? join(configDir, "agents");
  const lancedbDir = config?.paths?.lancedb ?? join(configDir, "data", "lancedb");
  const kanbanDir = config?.paths?.kanban ?? join(configDir, "data", "kanban");
  const messagesDir = config?.paths?.messages ?? join(configDir, "data", "messages");

  // Create data directories
  safeMkdir(agentOfficesDir);
  safeMkdir(lancedbDir);
  safeMkdir(kanbanDir);
  safeMkdir(messagesDir);

  // Create office for each C-suite agent and seed bootstrap files
  for (const agentId of Object.keys(AGENT_REGISTRY)) {
    const officePath = await createAgentOffice(agentId, agentOfficesDir);
    await seedBootstrapFiles(officePath);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { loadConfig } = await import("../config/loader.js");
  const config = loadConfig();
  await initializeWorkspace(config);
  console.log("Workspace initialized successfully");
}
