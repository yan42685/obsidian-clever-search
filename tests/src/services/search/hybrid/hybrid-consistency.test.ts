import {
  analyzeHybridStoredFileConsistency,
  normalizeHybridIndexedFileState,
} from "src/services/search/hybrid/hybrid-consistency";

describe("Hybrid stored file consistency", () => {
  test("defaults missing state to ready when vector exists", () => {
    expect(normalizeHybridIndexedFileState(undefined, true)).toBe("ready");
  });

  test("defaults missing state to lexical_only when vector is absent", () => {
    expect(normalizeHybridIndexedFileState(undefined, false)).toBe("lexical_only");
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
        docRef: 1,
        state: "ready",
        chunkCount: 2,
        generation: 12,
      },
      currentPrecision: "int8",
    });

    expect(result.reuseBlockedReasons).toContain("ready_missing_data");
  });

  test("accepts explicit zero-chunk ready refs for empty files", () => {
    const result = analyzeHybridStoredFileConsistency({
      existsInVault: true,
      hasChunks: false,
      chunkCount: 0,
      snapshot: { generation: 15 },
      indexedFileRef: {
        docRef: 1,
        state: "ready",
        chunkCount: 0,
        generation: 15,
      },
      currentPrecision: "int8",
    });

    expect(result.reuseBlockedReasons).toEqual([]);
    expect(result.repairReasons).toEqual([]);
  });

  test("blocks reuse when lexical_only file still has vectors", () => {
    const result = analyzeHybridStoredFileConsistency({
      existsInVault: true,
      hasChunks: true,
      chunkCount: 2,
      snapshot: { generation: 22 },
      vectorInfo: { precision: "int8", chunkCount: 2, generation: 22 },
      indexedFileRef: {
        docRef: 1,
        state: "lexical_only",
        chunkCount: 2,
        generation: 22,
      },
      currentPrecision: "int8",
    });

    expect(result.reuseBlockedReasons).toContain("lexical_only_shape_mismatch");
  });

  test("blocks reuse on generation and precision mismatch", () => {
    const result = analyzeHybridStoredFileConsistency({
      existsInVault: true,
      hasChunks: true,
      chunkCount: 4,
      snapshot: { generation: 30 },
      vectorInfo: { precision: "float16", chunkCount: 4, generation: 31 },
      indexedFileRef: {
        docRef: 1,
        state: "ready",
        chunkCount: 4,
        generation: 30,
      },
      currentPrecision: "int8",
    });

    expect(result.reuseBlockedReasons).toContain("vector_generation_mismatch");
    expect(result.reuseBlockedReasons).toContain("vector_precision_mismatch");
  });

  test("treats matching shadow snapshot as aligned indexed evidence", () => {
    const result = analyzeHybridStoredFileConsistency({
      existsInVault: true,
      hasChunks: true,
      chunkCount: 2,
      snapshot: { generation: 40 },
      shadowSnapshot: { generation: 35 },
      vectorInfo: { precision: "int8", chunkCount: 2, generation: 35 },
      indexedFileRef: {
        docRef: 1,
        state: "ready",
        chunkCount: 2,
        generation: 35,
      },
      currentPrecision: "int8",
    });

    expect(result.hasShadowSnapshot).toBe(true);
    expect(result.reuseBlockedReasons).not.toContain("snapshot_generation_mismatch");
    expect(result.repairReasons).not.toContain("snapshot_generation_mismatch");
  });

  test("marks snapshot mismatch when neither current nor shadow aligns", () => {
    const result = analyzeHybridStoredFileConsistency({
      existsInVault: true,
      hasChunks: true,
      chunkCount: 2,
      snapshot: { generation: 41 },
      shadowSnapshot: { generation: 42 },
      vectorInfo: { precision: "int8", chunkCount: 2, generation: 40 },
      indexedFileRef: {
        docRef: 1,
        state: "ready",
        chunkCount: 2,
        generation: 40,
      },
      currentPrecision: "int8",
    });

    expect(result.reuseBlockedReasons).toContain("snapshot_generation_mismatch");
  });

  test("marks missing vault file as stale cleanup", () => {
    const result = analyzeHybridStoredFileConsistency({
      existsInVault: false,
      hasChunks: false,
      chunkCount: 0,
      snapshot: { generation: 50 },
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
      snapshot: { generation: 60 },
      indexedFileRef: {
        docRef: 1,
        state: "pending",
        chunkCount: 1,
        generation: 60,
      },
      currentPrecision: "int8",
    });

    expect(result.reuseBlockedReasons).toContain("indexed_file_state_pending");
  });
});
