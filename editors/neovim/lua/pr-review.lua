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
  vim.system(cmd, { detach = true })
end
--- Handles one line of engine output.
local function on_line(line)
  if not line or line == "" then
    return
  end
  local prefix = "PR_REVIEW_READY "
  if line:sub(1, #prefix) == prefix then
    local ok, payload = pcall(vim.json.decode, line:sub(#prefix + 1))
    if not ok or not payload.url then
      vim.notify("pr-review: unreadable reply", vim.log.levels.ERROR)
      return
    end
    state.url = payload.url
    vim.notify(
      string.format("pr-review: %s (+%d / -%d)", payload.branch or "review", payload.additions or 0, payload.deletions or 0)
    )
    if config.open == "browser" then
      open_browser(payload.url)
    else
      vim.notify("pr-review: " .. payload.url)
    end
  elseif line:sub(1, 15) == "PR_REVIEW_ERROR" then
    vim.notify("pr-review: " .. line, vim.log.levels.ERROR)
  end
end
--- Starts the engine and opens the review.
function M.open()
  if state.job then
    if state.url and config.open == "browser" then
      open_browser(state.url)
    end
    return
  end
  local cli = resolve_cli()
  if not cli then
    vim.notify("pr-review: src/cli.js not found; set cli_path in setup()", vim.log.levels.ERROR)
    return
  end
  local cmd = { "node", cli, "--repo", repo_root(), "--mode", config.mode, "--json" }
  if config.base and config.base ~= "" then
    table.insert(cmd, "--base")
    table.insert(cmd, config.base)
  end
  state.job = vim.system(cmd, {
    text = true,
    stdout = function(_, data)
      if data then
        for _, line in ipairs(vim.split(data, "\n")) do
          on_line(line)
        end
      end
    end,
    stderr = function(_, data)
      if data and data ~= "" then
        vim.schedule(function()
          vim.notify("pr-review: " .. data, vim.log.levels.ERROR)
        end)
      end
    end,
  }, function()
    vim.schedule(function()
      state.job = nil
    end)
  end)
end
--- Stops the running engine (and the page does not outlive it).
function M.stop()
  if not state.job then
    return
  end
  state.job:kill("sigterm")
  state.job = nil
  state.url = nil
  vim.notify("pr-review: stopped")
end
function M.setup(opts)
  config = vim.tbl_deep_extend("force", vim.deepcopy(defaults), opts or {})
  vim.api.nvim_create_user_command("PrReview", function()
    M.open()
  end, { desc = "Open a review of the current branch" })
  vim.api.nvim_create_user_command("PrReviewStop", function()
    M.stop()
  end, { desc = "Stop the running review server" })
end
return M
