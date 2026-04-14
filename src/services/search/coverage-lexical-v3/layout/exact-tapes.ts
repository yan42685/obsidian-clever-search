import type { ResidentExactTapeArena } from "./types";

export type ExactTapeDraft = Readonly<{
	familyIds: readonly number[];
	tokenPositions: readonly number[];
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
	const tokenPositions: number[] = [];
	const starts: number[] = [];
	const counts: number[] = [];
	for (const draft of drafts) {
		starts.push(familyIds.length);
		counts.push(draft.familyIds.length);
		for (let index = 0; index < draft.familyIds.length; index += 1) {
			familyIds.push(draft.familyIds[index]);
			tokenPositions.push(draft.tokenPositions[index] ?? index);
		}
	}
	return {
		arena: {
			familyIds: Uint32Array.from(familyIds),
			tokenPositions: Uint32Array.from(tokenPositions),
		},
		startsByDraftIndex: Uint32Array.from(starts),
		countsByDraftIndex: Uint32Array.from(counts),
	};
}

export function estimateExactTapeBytes(
	arena: ResidentExactTapeArena,
): number {
	return arena.familyIds.byteLength + arena.tokenPositions.byteLength;
}
