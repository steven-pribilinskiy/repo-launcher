import type { Repo } from "@/types";

export type SortDir = "asc" | "desc";

/** Direction each shared sort mode starts in, matching how Rust ranks it:
 * alpha and type ascend, recent and most-used put the biggest value first. */
export const DEFAULT_SORT_DIR: SortDir[] = ["asc", "desc", "desc", "asc"];

/**
 * Re-order repos in memory, mirroring `rank_by` in cache.rs (0 alpha by path,
 * 1 recent by timestamp, 2 most-used by count, 3 type by kind then path).
 *
 * Sorting here rather than round-tripping to Rust keeps a column-header click off
 * the cache-read path entirely: the list is already in memory with its usage
 * stats, and re-reading it costs two `wsl.exe` spawns on a machine using the
 * fallback. Ties are left in their existing order — `Array.sort` is stable, which
 * is the same tie behaviour `rank_by` has.
 */
export function sortRepos(repos: Repo[], mode: number, dir: SortDir): Repo[] {
  const sign = dir === "asc" ? 1 : -1;
  const byPath = (left: Repo, right: Repo) => left.path.localeCompare(right.path);
  const sorted = [...repos];
  switch (mode) {
    case 1:
      sorted.sort((left, right) => sign * (left.last_used - right.last_used));
      break;
    case 2:
      sorted.sort((left, right) => sign * (left.uses - right.uses));
      break;
    case 3:
      sorted.sort(
        (left, right) => sign * (left.kind.localeCompare(right.kind) || byPath(left, right)),
      );
      break;
    default:
      sorted.sort((left, right) => sign * byPath(left, right));
  }
  return sorted;
}
