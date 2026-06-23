export type MatchResult = {
  score: number;
  indices: number[];
} | null;

/**
 * Fuzzy match a query against a target string.
 * Optimized for file paths: boosts matches in the last segment (repo name).
 */
export function fuzzyMatch(query: string, target: string): MatchResult {
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  if (queryLower.length === 0) return { score: 0, indices: [] };
  if (queryLower.length > targetLower.length) return null;

  const indices: number[] = [];
  let score = 0;
  let queryIdx = 0;
  let prevMatchIdx = -2;

  // Find the start of the last path segment for bonus scoring
  const lastSlash = target.lastIndexOf("/");

  for (let i = 0; i < targetLower.length && queryIdx < queryLower.length; i++) {
    if (targetLower[i] === queryLower[queryIdx]) {
      indices.push(i);

      // Consecutive match bonus
      if (i === prevMatchIdx + 1) {
        score += 3;
      }

      // Word boundary bonus (after /, -, _, .)
      if (i === 0 || "/\\-_.".includes(target[i - 1])) {
        score += 2;
      }

      // Match in repo name (last segment) bonus
      if (i > lastSlash) {
        score += 2;
      }

      // Exact case match bonus
      if (target[i] === query[queryIdx]) {
        score += 1;
      }

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
