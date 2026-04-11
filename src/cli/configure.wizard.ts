import { writeFileSync, chmodSync, renameSync } from "node:fs";
import * as crypto from "node:crypto";
import { CONFIGURE_SECTIONS, type WizardSection, promptSection } from "./configure.shared";
import { SECTION_HANDLERS } from "./configure.sections";
import { readConfigSnapshot, summarizeConfig } from "./config-snapshot";
import { applyWizardMetadata } from "./onboard-helpers";
import { OperantConfigSchema } from "../config/schema";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";

function heading(text: string): string {
  return `${BOLD}${CYAN}${text}${RESET}`;
}

function success(text: string): string {
  return `${GREEN}${text}${RESET}`;
}

function error(text: string): string {
  return `${RED}${text}${RESET}`;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function persistConfig(config: Record<string, unknown>, configPath: string): boolean {
  applyWizardMetadata(config);
  const wizard = config.wizard as Record<string, unknown>;
  wizard.lastRunCommand = "configure";
  wizard.lastRunMode = "configure";

  const result = OperantConfigSchema.safeParse(config);
  if (!result.success) {
    const firstError = result.error.errors[0];
    console.log(error(`Validation failed: ${firstError.path.join(".")} — ${firstError.message}`));
    return false;
  }

  const json = JSON.stringify(config, null, 2);
  const tmpConfigPath = `${configPath}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  writeFileSync(tmpConfigPath, json, "utf-8");
  renameSync(tmpConfigPath, configPath);
  chmodSync(configPath, 0o600);
  return true;
}

export async function runConfigureWizard(options?: { section?: string }): Promise<boolean> {
  const snapshot = readConfigSnapshot();

  if (!snapshot.exists) {
    console.error(error("No configuration found. Run 'operant onboard' first."));
    return false;
  }

  if (!snapshot.valid) {
    console.error(error("Config file is corrupted. Run 'operant reset' then 'operant onboard'."));
    if (snapshot.error) {
      console.error(DIM + snapshot.error + RESET);
    }
    return false;
  }

  const configPath = snapshot.path;
  let nextConfig = structuredClone(snapshot.config) as Record<string, unknown>;

  console.log(`\n${heading("Existing configuration detected:")}\n`);
  console.log(summarizeConfig(nextConfig));

  if (options?.section) {
    const handler = SECTION_HANDLERS[options.section as WizardSection];
    if (!handler) {
      console.error(error(`Unknown section: "${options.section}"`));
      console.log(`Available sections: ${CONFIGURE_SECTIONS.map((s) => s.id).join(", ")}`);
      return false;
    }

    console.log(`\n${heading(`Configuring: ${options.section}`)}\n`);
    const result = await handler(nextConfig);
    if (!persistConfig(result, configPath)) return false;
    console.log(`\n${success("Config saved.")}`);
    console.log(`\n${success("Configure complete. Run 'operant doctor' to verify.")}`);
    return true;
  }

  while (true) {
    const selected = await promptSection(CONFIGURE_SECTIONS, nextConfig);
    if (selected === "continue") break;

    const handler = SECTION_HANDLERS[selected];
    if (!handler) {
      console.error(error(`No handler for section: ${selected}`));
      continue;
    }

    console.log(`\n${heading(`Configuring: ${selected}`)}\n`);
    const result = await handler(nextConfig);
    nextConfig = deepMerge(nextConfig, result);
    if (!persistConfig(nextConfig, configPath)) {
      console.log(error("Config not saved — fix validation errors and retry."));
      continue;
    }
    console.log(`\n${success("Config saved.")}`);
  }

  console.log(`\n${success("Configure complete. Run 'operant doctor' to verify.")}`);
  return true;
}
