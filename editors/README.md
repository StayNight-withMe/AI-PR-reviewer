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
