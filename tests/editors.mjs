/**
 * The editor integrations are thin hosts over ONE contract: they run
 * `src/cli.js`, read the one `PR_REVIEW_READY` line and show its URL.
 *
 * This test guards that contract without needing any GUI editor installed:
 *
 *   1. Every shipped bundle actually exists and contains the engine.
 *   2. A bundled engine launches, serves a real page and stops on signal —
 *      i.e. the copy the editor runs is not stale or incomplete.
 *   3. The compiled VS Code `ReviewSession` starts and stops that same engine
