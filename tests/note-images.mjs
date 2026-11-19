/**
 * Screenshots in a review are stored as files next to review.json.
 *
 * The page sends them as data URLs, which means the server writes a file named
 * after whatever the client called it. That is a trust boundary: a hostile
 * comment id could contain `../`, and an uploaded `image/svg+xml` would be
 * saved as a scriptable document inside the review folder.
 *
 * Run: node tests/note-images.mjs
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startReview } from "../src/core.js";
import { GIT, MODE, ROUTES } from "../src/config.js";

const exec = promisify(execFile);
const failures = [];

function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

/** A one-pixel PNG, as the clipboard would give it. */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const root = await mkdtemp(join(tmpdir(), "pr-review-images-"));
const repo = join(root, "repo");
const git = (...args) => exec(GIT.BIN, args, { cwd: repo });

try {
  await exec(GIT.BIN, ["init", "--initial-branch", "main", repo]);
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");
  await writeFile(join(repo, "app.js"), "const a = 1;\n");
  await git("add", "-A");
  await git("commit", "-m", "init");
  await writeFile(join(repo, "app.js"), "const a = 1;\nconst b = 2;\n");

  for (const name of ["OPENCODE_SESSION_ID", "OPENCODE_SESSION"]) delete process.env[name];
  process.env[GIT.ARTIFACTS_DIR_ENV] = join(root, "artifacts");

  const review = await startReview({
    repoPath: repo, mode: MODE.UNCOMMITTED, port: 0, symbols: false,
    dispatchEnabled: false, sessionId: "",
  });
  const imagesDir = join(review.outputDir, "images");

  /** Submits a review and returns what the page answered. */
  const submit = async (body) => {
    const response = await fetch(new URL(ROUTES.API_REVIEW, review.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewState: "COMMENT", reviewBody: "", ...body }),
    });
    return { status: response.status, payload: await response.json().catch(() => null) };
  };

  await check("a pasted screenshot is saved as a file and linked", async () => {
    const result = await submit({
      comments: [{ id: "c1", path: "app.js", side: "right", lineStart: 2, lineEnd: 2, body: "see this", images: [{ dataUrl: PNG }] }],
    });
    assert.equal(result.status, 200, "the review was refused");
    assert.deepEqual(result.payload.images, ["images/comment-0-0.png"]);

    const files = await readdir(imagesDir);
    assert.deepEqual(files, ["comment-0-0.png"]);

    const saved = JSON.parse(await readFile(join(review.outputDir, "review.json"), "utf8"));
    assert.equal(saved.review.comments[0].images[0].file, "images/comment-0-0.png", "the comment does not point at the file");

    const markdown = await readFile(join(review.outputDir, "review.md"), "utf8");
    assert.match(markdown, /!\[attachment\]\(images\/comment-0-0\.png\)/, "review.md does not show the image");
  });

  await check("a comment id cannot steer the file name", async () => {
    // The id comes from the browser and is only a label. Building a path from
    // it let `../../escaped` write a file outside the review folder.
    const result = await submit({
      comments: [{ id: "../../escaped", path: "app.js", side: "right", lineStart: 2, lineEnd: 2, body: "x", images: [{ dataUrl: PNG }] }],
    });
    assert.equal(result.status, 200, "the review was refused");
    assert.deepEqual(result.payload.images, ["images/comment-0-0.png"], "the id reached the file name");

    const parent = await readdir(join(review.outputDir, ".."));
    assert.ok(!parent.some((name) => name.startsWith("escaped")), `a file escaped the review folder: ${JSON.stringify(parent)}`);
  });

  await check("a comment id with a slash does not break the save", async () => {
    const result = await submit({
      comments: [{ id: "a/b", path: "app.js", side: "right", lineStart: 2, lineEnd: 2, body: "x", images: [{ dataUrl: PNG }] }],
    });
    assert.equal(result.status, 200, "a slash in an id made the save fail");
    assert.deepEqual(result.payload.images, ["images/comment-0-0.png"]);
  });

  await check("only real image formats are stored, so a script cannot be written", async () => {
    const svg = "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+";
    const result = await submit({
      comments: [{ id: "c2", path: "app.js", side: "right", lineStart: 2, lineEnd: 2, body: "x", images: [{ dataUrl: svg }] }],
    });
    assert.equal(result.status, 200, "the review was refused");
    assert.deepEqual(result.payload.images, [], "an svg was saved");

    const files = await readdir(imagesDir);
    assert.ok(!files.some((name) => name.endsWith(".svg")), `a scriptable file was written: ${JSON.stringify(files)}`);
  });

  await check("a screenshot on the note itself is saved under its own name", async () => {
    const result = await submit({
      reviewBody: "Look at this",
      noteImages: [{ dataUrl: PNG }],
      comments: [],
    });
    assert.equal(result.status, 200, "the review was refused");
    assert.deepEqual(result.payload.images, ["images/note-0.png"]);

    const markdown = await readFile(join(review.outputDir, "review.md"), "utf8");
    assert.match(markdown, /!\[attachment\]\(images\/note-0\.png\)/, "review.md does not show the note image");
  });

  await check("several screenshots keep their order and do not overwrite each other", async () => {
    const result = await submit({
      comments: [{
        id: "c3", path: "app.js", side: "right", lineStart: 2, lineEnd: 2, body: "three shots",
        images: [{ dataUrl: PNG }, { dataUrl: PNG }, { dataUrl: PNG }],
      }],
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.payload.images, [
      "images/comment-0-0.png", "images/comment-0-1.png", "images/comment-0-2.png",
    ]);
  });

  await review.page.close();
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {});
  delete process.env[GIT.ARTIFACTS_DIR_ENV];
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll note-image checks passed");
