# PR Review for Visual Studio 2022
A menu button opens a dockable tab that hosts the review page in **WebView2**.
The page is the same localhost app the MCP server and the AI use, so nothing is
duplicated: this project only starts the bundled Node server and shows its URL.
## What it does
- **PR Review → Open review of the current branch** (Tools menu) opens the window
  if it is not open yet, starts the server once, and points WebView2 at the page.
- The window title shows the branch and the change size, e.g.
  `PR Review: feature/login (+120 / -34)`.
- Closing Visual Studio stops the server; the page disappears with it.
Scope is **the current branch against its base** by default — the review shows
only what this branch changed, not the whole project.
## Requirements
- Visual Studio 2022 (17.x) with the **Visual Studio extension development**
  workload (it provides the VSIX build targets).
- Node.js on `PATH`, or `PR_REVIEW_NODE` pointing at `node.exe`.
## Build
The project builds to a DLL with the .NET SDK:
```powershell
dotnet build
```
To produce the installable **`.vsix`**, use MSBuild from a machine with the
extension-development workload:
```powershell
msbuild PrReview.VisualStudio.csproj /p:Configuration=Release
```
The `.vsix` lands in `bin\Release\net48\`. Double-click it to install.
## Bundle the server into the VSIX
The extension looks for the server at
`<extension install dir>\server\src\cli.js`. From the repository root, one
