export type MatchResult = {
  score: number;
  indices: number[];
} | null;

/** Extra reward for matching the whole query inside the repo-name segment. */
const NAME_MATCH_BONUS = 5;

/**
 * Greedy left-to-right scan of `target` from `start`, matching each query char at
 * its first occurrence. Returns absolute indices into `target` (for highlighting)
 * or null if not every query char is found. `lastSlash` is the start of the repo
 * name segment, used for the word-boundary / last-segment bonuses.
 */
function scan(
  queryLower: string,
  query: string,
  targetLower: string,
  target: string,
  start: number,
  lastSlash: number,
): MatchResult {
  const indices: number[] = [];
  let score = 0;
  let queryIdx = 0;
  let prevMatchIdx = -2;

  for (let i = start; i < targetLower.length && queryIdx < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIdx]) {
      indices.push(i);

      // Consecutive match bonus
      if (i === prevMatchIdx + 1) score += 3;
      // Word boundary bonus (after /, -, _, .)
      if (i === 0 || "/\\-_.".includes(target[i - 1])) score += 2;
      // Match in repo name (last segment) bonus
      if (i > lastSlash) score += 2;
      // Exact case match bonus
      if (target[i] === query[queryIdx]) score += 1;

      prevMatchIdx = i;
      queryIdx++;
    }
  }

  // All query chars must be found
  if (queryIdx !== queryLower.length) return null;

  // Base score for matching
  score += 1;

  return { score, indices };
}

/**
 * Fuzzy match a query against a target string. Optimized for file paths: a clean
 * match inside the last segment (the repo name) is scored separately and wins,
 * so e.g. "repolaun" lands on "…/repo-launcher" instead of getting its chars
 * scattered across earlier path segments by greedy left-to-right matching.
 */
export function fuzzyMatch(query: string, target: string): MatchResult {
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  if (queryLower.length === 0) return { score: 0, indices: [] };
  if (queryLower.length > targetLower.length) return null;

  const lastSlash = target.lastIndexOf("/");

  let best = scan(queryLower, query, targetLower, target, 0, lastSlash);

  // Also try aligning the whole query within the repo-name segment. When it fits,
  // the consecutive / word-boundary / name bonuses stack far higher than the
  // greedy whole-path match, so the obvious name hit ranks first.
  if (lastSlash >= 0 && lastSlash + 1 < targetLower.length) {
    const name = scan(queryLower, query, targetLower, target, lastSlash + 1, lastSlash);
    if (name) {
      name.score += NAME_MATCH_BONUS;
      if (!best || name.score > best.score) best = name;
    }
  }

  return best;
}
