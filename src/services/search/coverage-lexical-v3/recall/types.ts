import type { V3QueryAnalysis, V3QueryUnitSource } from "../query/analysis";

export type V3QueryFamilyMatchKind =
	| "exact"
	| "opaque_exact"
	| "prefix"
	| "fuzzy";

export type V3QueryFamilyMatch = Readonly<{
	shardId?: string;
	shardGeneration?: number;
	familyId: number;
	shardLocalFamilySlot: number;
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

export type V3ResolvedHanSurfaceGroupRescueMode =
	| "none"
	| "residual_only"
	| "whole_group_when_real_miss";

export type V3ResolvedHanSurfaceGroup = Readonly<{
	surfaceGroupIndex: number;
	surfaceText: string;
	realUnitIndices: readonly number[];
	matchedRealUnitIndices: readonly number[];
	matchedCharMask: readonly boolean[];
	rescueMode: V3ResolvedHanSurfaceGroupRescueMode;
	rescueBigrams: readonly string[];
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

export type V3CandidateBodyBlockRecall = Readonly<{
	blockId: number;
	hasExactSupport: boolean;
	hasPrefixSupport: boolean;
	hasStrongHanSupport: boolean;
	hasSingletonHanSupport: boolean;
	hasScopedSingletonHanSupport: boolean;
}>;

export type V3CandidateHanSurfaceGroupRecall = Readonly<{
	surfaceGroupIndex: number;
	metadataGateStats: V3HanRouteGateStats | null;
	bodySeedBlockIds: readonly number[];
	bodySeedBlockGates: readonly V3HanBodyBlockGate[];
}>;

export type V3CandidateDocRecall = Readonly<{
	shardId: string;
	shardGeneration: number;
	docId: number;
	liveDocSlot: number;
	matchedIdentityUnitIndices: readonly number[];
	matchedRouteUnitIndices: readonly number[];
	matchedHeadingUnitIndices: readonly number[];
	hasQuerySingletonHanMetadataSupport: boolean;
	hasScopedSingletonHanMetadataSupport: boolean;
	shortlistedBodyBlocks: readonly V3CandidateBodyBlockRecall[];
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
