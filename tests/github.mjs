/**
 * The GitHub pull-request scope (`mode=pr`).
 *
 * A PR is reviewed through the GitHub CLI, so this test has two layers:
 *
 *   1. Pure: the `gh pr view --json` payload maps onto the fields the page
 *      uses, and the review id / title derive from it. No network, no gh.
 *   2. Live, skipped when `gh` is missing or unauthenticated: a real PR on a
 *      real repository is read and turned into a range review.
 *
