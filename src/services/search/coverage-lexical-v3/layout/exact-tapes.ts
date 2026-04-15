import type { ResidentExactTapeArena } from "./types";

export type ExactTapeDraft = Readonly<{
	familyIds: readonly number[];
}>;

export type ExactTapeBuildOutput = Readonly<{
	arena: ResidentExactTapeArena;
	startsByDraftIndex: Uint32Array;
	countsByDraftIndex: Uint32Array;
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
			familyIds: Uint32Array.from(familyIds),
		},
		startsByDraftIndex: Uint32Array.from(starts),
		countsByDraftIndex: Uint32Array.from(counts),
	};
}

export function estimateExactTapeBytes(
	arena: ResidentExactTapeArena,
): number {
	return arena.familyIds.byteLength;
}
