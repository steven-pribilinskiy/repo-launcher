import { useMemo } from "react";
import { fuzzyMatch } from "@/lib/fuzzyMatch";
import type { Repo, FuzzyResult } from "@/types";

export function useRepoSearch(query: string, repos: Repo[]): FuzzyResult[] {
  return useMemo(() => {
    if (!query.trim()) {
      return repos.map((repo) => ({ repo, score: 0, indices: [] }));
    }

    const results: FuzzyResult[] = [];

    for (const repo of repos) {
      const match = fuzzyMatch(query, repo.path);
      if (match) {
        results.push({ repo, score: match.score, indices: match.indices });
      }
    }

    // Ties (the matcher can score two repos equally) fall back to usage, then
    // recency, so the repo you actually open ranks first.
    results.sort(
      (a, b) =>
        b.score - a.score ||
        b.repo.uses - a.repo.uses ||
        b.repo.last_used - a.repo.last_used,
    );
    return results;
  }, [query, repos]);
}
