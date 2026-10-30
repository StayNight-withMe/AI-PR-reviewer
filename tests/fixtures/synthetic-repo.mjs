/**
 * Builds a git repository with a synthetic two-month history.
 *
 * The fixture exists to stress the review UI with the shapes a real
 * repository contains and a hand-made diff never does: renames, deletions,
 * binary files, unicode paths and content, CRLF endings, a file without a
 * trailing newline, a very long line, a mode change, a merge commit, an
 * empty commit, a few hundred generated files and a file large enough to make
 * the folding policy matter.
 *
