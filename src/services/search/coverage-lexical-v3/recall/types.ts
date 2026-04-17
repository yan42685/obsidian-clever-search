import type { V3QueryAnalysis, V3QueryUnitSource } from "../query/analysis";

export type V3QueryFamilyMatchKind =
	| "exact"
	| "opaque_exact"
	| "prefix"
	| "fuzzy";

export type V3QueryFamilyMatch = Readonly<{
	familyId: number;
	familyText: string;
	matchKind: V3QueryFamilyMatchKind;
	editDistance: 0 | 1;
}>;

export type V3QueryUnitFamilyMatches = Readonly<{
	queryUnitIndex: number;
	queryUnitText: string;
	queryUnitSource: V3QueryUnitSource;
	querySurfaceGroupIndex: number | null;
	matches: readonly V3QueryFamilyMatch[];
}>;

export type V3HanRouteGateStats = Readonly<{
	matchedBigramCount: number;
	longestContiguousBigramChain: number;
	bigramCoverageRatio: number;
}>;

export type V3HanBodyBlockGate = Readonly<{
	blockId: number;
	stats: V3HanRouteGateStats;
}>;

export type V3CandidateHanSurfaceGroupRecall = Readonly<{
	surfaceGroupIndex: number;
	metadataGateStats: V3HanRouteGateStats | null;
	bodySeedBlockIds: readonly number[];
	bodySeedBlockGates: readonly V3HanBodyBlockGate[];
}>;

export type V3CandidateDocRecall = Readonly<{
	docId: number;
	matchedIdentityUnitIndices: readonly number[];
	matchedRouteUnitIndices: readonly number[];
	matchedHeadingUnitIndices: readonly number[];
	shortlistedBodyBlockIds: readonly number[];
	hanMetadataGateStats: V3HanRouteGateStats | null;
	hanBodyBlockGateStats: readonly V3HanBodyBlockGate[];
	hanSurfaceGroupRecalls: readonly V3CandidateHanSurfaceGroupRecall[];
}>;

export type V3RecallState = Readonly<{
	queryAnalysis: V3QueryAnalysis;
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[];
	candidateDocs: readonly V3CandidateDocRecall[];
}>;
