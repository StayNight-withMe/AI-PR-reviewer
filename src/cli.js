/** The single entry point every editor integration calls. */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { currentBranch, resolveRepo } from "./git.js";
import { startReview } from "./core.js";
import { CLI, MODE, P, SERVER } from "./config.js";
/** --------------------------------- parsing -------------------------------- */
/** Reads `--flag value` and `--flag` from argv, with the environment as fallback. */
function parseArgs(argv) {
  const flags = new Map();
  const switches = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const name = token.slice(P.TWO);
    const next = argv[index + P.ONE];
    if (next === undefined || next.startsWith("--")) switches.add(name);
    else {
      flags.set(name, next);
      index += P.ONE;
    }
  }

  return { flags, switches };
}
