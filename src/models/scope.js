/** Review scope resolution: one place that answers "which diff are we reviewing?". */
import {
  diffBetween,
  diffFromTo,
  diffUncommitted,
  listCommits,
  mergeBase,
  orderCommits,
  parentOrEmptyTree,
  resolveCommit,
} from "../git.js";
