import type { SearchResult } from "./types.js";

/**
 * Reciprocal Rank Fusion (RRF)
 * Combines two ranked lists of search results (e.g. semantic and keyword) into a single ranked list.
 * @param vectorResults Results from vector search (sorted by score descending)
 * @param keywordResults Results from keyword search (sorted by score descending)
 * @param k Constant for RRF formula. Standard is 60.
 * @returns Fused SearchResult array
 */
export function fuseResults(
  vectorResults: SearchResult[],
  keywordResults: SearchResult[],
  k = 60,
): SearchResult[] {
  const scores = new Map<string, { entry: SearchResult; rrfScore: number }>();

  // Process vector results
  for (let i = 0; i < vectorResults.length; i++) {
    const res = vectorResults[i];
    scores.set(res.id, { entry: res, rrfScore: 1 / (k + i + 1) });
  }

  // Process keyword results
  for (let i = 0; i < keywordResults.length; i++) {
    const res = keywordResults[i];
    const existing = scores.get(res.id);
    const kwScore = 1 / (k + i + 1);
    if (existing) {
      existing.rrfScore += kwScore;
    } else {
      scores.set(res.id, { entry: res, rrfScore: kwScore });
    }
  }

  // Sort and reconstruct
  return [...scores.values()]
    .toSorted((a, b) => b.rrfScore - a.rrfScore)
    .map((x) => ({
      ...x.entry,
      score: x.rrfScore, // Replace with RRF score
    }));
}
