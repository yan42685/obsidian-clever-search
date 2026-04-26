import type { ResidentBase } from "./layout/types";
import type { V3CandidateDocRecall } from "./recall";
import { getLiveDocGeneration, getLiveDocRef } from "./recall/access";

export type ShardInvalidationReason = "superseded" | "deleted";

export type ShardInvalidationEntry = Readonly<{
	shardId: string;
	shardGeneration: number;
	docRef: number;
	docGeneration: number;
	reason: ShardInvalidationReason;
	createdAt: number;
}>;

export function buildShardInvalidationKey(
	entry: Pick<
		ShardInvalidationEntry,
		"shardId" | "shardGeneration" | "docRef" | "docGeneration"
	>,
): string {
	return `${entry.shardId}@${entry.shardGeneration}:docref:${entry.docRef}@${entry.docGeneration}`;
}

export function buildShardInvalidationSet(
	entries: readonly ShardInvalidationEntry[],
): ReadonlySet<string> {
	return new Set(entries.map(buildShardInvalidationKey));
}

export function isCandidateInvalidated(
	base: ResidentBase,
	candidateRecall: V3CandidateDocRecall,
	invalidatedKeys: ReadonlySet<string>,
): boolean {
	const docRef = getLiveDocRef(base, candidateRecall.liveDocSlot);
	if (docRef == null) {
		return false;
	}
	return invalidatedKeys.has(
		buildShardInvalidationKey({
			shardId: candidateRecall.shardId,
			shardGeneration: candidateRecall.shardGeneration,
			docRef,
			docGeneration: getLiveDocGeneration(base, candidateRecall.liveDocSlot),
		}),
	);
}

export function filterInvalidatedCandidates(
	candidateRecalls: readonly V3CandidateDocRecall[],
	getCandidateBase: (candidateRecall: V3CandidateDocRecall) => ResidentBase,
	invalidatedKeys: ReadonlySet<string>,
): V3CandidateDocRecall[] {
	if (invalidatedKeys.size === 0) {
		return [...candidateRecalls];
	}
	return candidateRecalls.filter(
		(candidateRecall) =>
			!isCandidateInvalidated(
				getCandidateBase(candidateRecall),
				candidateRecall,
				invalidatedKeys,
			),
	);
}
