/**
 * Makes the GitHub CLI available for `mode=pr`.
 *
 * Reviewing a pull request uses `gh` (the GitHub CLI), which owns the token,
 * the host and the authentication. Rather than ask the user to install it by
 * hand, this script checks for `gh` and offers to install it with the platform's
 * own package manager. It is deliberately conservative:
 *
 *   - a tool the user already has is never touched;
 *   - `--check` only reports (exit 0 = ready, 1 = missing), for CI and the
 *     postinstall hook;
 *   - `--install` is the only mode that changes the machine, and only when the
 *     package manager reports success;
 *   - a sandboxed or offline environment is not an error: it prints the exact
 *     command the user can run later.
 *
 * Usage:
 *   node scripts/ensure-gh.mjs             # report, install when possible
 *   node scripts/ensure-gh.mjs --check     # report only (CI / postinstall)
 *   node scripts/ensure-gh.mjs --check --never-fail   # postinstall: never fails
