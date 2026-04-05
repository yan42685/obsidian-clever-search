import type { VectorPrecision } from "./hybrid-types";
import type { HybridDocState, HybridIndexedFileRef } from "./hybrid-store";

export type HybridStoredVectorInfo = {
	precision: VectorPrecision;
	chunkCount: number;
	generation?: number;
};

export type HybridStoredSnapshotInfo = {
	generation?: number;
};

export type HybridStoredFileConsistencyInput = {
	existsInVault: boolean;
	hasChunks: boolean;
	chunkCount: number;
	snapshot?: HybridStoredSnapshotInfo;
	shadowSnapshot?: HybridStoredSnapshotInfo;
	vectorInfo?: HybridStoredVectorInfo;
	indexedFileRef?: HybridIndexedFileRef;
	currentPrecision: VectorPrecision;
};

export type HybridStoredFileConsistency = {
	indexedFileState: HybridDocState | null;
	hasSnapshot: boolean;
	hasShadowSnapshot: boolean;
	hasVector: boolean;
	hasIndexedFileRef: boolean;
	reuseBlockedReasons: string[];
	repairReasons: string[];
};

export function normalizeHybridIndexedFileState(
	ref: HybridIndexedFileRef | undefined,
	hasVector: boolean,
): HybridDocState | null {
	const rawState = ref?.state;
	if (!rawState) {
		return hasVector ? "ready" : "lexical_only";
	}
	return rawState;
}

function resolveAlignedSnapshotGeneration(
	input: HybridStoredFileConsistencyInput,
): number | undefined {
	const indexedGeneration = input.indexedFileRef?.generation;
	if (indexedGeneration !== undefined) {
		if (input.snapshot?.generation === indexedGeneration) {
			return input.snapshot.generation;
		}
		if (input.shadowSnapshot?.generation === indexedGeneration) {
			return input.shadowSnapshot.generation;
		}
	}
	return input.snapshot?.generation ?? input.shadowSnapshot?.generation;
}

export function analyzeHybridStoredFileConsistency(
	input: HybridStoredFileConsistencyInput,
): HybridStoredFileConsistency {
	const hasShadowSnapshot = input.shadowSnapshot !== undefined;
	const hasSnapshot = input.snapshot !== undefined || hasShadowSnapshot;
	const hasVector = input.vectorInfo !== undefined;
	const hasIndexedFileRef = input.indexedFileRef !== undefined;
	const isExplicitZeroChunkRef =
		hasIndexedFileRef &&
		(input.indexedFileRef?.chunkCount ?? undefined) === 0 &&
		!input.hasChunks &&
		!hasVector;
	const indexedFileState = normalizeHybridIndexedFileState(
		input.indexedFileRef,
		hasVector,
	);
	const reuseBlockedReasons: string[] = [];
	const alignedSnapshotGeneration = resolveAlignedSnapshotGeneration(input);

	const pushReuseReason = (reason: string) => {
		if (!reuseBlockedReasons.includes(reason)) {
			reuseBlockedReasons.push(reason);
		}
	};

	const anyStoredData =
		input.hasChunks || hasSnapshot || hasVector || hasIndexedFileRef;

	if (!hasIndexedFileRef && anyStoredData) {
		pushReuseReason("missing_indexed_file_ref");
	}
	if (
		(indexedFileState === "pending" || indexedFileState === "failed") &&
		anyStoredData
	) {
		pushReuseReason(`indexed_file_state_${indexedFileState}`);
	}
	if (hasIndexedFileRef && !input.hasChunks && !isExplicitZeroChunkRef) {
		pushReuseReason("indexed_file_ref_missing_chunks");
	}
	if (hasIndexedFileRef && !hasSnapshot) {
		pushReuseReason("indexed_file_ref_missing_snapshot");
	}
	if (
		indexedFileState === "ready" &&
		((!input.hasChunks && !isExplicitZeroChunkRef) ||
			!hasSnapshot ||
			(!hasVector && !isExplicitZeroChunkRef) ||
			!hasIndexedFileRef)
	) {
		pushReuseReason("ready_missing_data");
	}
	if (
		indexedFileState === "lexical_only" &&
		(!input.hasChunks || !hasSnapshot || hasVector || !hasIndexedFileRef)
	) {
		pushReuseReason("lexical_only_shape_mismatch");
	}
	if (
		input.indexedFileRef?.chunkCount !== undefined &&
		input.indexedFileRef.chunkCount !== input.chunkCount
	) {
		pushReuseReason("indexed_file_ref_chunk_count_mismatch");
	}
	if (
		input.vectorInfo?.chunkCount !== undefined &&
		input.vectorInfo.chunkCount !== input.chunkCount
	) {
		pushReuseReason("vector_chunk_count_mismatch");
	}
	if (
		input.indexedFileRef?.generation !== undefined &&
		alignedSnapshotGeneration !== undefined &&
		input.indexedFileRef.generation !== alignedSnapshotGeneration
	) {
		pushReuseReason("snapshot_generation_mismatch");
	}
	if (
		input.indexedFileRef?.generation !== undefined &&
		input.vectorInfo?.generation !== undefined &&
		input.indexedFileRef.generation !== input.vectorInfo.generation
	) {
		pushReuseReason("vector_generation_mismatch");
	}
	if (input.vectorInfo && input.vectorInfo.precision !== input.currentPrecision) {
		pushReuseReason("vector_precision_mismatch");
	}

	const repairReasons = [...reuseBlockedReasons];
	if (!input.existsInVault && anyStoredData) {
		repairReasons.push("stale_missing_vault_file");
	}

	return {
		indexedFileState,
		hasSnapshot,
		hasShadowSnapshot,
		hasVector,
		hasIndexedFileRef,
		reuseBlockedReasons,
		repairReasons,
	};
}
