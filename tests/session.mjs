/**
 * The review must return to the session that is using it.
 *
 * The bug: the target session was taken from the MCP process environment, which
 * belongs to whichever OpenCode service started the server, not to the chat the
 * user is in. The fix turn then landed in a foreign session and the chat stayed
 * empty while the page said "sent".
 *
 * Two rules are checked here: the calling session (sent in the MCP call
 * metadata) wins over the environment, and the owner recorded next to the
 * review can be rewritten so a reused page follows the new caller.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentSessionId, resolveSessionId, sessionIdFromCall } from "../src/dispatch.js";
import { readReviewOwner, writeReviewOwner } from "../src/models/owner.js";
import { AGENT } from "../src/config.js";
const failures = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => console.log(`PASS ${name}`),
      (error) => {
        failures.push(`${name}: ${error.message}`);
        console.log(`FAIL ${name} — ${error.message}`);
      },
    );
}
