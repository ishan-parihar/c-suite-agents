// Document Parse Tool — Extracts text content from various file types
// Standalone implementation — no cross-dependencies with other tools

import { realpathSync, statSync, type Stats } from "node:fs";
import { promises as fs } from "node:fs";
import { extname, isAbsolute, resolve, sep } from "node:path";
import { logger } from "../../logger.js";
import { getAgentWorkspace } from "../../agents/workspace-manager.js";

interface AnyAgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (toolCallId: string, args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

// Maximum file size: 200KB
const MAX_FILE_SIZE = 200 * 1024;

// Default max characters to return
const DEFAULT_MAX_LENGTH = 50000;

// File type categories
const TEXT_TYPES = new Set([
  ".md", ".markdown", ".txt", ".text", ".log",
]);

const CODE_TYPES = new Set([
  ".js", ".ts", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp",
]);

const MARKUP_TYPES = new Set([
  ".html", ".htm", ".xml", ".svg",
]);

const DATA_TYPES = new Set([
  ".csv", ".json", ".yaml", ".yml",
]);

const MDX_TYPES = new Set([
  ".mdx",
]);

const PDF_TYPE = new Set([".pdf"]);

function getFileTypeCategory(ext: string): string | null {
  const lower = ext.toLowerCase();
  if (TEXT_TYPES.has(lower)) return "text";
  if (CODE_TYPES.has(lower)) return "code";
  if (MARKUP_TYPES.has(lower)) return "markup";
  if (DATA_TYPES.has(lower)) return "data";
  if (MDX_TYPES.has(lower)) return "mdx";
  if (PDF_TYPE.has(lower)) return "pdf";
  return null;
}

/**
 * Extract readable text from a PDF buffer by scanning for sequences
 * of printable ASCII/UTF-8 characters. Not a full PDF parser — just
 * basic text extraction for LLM consumption.
 */
function extractTextFromPdf(buffer: Buffer): string {
  const MIN_RUN_LENGTH = 4;
  const textRuns: string[] = [];
  let currentRun: number[] = [];

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    // Printable ASCII (32-126), newline (10), carriage return (13), tab (9)
    if (
      (byte >= 32 && byte <= 126) ||
      byte === 10 ||
      byte === 13 ||
      byte === 9
    ) {
      currentRun.push(byte);
    } else {
      if (currentRun.length >= MIN_RUN_LENGTH) {
        textRuns.push(Buffer.from(currentRun).toString("utf-8"));
      }
      currentRun = [];
    }
  }

  // Don't forget the last run
  if (currentRun.length >= MIN_RUN_LENGTH) {
    textRuns.push(Buffer.from(currentRun).toString("utf-8"));
  }

  return textRuns.join("\n");
}

export function createDocumentParseTool(): AnyAgentTool | null {
  return {
    name: "document.parse",
    description: "Extract text content from documents. Supports PDF, Markdown, plain text, CSV, JSON, code files, HTML, XML, YAML.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the file to parse" },
        max_length: { type: "number", description: "Maximum characters to return (default: 50000)", default: DEFAULT_MAX_LENGTH },
      },
      required: ["file_path"],
    },
    execute: async (_toolCallId: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      try {
        const filePath = args.file_path as string | undefined;
        if (!filePath) {
          return { content: [{ type: "text", text: "Error: Missing required parameter 'file_path'." }] };
        }

        const maxLength = (args.max_length as number) || DEFAULT_MAX_LENGTH;

        // Sandbox: resolve path and enforce workspace containment
        const agentId = (args.agent_id as string) || "unknown";
        const workspaceDir = getAgentWorkspace(agentId);
        let resolvedPath = isAbsolute(filePath) ? resolve(filePath) : resolve(workspaceDir, filePath);
        try {
          resolvedPath = realpathSync(resolvedPath);
        } catch {
          return { content: [{ type: "text", text: `Error: File not found: ${filePath}` }] };
        }
        if (!(resolvedPath === workspaceDir || resolvedPath.startsWith(workspaceDir + sep))) {
          logger.warn({ agentId, filePath, workspaceDir }, "document.parse: path outside workspace");
          return { content: [{ type: "text", text: `Error: File path must be within workspace directory.` }] };
        }

        // Validate file exists
        let stats: Stats;
        try {
          stats = statSync(resolvedPath);
        } catch {
          return { content: [{ type: "text", text: `Error: File not found: ${filePath}` }] };
        }

        if (!stats.isFile()) {
          return { content: [{ type: "text", text: `Error: Not a file: ${filePath}` }] };
        }

        // Check file size
        const fileSize = stats.size;
        if (fileSize > MAX_FILE_SIZE) {
          const sizeKB = Math.round(fileSize / 1024);
          return { content: [{ type: "text", text: `Error: File too large (${sizeKB}KB). Maximum: 200KB.` }] };
        }

        // Determine file type by extension
        const ext = extname(resolvedPath);
        const category = getFileTypeCategory(ext);

        if (category === null) {
          return { content: [{ type: "text", text: `Error: Unsupported file type: ${ext}` }] };
        }

        // Read file content
        let extractedText: string;
        const buffer = await fs.readFile(resolvedPath);

        switch (category) {
          case "pdf": {
            extractedText = extractTextFromPdf(buffer);
            break;
          }

          case "data": {
            const lowerExt = ext.toLowerCase();
            if (lowerExt === ".json") {
              // Try to parse and re-format JSON
              const raw = buffer.toString("utf-8");
              try {
                const parsed = JSON.parse(raw);
                extractedText = JSON.stringify(parsed, null, 2);
              } catch {
                extractedText = raw;
              }
            } else {
              extractedText = buffer.toString("utf-8");
            }
            break;
          }

          default: {
            // text, code, markup, mdx — all read as UTF-8
            extractedText = buffer.toString("utf-8");
            break;
          }
        }

        // Truncate if needed
        const fileName = filePath.split("/").pop() || filePath;
        let displayText = extractedText;
        if (displayText.length > maxLength) {
          displayText = displayText.slice(0, maxLength) + "\n\n... (truncated)";
        }

        // Determine human-readable file type label
        const typeLabel = category === "pdf" ? "PDF Document"
          : category === "text" ? "Text File"
          : category === "code" ? "Source Code"
          : category === "markup" ? "Markup Document"
          : category === "data" ? "Data File"
          : category === "mdx" ? "MDX Document"
          : "Unknown";

        const result = `📄 Document: ${fileName}\nType: ${typeLabel}\nSize: ${fileSize} bytes\n\n${displayText}`;

        logger.info({ filePath, fileSize, category }, "document.parse completed");

        return { content: [{ type: "text", text: result }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, "document.parse failed");
        return { content: [{ type: "text", text: `Error: ${msg}` }] };
      }
    },
  };
}
