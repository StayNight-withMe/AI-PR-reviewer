/**
 * Resolving review comments, from the page and from the agent.
 *
 * A review comment can be marked resolved when it is fixed: on the page with
 * the "Resolve" button, and by the agent through the `resolve_comments` MCP tool,
 * which writes the same `review.json`/`review.md` the page shows.
 *
 * Also checks that a re-review after a code change is a NEW review: the old
 * "Viewed" flags must not carry over, which was a stale-state bug.
 *
