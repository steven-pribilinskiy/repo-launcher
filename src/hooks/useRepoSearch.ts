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

    results.sort((a, b) => b.score - a.score);
    return results;
  }, [query, repos]);
}
