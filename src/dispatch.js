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
