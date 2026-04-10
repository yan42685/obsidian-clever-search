export type CoverageLexicalV2RankingLayer =
	| "distinctMatchedPrimaryQueryUnitCount"
	| "surfaceCoverageShape"
	| "matchedPrimaryUnitFieldProfile"
	| "primaryUnitMatchQuality"
	| "primaryUnitProximityScore"
	| "stableDeterministicFallback";

export type CoverageLexicalV2MatchField =
	| "basename"
	| "aliases"
	| "headings"
	| "folder"
	| "tag"
	| "body";

export type CoverageLexicalV2MatchQualityKind = "exact" | "prefix" | "fuzzy";

export type CoverageLexicalV2SurfaceCoverageShape = {
	matchedGroupCount: number;
	totalGroupCount: number;
	preservesVisibleGrouping: boolean;
	preservesCrossScriptCoverage: boolean;
};

export type CoverageLexicalV2MatchedPrimaryUnitFieldProfile = {
	basenameScore: number;
	aliasesScore: number;
	headingsScore: number;
	folderScore: number;
	tagScore: number;
	bodyScore: number;
};

export type CoverageLexicalV2PrimaryUnitMatchQuality = {
	latinExactCount: number;
	latinPrefixCount: number;
	latinFuzzyCount: number;
	hanExactCount: number;
};

export type CoverageLexicalV2PrimaryUnitProximityScore = {
	matchedUnitCount: number;
	windowWidth: number;
	averageDistance: number;
	preservesSurfaceOrder: boolean;
};

export type CoverageLexicalV2MatchedPrimaryUnitEvidence = {
	normalizedText: string;
	surfaceGroupIndex: number;
	surfaceKind: "latin" | "han" | "mixed";
	strongestField: CoverageLexicalV2MatchField;
	corroboratedFields?: CoverageLexicalV2MatchField[];
	matchQuality: CoverageLexicalV2MatchQualityKind;
};

export type CoverageLexicalV2BestWindowEvidence = {
	field?: CoverageLexicalV2MatchField;
	matchedUnitKeys: string[];
	windowWidth: number;
	averageDistance: number;
	preservesSurfaceOrder: boolean;
};

export type CoverageLexicalV2RankingEvidence = {
	candidateId: string;
	stableDeterministicKey: string;
	matchedPrimaryUnits: CoverageLexicalV2MatchedPrimaryUnitEvidence[];
	bestWindow?: CoverageLexicalV2BestWindowEvidence | null;
};

export type CoverageLexicalV2RankingCandidate = {
	candidateId: string;
	distinctMatchedPrimaryQueryUnitCount: number;
	surfaceCoverageShape: CoverageLexicalV2SurfaceCoverageShape;
	matchedPrimaryUnitFieldProfile: CoverageLexicalV2MatchedPrimaryUnitFieldProfile;
	primaryUnitMatchQuality: CoverageLexicalV2PrimaryUnitMatchQuality;
	primaryUnitProximityScore?: CoverageLexicalV2PrimaryUnitProximityScore | null;
	stableDeterministicKey: string;
};

export type CoverageLexicalV2RankingDecision = {
	layer: CoverageLexicalV2RankingLayer;
	winnerCandidateId: string | null;
	reason: string;
};
