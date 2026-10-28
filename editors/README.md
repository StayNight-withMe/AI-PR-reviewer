# PR Review — editor integrations
One repository, one review engine, many hosts. Every integration is a thin
client over the same server: they start `src/cli.js`, read the one ready line it
prints, and show the URL it returns. No integration re-implements the diff, the
scope or the page.
```
        ┌─────────────────────────────┐
        │  src/cli.js  (the engine)   │   scope -> diff -> page -> localhost
        └──────────────┬──────────────┘
              prints:  │  PR_REVIEW_READY {"url":..., "reviewId":...}
        ┌──────────────┼──────────────┬──────────────┬───────────────┐
        │              │              │              │               │
   VS Code        Visual Studio   JetBrains       Zed         Neovim
   (Webview)      (WebView2)      (browser)  (MCP + task)   (Lua + MCP)
        │              │              │              │               │
   Sublime        Emacs          Helix       MCP clients (agent)
   (Python)       (Lisp)         (task+MCP)
```
## Scope: the current branch, not the whole project
A click reviews **the current branch against its base** (`--mode branch`). The
server resolves the base itself (`origin/dev`, `origin/main`, …) or you pin it
with `--base`. Other modes exist for completeness:
| `--mode` | What it reviews |
| --- | --- |
| `branch` (default) | the current branch vs its base — what a PR is about |
| `uncommitted` | staged + unstaged + untracked working tree |
| `range` | an explicit `--base`…`--head` |
| `commits` | one net diff of the chosen commits |
| `all` | every commit of the branch |
| `pr` | a **GitHub pull request** (`--pr <n>`), read through the GitHub CLI |
## The shared contract
The integrations never parse the page. They run the engine and read one line:
```jsonc
// stdout, one line
PR_REVIEW_READY {"ok":true,"url":"http://127.0.0.1:54321/","reviewId":"...","port":54321,
                 "repo":"...","branch":"feature/login","mode":"branch","base":"origin/dev",
                 "head":"HEAD","files":42,"additions":1200,"deletions":340,"outputDir":"..."}
```
On failure, `PR_REVIEW_ERROR <message>` goes to stderr and the process exits
non-zero. `GET /api/version` reports `{name, version, protocol}` so a host can
refuse an incompatible engine instead of failing silently.
## The pieces
| Folder | Host | Artifact | Where it opens |
| --- | --- | --- | --- |
| [`vscode/`](vscode/README.md) | VS Code | VSIX | a Webview tab (default), Simple Browser, or system browser |
| [`visualstudio/`](visualstudio/README.md) | Visual Studio 2022 | VSIX (C# + WebView2) | a dockable tool window |
| [`jetbrains/`](jetbrains/README.md) | JetBrains IDEs | plugin zip (Kotlin) | the system browser |
| [`neovim/`](neovim/) | Neovim | Lua module | the system browser |
| [`sublime/`](sublime/) | Sublime Text | Python plugin | the system browser |
| [`emacs/`](emacs/) | Emacs | Lisp package | the system browser |
| [`zed/`](zed/README.md) | Zed | MCP server + task | the system browser |
| [`helix/`](helix/README.md) | Helix | pipe command + MCP | the system browser |
The three browser-only hosts (Neovim, Sublime, Helix) are complete with no
build step: they spawn the engine and open its URL.
## Bundling the engine
VS Code, Visual Studio and JetBrains ship the engine **inside** the plugin so it
works without a separate checkout. One script copies it into every host's
`server/` folder:
```sh
node scripts/bundle-server.mjs            # every host
node scripts/bundle-server.mjs --list     # which hosts ship a bundle
node scripts/bundle-server.mjs jetbrains  # just one
```
`src/index.js` is the only file that needs `node_modules` (the MCP SDK and zod);
the launcher `src/cli.js` and the whole page run without it, so bundles stay
small. Each copy gets a `BUNDLE.json` stamp naming the engine version, and the
editor test refuses a stale bundle.
## Why some hosts have no bundled extension
- **Zed** extensions are WebAssembly and cannot start a process; Zed uses the
  engine as an MCP server and a task instead.
- **Helix** has no plugin system that can spawn a process; it uses a pipe
  command and an MCP server, the same two surfaces as Zed.
- **Neovim / Sublime / Emacs** do have process APIs, so they ship real plugins
  that spawn the engine; they do not need a bundle because the user points
  them at their checkout once.
## Testing the integrations
Two suites cover everything that does not need a GUI editor:
```sh
npm run test:editors          # bundles launch, serve a page, stop; VS Code session
npm run test:editors:configs  # JSON/TOML/Lua/Lisp/Kotlin config files
