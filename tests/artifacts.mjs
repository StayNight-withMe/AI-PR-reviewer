/**
 * Review artifacts must not pollute the repository.
 *
 * Review artifacts live in the OS temp directory (or `PR_REVIEW_ARTIFACTS_DIR`),
 * never inside the checkout, so a review leaves the working tree clean.
 *
 * Run: node tests/artifacts.mjs
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
