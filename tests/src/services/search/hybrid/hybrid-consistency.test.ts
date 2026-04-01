import {
  analyzeHybridStoredFileConsistency,
  normalizeHybridIndexedFileState,
} from "src/services/search/hybrid/hybrid-consistency";

describe("Hybrid stored file consistency", () => {
  test("defaults missing state to ready when vector exists", () => {
    expect(normalizeHybridIndexedFileState(undefined, true)).toBe("ready");
  });

  test("defaults missing state to bm25_only when vector is absent", () => {
    expect(normalizeHybridIndexedFileState(undefined, false)).toBe("bm25_only");
  });

  test("blocks reuse when stored data exists without indexed file ref", () => {
    const result = analyzeHybridStoredFileConsistency({
      existsInVault: true,
      hasChunks: true,
      chunkCount: 3,
      snapshot: { generation: 10 },
      vectorInfo: { precision: "int8", chunkCount: 3, generation: 10 },
      indexedFileRef: undefined,
      currentPrecision: "int8",
    });

    expect(result.reuseBlockedReasons).toContain("missing_indexed_file_ref");
    expect(result.repairReasons).toContain("missing_indexed_file_ref");
  });

  test("blocks reuse when ready state is missing vector data", () => {
    const result = analyzeHybridStoredFileConsistency({
      existsInVault: true,
      hasChunks: true,
      chunkCount: 2,
      snapshot: { generation: 12 },
      indexedFileRef: {
        path: "a.md",
        state: "ready",
        chunkCount: 2,
        generation: 12,
      },
      currentPrecision: "int8",
    });

    expect(result.reuseBlockedReasons).toContain("ready_missing_data");
  });

  test("blocks reuse when bm25_only file still has vectors", () => {
    const result = analyzeHybridStoredFileConsistency({
      existsInVault: true,
      hasChunks: true,
      chunkCount: 2,
      snapshot: { generation: 22 },
      vectorInfo: { precision: "int8", chunkCount: 2, generation: 22 },
      indexedFileRef: {
        path: "b.md",
        state: "bm25_only",
        chunkCount: 2,
        generation: 22,
      },
      currentPrecision: "int8",
    });

    expect(result.reuseBlockedReasons).toContain("bm25_only_shape_mismatch");
  });

  test("blocks reuse on generation and precision mismatch", () => {
    const result = analyzeHybridStoredFileConsistency({
      existsInVault: true,
      hasChunks: true,
      chunkCount: 4,
      snapshot: { generation: 30 },
      vectorInfo: { precision: "float16", chunkCount: 4, generation: 31 },
      indexedFileRef: {
        path: "c.md",
        state: "ready",
        chunkCount: 4,
        generation: 30,
      },
      currentPrecision: "int8",
    });

    expect(result.reuseBlockedReasons).toContain("vector_generation_mismatch");
    expect(result.reuseBlockedReasons).toContain("vector_precision_mismatch");
  });

  test("marks missing vault file as stale cleanup", () => {
    const result = analyzeHybridStoredFileConsistency({
      existsInVault: false,
      hasChunks: false,
      chunkCount: 0,
      snapshot: { generation: 40 },
      indexedFileRef: undefined,
      currentPrecision: "int8",
    });

    expect(result.repairReasons).toContain("stale_missing_vault_file");
  });

  test("treats pending indexed file as repairable runtime residue", () => {
    const result = analyzeHybridStoredFileConsistency({
      existsInVault: true,
      hasChunks: true,
      chunkCount: 1,
      snapshot: { generation: 50 },
      indexedFileRef: {
        path: "d.md",
        state: "pending",
        chunkCount: 1,
        generation: 50,
      },
      currentPrecision: "int8",
    });

    expect(result.reuseBlockedReasons).toContain("indexed_file_state_pending");
  });
});
