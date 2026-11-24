
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, relative as relativePath, sep } from "node:path";
import { AGENT, ARTIFACTS, P, REVIEW_STATE } from "./config.js";

const SESSION_ENV = "OPENCODE_SESSION_ID";
const SESSION_ENV_ALT = "OPENCODE_SESSION";

const SESSION_MISSING = /404|not found|unknown session/i;

export function currentSessionId(env = process.env) {
  return env[SESSION_ENV] || env[SESSION_ENV_ALT] || null;
}

export function sessionIdFromCall(extra) {
  const meta = extra?._meta;
  if (!meta || typeof meta !== "object") return null;

  const value = meta[AGENT.META_SESSION_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveSessionId(explicit, extra, env = process.env) {
  return explicit?.trim() || sessionIdFromCall(extra) || currentSessionId(env);
}

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

    }
  }

  return null;
}

function normalizePath(value) {
  return process.platform === AGENT.SHELL_PLATFORMS.WIN32
    ? value.split(P.SLASH).join(P.BACKSLASH)
    : value;
}

export function buildDispatchPrompt(review, meta, paths) {
  const state = review?.reviewState ?? P.EMPTY;
  const comments = Array.isArray(review?.comments) ? review.comments : [];
  const body = String(review?.reviewBody ?? P.EMPTY).trim();
  const approved = state === REVIEW_STATE.APPROVE;

  const opening = approved
    ? [
        "A review was submitted and the changes were APPROVED. The work is accepted as it is.",
        "Do not rewrite anything on your own initiative. Read the notes below only to catch a",
        "small detail the reviewer mentioned; everything else is fine and must stay as it is.",
      ]
    : ["A review was submitted from the review page. Start fixing the code now."];

  const lines = [
    ...opening,
    P.EMPTY,
    `Repo: ${meta?.repo ?? P.EMPTY}`,
    `Branch: ${meta?.branch ?? P.EMPTY}`,
    `Scope: ${meta?.mode ?? P.EMPTY}${meta?.base ? ` ${meta.base}...${meta.head ?? "HEAD"}` : P.EMPTY}`,
    `Review state: ${state}`,
    `Review JSON: ${paths?.jsonPath ?? P.EMPTY}`,
    `Review Markdown: ${paths?.markdownPath ?? P.EMPTY}`,
  ];

  if (body) lines.push("", approved ? "Note from the reviewer:" : "Summary from the reviewer:", body);

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
  } else if (approved) {

    lines.push(P.EMPTY, body
      ? "No inline comments; the note above is the only remark."
      : "No inline comments and no note; the reviewer approved the changes as they are.");
  } else {
    lines.push(P.EMPTY, "No inline comments; use the summary and the diff.");
  }

  lines.push(
    P.EMPTY,
    approved
      ? "Read review.json for the full payload. Confirm briefly what you changed, if anything."
      : "Read review.json for the full payload, apply the fixes, and report what changed.",
  );

  return lines.join("\n");
}

export async function writeDispatchPrompt(outputDir, prompt) {
  const file = join(outputDir, ARTIFACTS.DISPATCH_PROMPT);
  await writeFile(file, prompt, "utf8");
  return file;
}

export function buildDispatchMessage(promptFile, root) {
  const path = relativePath(root, promptFile).split(sep).join(P.SLASH);
  return `Read ${path} and start fixing the code review described there.`;
}

const inflight = new Map();

async function sessionExists(sessionId, { cwd, env = process.env } = {}) {
  const binary = resolveAgentBinary(env);
  if (!binary) return true;

  const args = [
    ...AGENT.ARGS.API_GET,
    AGENT.FLAG_PARAM,
    AGENT.PARAM_SESSION.replace("{id}", sessionId),
  ];

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(binary, args, {
        cwd: cwd || process.cwd(),
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
        detached: false,
        shell: false,
      });
    } catch {
      resolve(true);
      return;
    }

    let errors = "";
    child.stderr.on("data", (chunk) => { errors += chunk; });

    child.once("error", () => resolve(true));
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(true);
        return;
      }
      resolve(!SESSION_MISSING.test(errors));
    });
  });
}

async function promptSessionViaApi(sessionId, message, { cwd, env = process.env } = {}) {
  const binary = resolveAgentBinary(env);
  if (!binary) return { started: false, reason: AGENT.ERROR_NO_BINARY };

  if (!(await sessionExists(sessionId, { cwd, env }))) {
    return { started: false, reason: AGENT.ERROR_SESSION_MISSING, sessionMissing: true };
  }

  const args = [
    ...AGENT.ARGS.API,
    AGENT.FLAG_PARAM,
    AGENT.PARAM_SESSION.replace("{id}", sessionId),
    "--data",
    JSON.stringify({ [AGENT.BODY_FIELD]: message }),
  ];

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(binary, args, {
        cwd: cwd || process.cwd(),
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
        detached: false,
        shell: false,
      });
    } catch (error) {
      resolve({ started: false, reason: String(error.message) });
      return;
    }

    let errors = "";
    child.stderr.on("data", (chunk) => { errors += chunk; });

    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.once("error", (error) => settle({ started: false, reason: String(error.message) }));
    child.once("exit", (code) => {
      if (code === 0) {
        settle({ started: true, binary: "api" });
        return;
      }


      if (SESSION_MISSING.test(errors)) {
        settle({ started: false, reason: AGENT.ERROR_SESSION_MISSING, sessionMissing: true });
        return;
      }
      settle({ started: false, reason: AGENT.ERROR_API_FAILED });
    });
  });
}

export async function dispatchToSession(sessionId, message, { cwd, env = process.env, promptKey = message } = {}) {
  if (!sessionId) {
    return { started: false, reason: AGENT.ERROR_NO_SESSION };
  }

  const running = inflight.get(sessionId);
  if (running) {

    if (running.promptKey === promptKey) {
      return { started: true, binary: running.binary, duplicate: true };
    }

    stopTurn(running);
  }

  const viaApi = await promptSessionViaApi(sessionId, message, { cwd, env });
  if (viaApi.started) {
    inflight.set(sessionId, { child: null, promptKey, binary: "api" });
    return viaApi;
  }
  if (viaApi.sessionMissing) return viaApi;

  const binary = resolveAgentBinary(env);
  const args = [...AGENT.ARGS.RUN, AGENT.FLAG_SESSION, sessionId, message];


  const command = binary || AGENT.BIN;
  const needsShell = !binary && process.platform === AGENT.SHELL_PLATFORMS.WIN32;

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: cwd || process.cwd(),
        stdio: "ignore",
        windowsHide: true,
        detached: false,
        shell: needsShell,
      });
    } catch (error) {
      resolve({ started: false, reason: String(error.message) });
      return;
    }

    const turn = { child, promptKey, binary: binary ? "native" : "shim" };
    inflight.set(sessionId, turn);
    child.once("exit", () => {
      if (inflight.get(sessionId) === turn) inflight.delete(sessionId);
    });

    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.once("error", (error) => settle({ started: false, reason: String(error.message) }));
    child.once("spawn", () => {

      child.unref();
      settle({ started: true, binary: binary ? "native" : "shim" });
    });


    setTimeout(() => settle({ started: true }), AGENT.SPAWN_GRACE_MS);
  });
}

function stopTurn(turn) {
  try {
    turn.child.kill();
  } catch {

  }
}
