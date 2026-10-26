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
