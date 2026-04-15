import { buildIntegerArray } from "./integer-arrays";
import type { ResidentExactTapeArena } from "./types";

export type ExactTapeDraft = Readonly<{
	familyIds: readonly number[];
}>;

export type ExactTapeBuildOutput = Readonly<{
	arena: ResidentExactTapeArena;
	startsByDraftIndex: ReturnType<typeof buildIntegerArray>;
	countsByDraftIndex: ReturnType<typeof buildIntegerArray>;
}>;

export function buildExactTapeArena(
	drafts: readonly ExactTapeDraft[],
): ExactTapeBuildOutput {
	const familyIds: number[] = [];
	const starts: number[] = [];
	const counts: number[] = [];
	for (const draft of drafts) {
		starts.push(familyIds.length);
		counts.push(draft.familyIds.length);
		familyIds.push(...draft.familyIds);
	}
	return {
		arena: {
			familyIds: buildIntegerArray(familyIds),
		},
		startsByDraftIndex: buildIntegerArray(starts),
		countsByDraftIndex: buildIntegerArray(counts),
	};
}

export function estimateExactTapeBytes(
	arena: ResidentExactTapeArena,
): number {
	return arena.familyIds.byteLength;
}
