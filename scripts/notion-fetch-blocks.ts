#!/usr/bin/env bun
/**
 * Notion Block Content Fetcher
 *
 * Fetches page body content (blocks) for every row in every Notion database backup,
 * converts blocks to markdown, and patches the JSON files with a `page_body` field.
 *
 * Usage:
 *   bun run scripts/notion-fetch-blocks.ts              # Fetch all blocks
 *   bun run scripts/notion-fetch-blocks.ts --dry-run    # Preview counts only
 *   bun run scripts/notion-fetch-blocks.ts --db people  # Only specific databases
 *
 * Environment:
 *   NOTION_API_KEY        — Notion integration token (ntn_...)
 *   NOTION_BACKUP_DIR     — Path to notion-backup directory (default: ../notion-backup)
 */

import "dotenv/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFile, writeFile } from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const BACKUP_DIR = process.env.NOTION_BACKUP_DIR ?? resolve(PROJECT_ROOT, "../notion-backup");
const NOTION_API_KEY = process.env.NOTION_API_KEY;

if (!NOTION_API_KEY) {
  console.error("ERROR: NOTION_API_KEY required (set to your ntn_... integration token)");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");
const dbFlagIndex = process.argv.indexOf("--db");
const FILTERED_DBS: string[] = dbFlagIndex >= 0
  ? process.argv[dbFlagIndex + 1]?.split(",").map((s) => s.trim()) ?? []
  : [];

const BASE_URL = "https://api.notion.com/v1";
const RATE_LIMIT_MS = 350;

let lastRequest = 0;
let totalFetched = 0;
let totalErrors = 0;
let totalEmpty = 0;
let requestsThisMinute = 0;
let minuteStart = Date.now();

async function rateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequest;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastRequest = Date.now();

  const minsSinceStart = (Date.now() - minuteStart) / 60000;
  if (minsSinceStart < 1) {
    requestsThisMinute++;
    if (requestsThisMinute >= 90) {
      const waitMs = 60000 - (Date.now() - minuteStart);
      if (waitMs > 0) {
        console.log(`  ⏳ Rate limit approaching, waiting ${Math.ceil(waitMs / 1000)}s...`);
        await new Promise((r) => setTimeout(r, waitMs + 100));
        requestsThisMinute = 0;
        minuteStart = Date.now();
      }
    }
  } else {
    requestsThisMinute = 0;
    minuteStart = Date.now();
  }
}

async function notionFetch(path: string): Promise<any> {
  await rateLimit();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
    },
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("retry-after") || "30", 10);
    console.log(`  ⏳ Rate limited, waiting ${retryAfter}s...`);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return notionFetch(path);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Notion API ${res.status}: ${err.code || res.statusText} - ${err.message || ""}`);
  }

  return res.json();
}

async function fetchAllBlocks(pageId: string): Promise<any[]> {
  const allBlocks: any[] = [];
  let cursor: string | undefined;

  while (true) {
    const qs = cursor ? `?start_cursor=${cursor}` : "";
    const data = await notionFetch(`/blocks/${pageId}/children${qs}`);
    allBlocks.push(...(data.results || []));
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }

  return allBlocks;
}

function blocksToMarkdown(blocks: any[], depth = 0): string {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);

  for (const block of blocks) {
    const type = block.type;
    if (!type || !block[type]) continue;
    const content = block[type];
    const text = richTextToPlain(content.rich_text || []);

    switch (type) {
      case "heading_1":
        lines.push(`\n${indent}# ${text}\n`);
        break;
      case "heading_2":
        lines.push(`\n${indent}## ${text}\n`);
        break;
      case "heading_3":
        lines.push(`\n${indent}### ${text}\n`);
        break;
      case "paragraph":
        lines.push(text ? `${indent}${text}` : "");
        break;
      case "bulleted_list_item":
        lines.push(`${indent}- ${text}`);
        break;
      case "numbered_list_item":
        lines.push(`${indent}1. ${text}`);
        break;
      case "to_do":
        lines.push(`${indent}- [${content.checked ? "x" : " "}] ${text}`);
        break;
      case "toggle":
        lines.push(`${indent}<details><summary>${text}</summary>`);
        if (content.children?.length) {
          lines.push(blocksToMarkdown(content.children, depth + 1));
        }
        lines.push(`${indent}</details>`);
        break;
      case "quote":
        lines.push(`${indent}> ${text}`);
        break;
      case "callout":
        const icon = content.icon?.emoji || "";
        lines.push(`${indent}> ${icon} ${text}`);
        break;
      case "code":
        const lang = content.language || "";
        lines.push(`${indent}\`\`\`${lang}\n${text}\n${indent}\`\`\``);
        break;
      case "divider":
        lines.push(`${indent}---`);
        break;
      case "image":
        const imgUrl = content.type === "external" ? content.external?.url : content.file?.url;
        if (imgUrl) lines.push(`${indent}![image](${imgUrl})`);
        break;
      case "table": {
        const tableRows = (block as any).table_rows || [];
        for (const tr of tableRows) {
          const cells = (tr as any).cells?.map((c: any[]) => richTextToPlain(c)) || [];
          lines.push(`${indent}| ${cells.join(" | ")} |`);
        }
        break;
      }
      default:
        if (text) lines.push(`${indent}${text}`);
    }

    if (content.children?.length) {
      lines.push(blocksToMarkdown(content.children, depth + 1));
    }
  }

  return lines.join("\n");
}

