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
/** `%APPDATA%/npm/...` mixes separators; Node wants one style on Windows. */
function normalizePath(value) {
  return process.platform === AGENT.SHELL_PLATFORMS.WIN32
    ? value.split(P.SLASH).join(P.BACKSLASH)
    : value;
}
/** Builds the prompt the agent receives. */
export function buildDispatchPrompt(review, meta, paths) {
  const state = review?.reviewState ?? P.EMPTY;
  const comments = Array.isArray(review?.comments) ? review.comments : [];
  const body = String(review?.reviewBody ?? P.EMPTY).trim();

  const lines = [
    "A review was submitted from the review page. Start fixing the code now.",
    P.EMPTY,
    `Repo: ${meta?.repo ?? P.EMPTY}`,
    `Branch: ${meta?.branch ?? P.EMPTY}`,
    `Scope: ${meta?.mode ?? P.EMPTY}${meta?.base ? ` ${meta.base}...${meta.head ?? "HEAD"}` : P.EMPTY}`,
    `Review state: ${state}`,
    `Review JSON: ${paths?.jsonPath ?? P.EMPTY}`,
    `Review Markdown: ${paths?.markdownPath ?? P.EMPTY}`,
  ];

  if (body) lines.push("", "Summary from the reviewer:", body);

  if (comments.length) {
    lines.push(P.EMPTY, `Inline comments (${comments.length}):`);
    for (const comment of comments) {
      const range = comment.lineEnd && comment.lineEnd !== comment.lineStart
        ? `-${comment.lineEnd}`
        : P.EMPTY;
      const text = String(comment.body ?? P.EMPTY).replace(/\s+/g, " ").trim();
      const done = comment.resolved === true ? " [already resolved]" : P.EMPTY;
      lines.push(`- ${comment.path}:${comment.lineStart}${range} — ${text}${done}`);
    }
  } else {
    lines.push(P.EMPTY, "No inline comments; use the summary and the diff.");
  }

  lines.push(
    P.EMPTY,
    "Read review.json for the full payload, apply the fixes, and report what changed.",
  );

  return lines.join("\n");
}
