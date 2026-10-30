/**
 * Opens a PR review page on the mock fixture and checks it renders in a browser.
 *
 * This is the UI half of `test:pr`: the node half checks the diff and the API,
 * this one checks that the page actually shows the PR — badge, files, title,
 * a comment editor and the diff rows — with no JavaScript errors.
 *
 * Run: node tests/pr-page.mjs
 */
import assert from "node:assert/strict";
