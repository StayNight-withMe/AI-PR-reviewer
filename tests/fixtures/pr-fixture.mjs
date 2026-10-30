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
