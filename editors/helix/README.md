# PR Review for Helix
Helix has no plugin system that can start a process, so — like Zed — it reaches
the review through the shared engine `src/cli.js`: a **pipe command** for the
human and an **MCP server** fork the agent. Nothing is duplicated; both are the
same launcher every other editor uses.
## 1. A shell command (for the human)
Add a key binding to `~/.config/helix/config.toml`:
```toml
[keys.normal]
C-r = ":sh node /path/to/pr-review-mcp/src/cli.js --repo %{cwd} --mode branch --open"
