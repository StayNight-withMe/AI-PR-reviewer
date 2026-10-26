# PR Review for Zed
Zed extensions run as WebAssembly and cannot start a process, so there is no
`extension.toml` to build here. Zed reaches the review in the two supported
ways instead: as an **MCP server** for the agent, and as a **task** for the
human. Both use the same bundled server.
## 1. MCP server (for the agent)
Add the review server to Zed's `context_servers` in `settings.json`:
```json
{
  "context_servers": {
    "pr-review": {
      "command": {
        "path": "node",
        "args": ["Z:\\Alpha Dev\\pr-review-mcp\\src\\index.js"],
        "env": {}
      }
    }
  }
}
```
On macOS or Linux replace the path with the checkout location, for example
`/home/me/pr-review-mcp/src/index.js`. The agent can then call `start_review`,
`await_review`, `get_review`, `list_review_scope` and `close_review` exactly as
in any other MCP client.
## 2. Task (opens the page for the human)
Add a task to `.zed/tasks.json` in the repository you review (or to the global
tasks file). Press the task keybinding and the review of the current branch
opens in the system browser.
```json
[
  {
    "label": "PR Review: current branch",
    "command": "node",
    "args": [
      "Z:\\Alpha Dev\\pr-review-mcp\\src\\cli.js",
      "--repo",
      "$ZED_WORKTREE_ROOT",
      "--mode",
      "branch",
      "--open"
    ],
    "use_new_terminal": false,
    "allow_concurrent_runs": false,
    "reveal": "no_focus",
    "reveal_target": "center"
  }
]
```
`--open` launches the default browser, so the page opens in a tab and the menu
of the review (files, commits, comments) is available right away. Drop `--open`
if you would rather keep it inside Zed: the task prints the URL and Zed links
it, or serve the page and use the "Open in browser" affordance.
## 3. Scope
The default scope is **the current branch against its base** (`--mode branch`),
not the whole project, so the review shows only what this branch changed. Pass
`--base origin/main` (or any ref) to pin the base, or `--mode uncommitted` to
review the working tree instead.
