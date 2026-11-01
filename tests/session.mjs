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
const CALLER = "ses_caller0000X9NWwt6AM3uGwx";
const INHERITED = "ses_inherited0ffe2JWJYfmaAXZH1U";
const meta = { _meta: { [AGENT.META_SESSION_KEY]: CALLER } };
await check("the session of the call is read from the call metadata", () => {
  assert.equal(sessionIdFromCall(meta), CALLER);
});
await check("no metadata means no session, not a guess", () => {
  assert.equal(sessionIdFromCall(undefined), null);
  assert.equal(sessionIdFromCall({}), null);
  assert.equal(sessionIdFromCall({ _meta: {} }), null);
  assert.equal(sessionIdFromCall({ _meta: { [AGENT.META_SESSION_KEY]: "  " } }), null);
});
await check("the calling session beats the inherited environment", () => {
  const env = { OPENCODE_SESSION_ID: INHERITED };
  assert.equal(resolveSessionId(undefined, meta, env), CALLER);
});
await check("an explicit argument beats everything", () => {
  const env = { OPENCODE_SESSION_ID: INHERITED };
  assert.equal(resolveSessionId("ses_explicit", meta, env), "ses_explicit");
});
await check("the environment is the fallback when no call context arrives", () => {
  const env = { OPENCODE_SESSION_ID: INHERITED };
  assert.equal(resolveSessionId(undefined, undefined, env), INHERITED);
  assert.equal(currentSessionId(env), INHERITED);
});
await check("no source at all yields null instead of a stray id", () => {
  assert.equal(resolveSessionId(undefined, undefined, {}), null);
});
const dir = await mkdtemp(join(tmpdir(), "pr-review-owner-"));
await check("the owner of a review is recorded and read back", async () => {
  await writeReviewOwner(dir, INHERITED);
  assert.equal(await readReviewOwner(dir), INHERITED);
});
await check("reusing a page hands the review to the new session", async () => {
  // The page was opened for one session and reused by another; the owner must
  // move, or the next submit goes back to the first session.
  await writeReviewOwner(dir, CALLER);
  assert.equal(await readReviewOwner(dir), CALLER);
});