function richTextToPlain(richText: any[]): string {
  if (!Array.isArray(richText)) return "";
  return richText
    .map((rt) => {
      let text = rt.plain_text || "";
      if (rt.annotations?.bold) text = `**${text}**`;
      if (rt.annotations?.italic) text = `*${text}*`;
      if (rt.annotations?.code) text = `\`${text}\``;
      if (rt.href) text = `[${text}](${rt.href})`;
      return text;
    })
    .join("");
}

async function main() {
  console.log("=".repeat(70));
  console.log("Notion Block Content Fetcher");
  console.log("=".repeat(70));
  console.log(`Backup dir: ${BACKUP_DIR}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Started: ${new Date().toISOString()}`);

  const dbDir = resolve(String(BACKUP_DIR), "notion/databases");
  const manifestPath = resolve(String(BACKUP_DIR), "notion/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

  const dbs = manifest.databases.filter((d: any) => d.row_count > 0);
  const targetDbs = FILTERED_DBS.length > 0
    ? dbs.filter((d: any) => FILTERED_DBS.includes(d.normalized_name))
    : dbs;

  console.log(`\nDatabases to process: ${targetDbs.length} (${manifest.total_rows} total rows)`);

  if (DRY_RUN) {
    for (const db of targetDbs) {
      console.log(`  ${db.normalized_name.padEnd(50)} ${String(db.row_count).padStart(6)} rows`);
    }
    console.log("\n[DRY RUN] No API calls made");
    return;
  }

  let dbProcessed = 0;

  for (const db of targetDbs) {
    const genericFile = db.normalized_name.replace(/[^a-z0-9_]/g, "_") + ".json";
    const filePath = resolve(dbDir, genericFile);

    let rows: any[];
    try {
      rows = JSON.parse(await readFile(filePath, "utf-8"));
    } catch {
      console.log(`  ⏭️  ${genericFile} not found — skipping`);
      continue;
    }

    const t0 = Date.now();
    console.log(`\n📄 ${db.normalized_name} (${rows.length} pages)...`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const pageId = row.notion_id;
      if (!pageId) { skipped++; continue; }

      try {
        const blocks = await fetchAllBlocks(pageId);
        totalFetched++;

        if (blocks.length === 0) {
          totalEmpty++;
          row.page_body = null;
        } else {
          const markdown = blocksToMarkdown(blocks);
          row.page_body = markdown.trim() || null;
          updated++;
        }

        if ((i + 1) % 10 === 0 || i === rows.length - 1) {
          process.stdout.write(`  Progress: ${i + 1}/${rows.length} (${updated} with content, ${totalEmpty} empty)\r`);
        }
      } catch (e: any) {
        totalErrors++;
        errors++;
        row.page_body = `⚠️ Error fetching blocks: ${e.message}`;

        if (i === 0) {
          console.log(`  ⚠️  ${e.message.substring(0, 100)}`);
        }
      }
    }

    process.stdout.write("");
    const duration = Date.now() - t0;
    console.log(`  ✅ ${updated} pages with content, ${errors} errors (${(duration / 1000).toFixed(1)}s)`);

    // Write updated JSON
    await writeFile(filePath, JSON.stringify(rows, null, 2));
    dbProcessed++;
  }

  console.log("\n" + "=".repeat(70));
  console.log("BLOCK FETCH COMPLETE");
  console.log("=".repeat(70));
  console.log(`Databases processed: ${dbProcessed}`);
  console.log(`Pages with content: ${totalFetched - totalErrors}`);
  console.log(`Pages empty (no blocks): ${totalEmpty}`);
  console.log(`Errors: ${totalErrors}`);
  console.log("=".repeat(70));
}

main().catch((e) => {
  console.error("\n❌ Fatal error:", e.message);
  if (e.stack) console.error(e.stack.split("\n").slice(0, 5).join("\n"));
  process.exit(1);
});
