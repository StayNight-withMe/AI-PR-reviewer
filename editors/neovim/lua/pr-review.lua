-- PR Review for Neovim.
--
-- One command builds a review of the current branch and opens the page in the
-- browser. The heavy lifting (scope, diff, page) lives in the shared engine
-- `src/cli.js`; this plugin only starts it, reads the one PR_REVIEW_READY line
-- and opens the URL. Nothing about the review is re-implemented here.
--
-- Install: copy this file to lua/pr-review.lua on your runtimepath and add
--
--     require("pr-review").setup()
--
-- to your init.lua. Then run :PrReview (and :PrReviewStop to stop the server).
local M = {}
local defaults = {
  -- Path to the review engine. Defaults to the copy bundled next to this
  -- plugin, then to a checkout on the runtimepath.
  cli_path = nil,
  -- "branch" reviews the current branch against its base. Other modes:
  -- "uncommitted", "range", "commits", "all".
  mode = "branch",
  -- Base ref for the branch review; nil lets the engine pick origin/dev, ...
  base = nil,
  -- Where to open the review: "browser" (default) or "none" (only echo the URL).
  open = "browser",
}
local config = vim.deepcopy(defaults)
local state = { job = nil, url = nil }
--- Finds the engine: the configured path, the bundled copy, or a checkout.
local function resolve_cli()
  if config.cli_path and config.cli_path ~= "" then
    return config.cli_path
  end
  -- The bundled copy ships at <plugin>/server/src/cli.js, next to this file.
  local here = debug.getinfo(1, "S").source:sub(2)
  local dir = vim.fn.fnamemodify(here, ":h")
  local bundled = dir .. "/../server/src/cli.js"
  if vim.fn.filereadable(bundled) == 1 then
    return vim.fn.fnamemodify(bundled, ":p")
  end
  for _, root in ipairs(vim.api.nvim_list_runtime_paths()) do
    local candidate = root .. "/server/src/cli.js"
    if vim.fn.filereadable(candidate) == 1 then
      return candidate
    end
  end
  return nil
end
--- The repository root: the nearest ancestor that holds `.git`.
local function repo_root()
  local found = vim.fs.find(".git", { upward = true, path = vim.fn.getcwd() })[1]
  if found then
    return vim.fn.fnamemodify(found, ":h")
  end
  return vim.fn.getcwd()
end
--- Opens a URL in the system browser, per platform.
local function open_browser(url)
  local cmd
  if vim.fn.has("win32") == 1 then
    cmd = { "cmd", "/c", "start", "", url }
  elseif vim.fn.has("mac") == 1 then
    cmd = { "open", url }
  else
    cmd = { "xdg-open", url }
  end
