/** Hands a submitted review back to the OpenCode session that opened it, so the agent starts… */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, relative as relativePath, sep } from "node:path";
import { AGENT, ARTIFACTS, P } from "./config.js";
/** Env var OpenCode sets for every child process it starts. */
const SESSION_ENV = "OPENCODE_SESSION_ID";
const SESSION_ENV_ALT = "OPENCODE_SESSION";
/** The API reports an unknown session id as a 404 / "not found". */
const SESSION_MISSING = /404|not found|unknown session/i;
/** Returns the session id this review page belongs to, if any. */
export function currentSessionId(env = process.env) {
  return env[SESSION_ENV] || env[SESSION_ENV_ALT] || null;
}
/** The session id carried by an MCP tool call. */
export function sessionIdFromCall(extra) {
  const meta = extra?._meta;
  if (!meta || typeof meta !== "object") return null;

  const value = meta[AGENT.META_SESSION_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
/** The session that owns a review. */
export function resolveSessionId(explicit, extra, env = process.env) {
  return explicit?.trim() || sessionIdFromCall(extra) || currentSessionId(env);
}
/** Finds the real executable behind the `opencode` command. */
export function resolveAgentBinary(env = process.env) {
  const candidates = AGENT.BINARY_CANDIDATES.map((template) =>
    normalizePath(
      template
        .replace(AGENT.ENV_PLACEHOLDER.APP_DATA, env.APPDATA || P.EMPTY)
        .replace(AGENT.ENV_PLACEHOLDER.LOCAL_APP_DATA, env.LOCALAPPDATA || P.EMPTY)
        .replace(AGENT.ENV_PLACEHOLDER.PROGRAM_FILES, env.ProgramFiles || P.EMPTY),
    ),
  );

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /** an unreadable candidate is simply skipped */
    }
  }

  return null;
}
