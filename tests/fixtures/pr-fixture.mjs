/**
 * A two-branch repository with a bare "origin" that carries pull-request refs.
 *
 * The fixture exists so `mode=pr` can be tested with no network: it builds a
 * real git repository, a real bare remote, and publishes the branch under both
 * `refs/heads/*` and `refs/pull/<n>/head` on that remote — exactly the two
 * places `gh` and `git fetch` reach for.
 *
 * Layout:
 *
 *   <root>/repo    the working clone the review runs in (on `main`)
 *   <root>/origin  the bare remote (what `origin` points at)
 *
 * Commits:
 *
 *   main:    A ─ B            (base of the PR)
 *   feature: A ─ B ─ F1 ─ F2  (head of the PR; #7)
 *   fork:    A ─ B ─ G1       (head of a second PR from a "fork"; #8)
 *
 * The PR #7 head also changes a file whose name holds a space, adds a file,
