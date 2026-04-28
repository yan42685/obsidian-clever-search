import {
  buildCoverageLexicalV3HybridLexicalSubitems,
} from "src/services/search/coverage-lexical-v3/hybrid-lexical-subitems";

describe("coverage lexical v3 hybrid lexical subitems", () => {
  test("builds bridge spans for exact local lexical evidence", () => {
    const result = buildCoverageLexicalV3HybridLexicalSubitems({
      queryText: "cache restore",
      filePath: "docs/cache.md",
      snapshotText: "cache restore checklist\nother notes",
    });

    expect(result.queryTerms.map((term) => term.normalizedText)).toEqual([
      "cache",
      "restore",
    ]);
    expect(result.candidateSpans).toHaveLength(1);
    expect(result.candidateSpans[0].score.coverageCount).toBe(2);
    expect(result.candidateSpans[0].termStats.every((term) => term.bestTier === "exact")).toBe(true);
    expect(result.renderPayloads[0]).toEqual({ row: 0, col: 0 });
  });

  test("returns no spans when the snapshot has no local evidence", () => {
    const result = buildCoverageLexicalV3HybridLexicalSubitems({
      queryText: "cache restore",
      filePath: "docs/cache.md",
      snapshotText: "unrelated checklist",
    });

    expect(result.queryTerms).toHaveLength(2);
    expect(result.candidateSpans).toEqual([]);
    expect(result.renderPayloads).toEqual([]);
  });

  test("maps normalized matches back to original snapshot offsets", () => {
    const result = buildCoverageLexicalV3HybridLexicalSubitems({
      queryText: "cache",
      filePath: "docs/cache.md",
      snapshotText: "ﬁ\ncache restore",
    });

    expect(result.candidateSpans[0].score.anchorOffset).toBe(2);
    expect(result.renderPayloads[0]).toEqual({ row: 1, col: 0 });
  });

});
