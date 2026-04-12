import type { BaseIndexedFileRef } from "src/globals/search-types";
import type { CoverageLexicalBodyTokenColdConsistencySummary } from "src/services/search/coverage-lexical/coverage-lexical-body-token-cold-types";
import type { CoverageLexicalV2HanSegmentExactSidecarConsistencySummary } from "./coverage-lexical-v2-han-segment-exact-sidecar-types";
import type { CoverageLexicalV2PersistentRecoveryPlan } from "./coverage-lexical-v2-index-store-types";

type CoverageLexicalV2ColdConsistencyLike = {
	needsRepair: boolean;
	requiresReset: boolean;
	reason:
		| "up-to-date"
		| "missing-meta"
		| "schema-mismatch"
		| "count-mismatch"
		| "fingerprint-mismatch";
	missingOrStalePaths: string[];
	danglingPaths: string[];
};

export function planCoverageLexicalV2PersistentRecovery(options: {
	currentIndexedRefs: readonly BaseIndexedFileRef[];
	persistedIndexedRefs: readonly BaseIndexedFileRef[];
	storeIndexedRefs: readonly BaseIndexedFileRef[];
	structuralInvalidityReason?: CoverageLexicalV2PersistentRecoveryPlan["reason"];
	coldConsistency?: CoverageLexicalBodyTokenColdConsistencySummary | null;
	hanExactConsistency?: CoverageLexicalV2HanSegmentExactSidecarConsistencySummary | null;
}): CoverageLexicalV2PersistentRecoveryPlan {
	if (options.structuralInvalidityReason) {
		return {
			status: "needs_full_rebuild",
			reason: options.structuralInvalidityReason,
			docsToDelete: [],
			docsToAdd: [],
			docsToUpdate: [],
			docsToMove: [],
		};
	}

	const persistedByPath = new Map(
		options.persistedIndexedRefs.map((ref) => [ref.path, ref] as const),
	);
	const currentByPath = new Map(
		options.currentIndexedRefs.map((ref) => [ref.path, ref] as const),
	);
	const storeByPath = new Map(
		options.storeIndexedRefs.map((ref) => [ref.path, ref] as const),
	);

	if (!isCoverageLexicalV2StoreAlignedWithPersistedRefs(persistedByPath, storeByPath)) {
		return {
			status: "needs_full_rebuild",
			reason: "persisted_ref_mismatch",
			docsToDelete: [],
			docsToAdd: [],
			docsToUpdate: [],
			docsToMove: [],
		};
	}

	const docsToDelete = new Set<string>();
	const docsToAdd = new Set<string>();
	const docsToUpdate = new Set<string>();
	const docsToMove: Array<{ oldPath: string; newPath: string }> = [];

	for (const [path, currentRef] of currentByPath) {
		const persistedRef = persistedByPath.get(path);
		if (!persistedRef) {
			docsToAdd.add(path);
			continue;
		}
		if (
			persistedRef.generation !== currentRef.generation ||
			(persistedRef.size ?? -1) !== (currentRef.size ?? -1)
		) {
			docsToUpdate.add(path);
		}
	}

	for (const path of persistedByPath.keys()) {
		if (!currentByPath.has(path)) {
			docsToDelete.add(path);
		}
	}

	const inferredMoves = inferCoverageLexicalV2Moves(
		[...docsToDelete],
		[...docsToAdd],
		persistedByPath,
		currentByPath,
	);
	for (const move of inferredMoves) {
		docsToDelete.delete(move.oldPath);
		docsToAdd.delete(move.newPath);
		docsToMove.push(move);
	}

	const consistencySummaries: CoverageLexicalV2ColdConsistencyLike[] = [
		options.coldConsistency,
		options.hanExactConsistency,
	].flatMap((summary) => (summary ? [summary] : []));

	for (const consistency of consistencySummaries) {
		if (!consistency.needsRepair) {
			continue;
		}
		for (const path of consistency.danglingPaths) {
			docsToDelete.add(path);
		}
		for (const path of consistency.missingOrStalePaths) {
			if (currentByPath.has(path)) {
				docsToUpdate.add(path);
			}
		}
	}

	const status =
		docsToDelete.size > 0 ||
		docsToAdd.size > 0 ||
		docsToUpdate.size > 0 ||
		docsToMove.length > 0
			? "needs_heal"
			: "up_to_date";
	const reason =
		consistencySummaries.some((summary) => summary.needsRepair)
			? "cold_sidecar_drift"
			: status === "needs_heal"
				? "vault_drift"
				: "up_to_date";

	return {
		status,
		reason,
		docsToDelete: [...docsToDelete].sort(),
		docsToAdd: [...docsToAdd].sort(),
		docsToUpdate: [...docsToUpdate].sort(),
		docsToMove: docsToMove.sort((left, right) =>
			left.oldPath.localeCompare(right.oldPath),
		),
	};
}

function isCoverageLexicalV2StoreAlignedWithPersistedRefs(
	persistedByPath: ReadonlyMap<string, BaseIndexedFileRef>,
	storeByPath: ReadonlyMap<string, BaseIndexedFileRef>,
): boolean {
	if (persistedByPath.size !== storeByPath.size) {
		return false;
	}
	for (const [path, persistedRef] of persistedByPath) {
		const storedRef = storeByPath.get(path);
		if (!storedRef) {
			return false;
		}
		if (
			storedRef.generation !== persistedRef.generation ||
			(storedRef.size ?? -1) !== (persistedRef.size ?? -1)
		) {
			return false;
		}
	}
	return true;
}

function inferCoverageLexicalV2Moves(
	deletedPaths: readonly string[],
	addedPaths: readonly string[],
	persistedByPath: ReadonlyMap<string, BaseIndexedFileRef>,
	currentByPath: ReadonlyMap<string, BaseIndexedFileRef>,
): Array<{ oldPath: string; newPath: string }> {
	const deletedBySignature = new Map<string, string[]>();
	for (const path of deletedPaths) {
		const ref = persistedByPath.get(path);
		if (!ref) {
			continue;
		}
		const signature = `${ref.generation}:${ref.size ?? -1}`;
		const paths = deletedBySignature.get(signature) ?? [];
		paths.push(path);
		deletedBySignature.set(signature, paths);
	}

	const moves: Array<{ oldPath: string; newPath: string }> = [];
	for (const path of addedPaths) {
		const ref = currentByPath.get(path);
		if (!ref) {
			continue;
		}
		const signature = `${ref.generation}:${ref.size ?? -1}`;
		const deletedMatches = deletedBySignature.get(signature);
		if (!deletedMatches || deletedMatches.length !== 1) {
			continue;
		}
		const [oldPath] = deletedMatches;
		moves.push({ oldPath, newPath: path });
		deletedBySignature.delete(signature);
	}
	return moves;
}
