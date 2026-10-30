/**
 * Browser checks for two file-header affordances:
 *
 *   1. The full path tooltip — the row truncates a long path, so hovering must
 *      show the whole path in a readable box.
 *   2. The "more actions" menu — "Expand all" lives in a three-dots menu and is
 *      offered ONLY when the file still hides something.
 *
 * Runs against the PR fixture, so it needs no repository, gh or network.
 *
