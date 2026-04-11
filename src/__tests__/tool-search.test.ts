// Tool Search Tests
import { describe, test, expect } from "bun:test";
import { ToolSearch, searchTools } from "../runtime/tool-search";

const mockTools = [
  {
    name: "memory.search",
    description: "Search memory with vector similarity and metadata filters",
    parameters: { type: "object" },
    permissionTier: "read" as const,
  },
  {
    name: "memory.upsert",
    description: "Save a memory with scope, type, and automatic deduplication",
    parameters: { type: "object" },
    permissionTier: "write" as const,
  },
  {
    name: "memory.forget",
    description: "Delete memories by ID or tag",
    parameters: { type: "object" },
    permissionTier: "danger" as const,
  },
  {
    name: "board.addCard",
    description: "Add a Kanban task to an agent board",
    parameters: { type: "object" },
    permissionTier: "write" as const,
  },
  {
    name: "board.moveCard",
    description: "Move a card between columns on the board",
    parameters: { type: "object" },
    permissionTier: "write" as const,
  },
  {
    name: "message.send",
    description: "Send a message to another agent",
    parameters: { type: "object" },
    permissionTier: "write" as const,
  },
];

describe("ToolSearch", () => {
  const search = new ToolSearch(mockTools);

  describe("search", () => {
    test("exact name match scores highest", () => {
      const results = search.search("memory.search");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe("memory.search");
    });

    test("returns empty for empty query", () => {
      expect(search.search("")).toEqual([]);
      expect(search.search("   ")).toEqual([]);
    });

    test("searches by description terms", () => {
      const results = search.search("kanban task");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe("board.addCard");
    });

    test("returns results sorted by score descending", () => {
      const results = search.search("memory");
      expect(results.length).toBe(3);
      expect(results[0].matchScore).toBeGreaterThanOrEqual(results[1].matchScore);
      expect(results[1].matchScore).toBeGreaterThanOrEqual(results[2].matchScore);
    });

    test("maxResults limits output", () => {
      const results = search.search("memory", 1);
      expect(results).toHaveLength(1);
    });

    test("name prefix match scores higher than description match", () => {
      const results = search.search("board");
      // board.addCard and board.moveCard both have "board" in name (prefix = 10)
      // message.send does not have "board" in name
      const boardResults = results.filter((r) => r.name.startsWith("board."));
      const nonBoardResults = results.filter((r) => !r.name.startsWith("board."));
      // Board results should have higher or equal scores
      if (boardResults.length > 0 && nonBoardResults.length > 0) {
        expect(boardResults[0].matchScore).toBeGreaterThan(nonBoardResults[0].matchScore);
      }
    });

    test("fuzzy match gives bonus points", () => {
      // "msg" should fuzzy match "message.send"
      const results = search.search("msg");
      const msgResult = results.find((r) => r.name === "message.send");
      expect(msgResult).toBeDefined();
    });

    test("case-insensitive search", () => {
      const lowerResults = search.search("memory");
      const upperResults = search.search("MEMORY");
      expect(lowerResults.map((r) => r.name)).toEqual(upperResults.map((r) => r.name));
    });

    test("no matches returns empty array", () => {
      const results = search.search("xyznonexistent123");
      expect(results).toEqual([]);
    });

    test("multi-term query scores correctly", () => {
      const results = search.search("memory delete");
      // memory.forget should match both "memory" (name) and "delete" (desc)
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("ToolSearchResult shape", () => {
    test("result includes all required fields", () => {
      const results = search.search("memory");
      for (const r of results) {
        expect(r).toHaveProperty("name");
        expect(r).toHaveProperty("description");
        expect(r).toHaveProperty("permissionTier");
        expect(r).toHaveProperty("matchScore");
        expect(typeof r.matchScore).toBe("number");
      }
    });

    test("permissionTier defaults to read when not on tool", () => {
      const toolsWithoutTier = [
        { name: "test.tool", description: "test", parameters: {} },
      ];
      const s = new ToolSearch(toolsWithoutTier as any);
      const results = s.search("test");
      expect(results[0].permissionTier).toBe("read");
    });
  });
});

describe("searchTools convenience function", () => {
  test("searchTools calls the singleton instance", () => {
    // This will use the real tool definitions from getAllToolDefinitions()
    const results = searchTools("memory");
    expect(Array.isArray(results)).toBe(true);
    // Should find memory tools
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toContain("memory");
  });
});
