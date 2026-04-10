// Tool Scoping Tests — 3-tier scoping system validation
import { describe, test, expect } from "bun:test";
import { OperantConfigSchema } from "../config/schema.js";
import { getAgentToolScope } from "../staff/tool-scoping.js";

// ---------------------------------------------------------------------------
// Schema validation tests — toolScoping record with optional nativeTools
// and mcpServerTools fields
// ---------------------------------------------------------------------------

describe("toolScoping schema validation", () => {
  const baseAgents = {
    defaultAutonomy: 3 as const,
    maxConcurrent: 5,
    maxToolRounds: 10,
    directToUser: true,
  };

  describe("nativeTools field", () => {
    test("accepts config with nativeTools array of strings", () => {
      const result = OperantConfigSchema.safeParse({
        agents: {
          ...baseAgents,
          toolScoping: {
            "ceo-strategic": {
              mcpServers: ["operant"],
              nativeTools: ["memory.search", "memory.upsert", "kanban.listBoards"],
            },
          },
        },
      });
      expect(result.success).toBe(true);
    });

    test("rejects nativeTools with non-string values", () => {
      const result = OperantConfigSchema.safeParse({
        agents: {
          ...baseAgents,
          toolScoping: {
            "ceo-strategic": {
              mcpServers: ["operant"],
              nativeTools: ["memory.search", 42, true],
            },
          },
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("mcpServerTools field", () => {
    test("accepts config with mcpServerTools record of string arrays", () => {
      const result = OperantConfigSchema.safeParse({
        agents: {
          ...baseAgents,
          toolScoping: {
            "ceo-strategic": {
              mcpServers: ["operant"],
              mcpServerTools: {
                operant: ["goal.list", "project.list", "task.list"],
                telegram: ["notify.telegram"],
              },
            },
          },
        },
      });
      expect(result.success).toBe(true);
    });

    test("rejects mcpServerTools with non-array values", () => {
      const result = OperantConfigSchema.safeParse({
        agents: {
          ...baseAgents,
          toolScoping: {
            "ceo-strategic": {
              mcpServers: ["operant"],
              mcpServerTools: {
                operant: "goal.list,project.list",
              },
            },
          },
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("combined fields", () => {
    test("accepts config with BOTH nativeTools and mcpServerTools", () => {
      const result = OperantConfigSchema.safeParse({
        agents: {
          ...baseAgents,
          toolScoping: {
            "ceo-strategic": {
              mcpServers: ["operant", "telegram"],
              nativeTools: ["memory.search", "memory.upsert"],
              mcpServerTools: {
                operant: ["goal.list", "project.list"],
                telegram: ["notify.telegram"],
              },
            },
          },
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("backward compatibility", () => {
    test("accepts config WITHOUT nativeTools or mcpServerTools", () => {
      const result = OperantConfigSchema.safeParse({
        agents: {
          ...baseAgents,
          toolScoping: {
            "ceo-strategic": {
              mcpServers: ["operant"],
            },
          },
        },
      });
      expect(result.success).toBe(true);
    });

    test("accepts config WITHOUT toolScoping at all", () => {
      const result = OperantConfigSchema.safeParse({
        agents: baseAgents,
      });
      expect(result.success).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// getAgentToolScope tests — scoping module correctness
// ---------------------------------------------------------------------------

describe("getAgentToolScope", () => {
  const allAgentIds = [
    "ceo-strategic",
    "coo-productivity",
    "cpo-psychologist",
    "cro-relational",
    "cfo-financial",
    "cmo-content",
    "physician-health",
    "cio-intelligence",
  ];

  describe("agent-specific scopes", () => {
    test("ceo-strategic returns correct scope (all essentials + occasionals)", () => {
      const scope = getAgentToolScope("ceo-strategic");
      expect(scope.length).toBeGreaterThanOrEqual(48);
      expect(scope).toContain("notify.telegram");
      expect(scope).toContain("board.viewReports");
      expect(scope).toContain("board.reassign");
    });

    test("physician-health returns minimal scope (advisory role)", () => {
      const scope = getAgentToolScope("physician-health");
      expect(scope.length).toBeLessThan(40);
      expect(scope).not.toContain("board.viewReports");
    });

    test("unknown-agent returns empty array", () => {
      const scope = getAgentToolScope("unknown-agent");
      expect(scope).toEqual([]);
    });
  });

  describe("security constraints", () => {
    test("no agent includes any sessions.* tool", () => {
      for (const agentId of allAgentIds) {
        const scope = getAgentToolScope(agentId);
        const sessionTools = scope.filter((t) => t.startsWith("sessions."));
        expect(sessionTools, `${agentId} should not have sessions.* tools`).toHaveLength(0);
      }
    });

    test("notify.telegram is available to all core staff agents", () => {
      for (const agentId of allAgentIds) {
        const scope = getAgentToolScope(agentId);
        expect(scope, `${agentId} should include notify.telegram`).toContain("notify.telegram");
      }
    });
  });

  describe("board tool access", () => {
    test("only ceo-strategic and coo-productivity include board.viewReports and board.reassign", () => {
      const boardTools = ["board.viewReports", "board.reassign"];
      const agentsWithBoardAccess = ["ceo-strategic", "coo-productivity"];

      for (const tool of boardTools) {
        for (const agentId of allAgentIds) {
          const scope = getAgentToolScope(agentId);
          const hasTool = scope.includes(tool);
          if (agentsWithBoardAccess.includes(agentId)) {
            expect(hasTool, `${agentId} should include ${tool}`).toBe(true);
          } else {
            expect(hasTool, `${agentId} should NOT include ${tool}`).toBe(false);
          }
        }
      }
    });
  });
});
