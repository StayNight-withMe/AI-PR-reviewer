# PR Review for Neovim
One command builds a review of the current branch and opens the page in the
browser. The work lives in the shared engine `src/cli.js`; the Lua module only
starts it, reads the one `PR_REVIEW_READY` line and opens the URL.
## Install
Copy `lua/pr-review.lua` onto your `runtimepath` (for example
`~/.config/nvim/lua/pr-review.lua`) and add to your `init.lua`:
```lua
require("pr-review").setup({
  -- cli_path = "/home/me/pr-review-mcp/src/cli.js", -- optional
  mode = "branch",
})
```
With a plugin manager, point it at this folder and call `setup()`.
## Commands
- `:PrReview` — build and open the review of the current branch (default).
- `:PrReviewStop` — stop the running server; the page does not outlive it.
## Options
| Option | Default | Meaning |
| --- | --- | --- |
| `cli_path` | bundled copy, then a checkout | Path to `src/cli.js`. |
| `mode` | `branch` | `branch`, `uncommitted`, `range`, `commits` or `all`. |
