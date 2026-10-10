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
const { flags, switches } = parseArgs(process.argv.slice(P.TWO));
const pick = (flag, envKey, fallback) => flags.get(flag) ?? process.env[envKey] ?? fallback;
const repoPath = resolve(pick("repo", CLI.ENV.REPO, process.cwd()));
const port = Number(pick("port", CLI.ENV.PORT, String(SERVER.DEFAULT_PORT)));
const mode = pick("mode", CLI.ENV.MODE, CLI.DEFAULT_MODE);
const base = pick("base", CLI.ENV.BASE, undefined);
const head = pick("head", CLI.ENV.HEAD, undefined);
const prNumber = pick("pr", CLI.ENV.PR, undefined);
const title = pick("title", CLI.ENV.TITLE, undefined);
const jsonOnly = switches.has("json") || process.env[CLI.ENV.OPEN] === "0";
