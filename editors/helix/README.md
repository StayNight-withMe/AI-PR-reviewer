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
```
Press `C-r` and the review of the current branch opens in the browser. Helix
substitutes `%{cwd}` with the editor's working directory; `--open` launches the
default browser.
On Windows use the full path to `node.exe` if it is not on `PATH`:
```toml
[keys.normal]
C-r = ':sh "C:\\Program Files\\nodejs\\node.exe" Z:\\Alpha Dev\\pr-review-mcp\\src\\cli.js --repo %{cwd} --mode branch --open'
```
Other scopes are the same flags every host uses:
