#!/usr/bin/env node
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve built CLI program
const buildPath = join(__dirname, "../build/cli/program.js");
const srcPath = join(__dirname, "../src/cli/program.ts");

async function run() {
  let mod;
  try {
    mod = await import(buildPath);
  } catch {
    try {
      mod = await import(srcPath);
    } catch {
      console.error("Error: Cannot find Operant CLI program.");
      console.error("Run: bun run build");
      process.exit(1);
    }
  }
  if (mod.main) await mod.main();
}

run();
