
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


  await writeReviewOwner(dir, CALLER);
  assert.equal(await readReviewOwner(dir), CALLER);
});
await check("a missing owner file is null, not a crash", async () => {
  const empty = await mkdtemp(join(tmpdir(), "pr-review-owner-empty-"));
  try {
    assert.equal(await readReviewOwner(empty), null);
    assert.equal(await readReviewOwner(null), null);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});
await rm(dir, { recursive: true, force: true });
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nAll session routing checks passed");
}
