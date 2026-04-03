import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { logger } from "../logger.js";

export class OpenCodeACP {
  private proc?: ChildProcessWithoutNullStreams;
  private initialized = false;

  start(cwd: string) {
    if (this.proc) return;
    this.proc = spawn("opencode", ["acp", "--cwd", cwd], { stdio: ["pipe","pipe","pipe"] });
    this.proc.stderr.on("data", (d) => logger.debug({ line: d.toString() }, "opencode stderr"));
  }
}
