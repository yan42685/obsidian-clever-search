import {
  V3_HYBRID_LEXICAL_SUBITEMS_NOT_IMPLEMENTED_ERROR,
  buildCoverageLexicalV3HybridLexicalSubitems,
} from "src/services/search/coverage-lexical-v3/hybrid-lexical-subitems";

describe("coverage lexical v3 hybrid lexical subitems", () => {
  test("throws the placeholder error until the hybrid bridge is implemented", () => {
    expect(() =>
      buildCoverageLexicalV3HybridLexicalSubitems({
        queryText: "cache restore",
        filePath: "docs/cache.md",
        snapshotText: "cache restore checklist",
      }),
    ).toThrow(V3_HYBRID_LEXICAL_SUBITEMS_NOT_IMPLEMENTED_ERROR);
  });
});

