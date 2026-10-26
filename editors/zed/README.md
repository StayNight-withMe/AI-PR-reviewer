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
