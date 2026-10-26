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
