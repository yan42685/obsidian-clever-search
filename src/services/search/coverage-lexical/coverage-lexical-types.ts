export type CoverageFamilyMatchKind = "exact" | "prefix" | "fuzzy" | null;

export type CoverageLexicalFamilyStrength = "core" | "soft";

export type CoverageLexicalFamilyRole = "body" | "anchor" | "noise";

export type CoverageLexicalFamily = {
	index: number;
	rawTerm: string;
	normalizedTerm: string;
	strength: CoverageLexicalFamilyStrength;
	role: CoverageLexicalFamilyRole;
	isMetadataCapable: boolean;
	allowPrefix: boolean;
	allowFuzzy: boolean;
};

export type CoverageLexicalPhraseSignature = {
	index: number;
	familyIndices: number[];
	variants: string[];
	tailWeight: number;
	preferredFields?: CoverageLexicalMetadataField[] | null;
};

export type CoverageLexicalPairSignature = {
	leftFamilyIndex: number;
	rightFamilyIndex: number;
	variants: string[];
	tailWeight: number;
	allowCandidateRecall: boolean;
};

export type CoverageLexicalMetadataField =
	| "basename"
	| "aliases"
	| "folder"
	| "headings"
	| "tags";

export type CoverageLexicalCandidateState = {
	bodyMatches: Map<number, CoverageFamilyMatchKind>;
	metadataMatches: Map<number, CoverageFamilyMatchKind>;
	metadataFieldMatches: Record<
		CoverageLexicalMetadataField,
		Map<number, CoverageFamilyMatchKind>
	>;
	phraseMatches: Set<number>;
};

export type CoverageLexicalRecallLaneDebug = {
	laneName:
		| "strict_metadata_lane"
		| "strict_hybrid_lane"
		| "relaxed_hybrid_lane"
		| "local_body_lane"
		| "bridge_lane";
	candidateCount: number;
	admittedCount: number;
	admittedPaths: string[];
};

export type CoverageLexicalRecallDebug = {
	lanes: CoverageLexicalRecallLaneDebug[];
	unionSize: number;
};

export type CoverageLexicalRoute =
	| "body-first"
	| "body-with-anchor"
	| "metadata-first";

export type CoverageLexicalQueryKind =
	| "metadata_only_anchored"
	| "body_only_local"
	| "anchor_body_hybrid"
	| "bridge_dependent"
	| "memory_relaxed";

export type CoverageLexicalFamilyProbe = {
	bodyExactDocCount: number;
	metadataExactDocCount: number;
	basenameExactDocCount: number;
	folderExactDocCount: number;
	headingExactDocCount: number;
	aliasExactDocCount: number;
};

export type CoverageLexicalQuerySpanKind =
	| "raw_shape"
	| "title_path"
	| "metadata_intent"
	| "filler"
	| "body";

export type CoverageLexicalQuerySpan = {
	text: string;
	kind: CoverageLexicalQuerySpanKind;
	reason: string;
};

export type CoverageLexicalPlanFamilyReason = {
	familyIndex: number;
	term: string;
	bucket:
		| "hard_anchor"
		| "decisive_body"
		| "support_body"
		| "optional"
		| "noise"
		| "bridge";
	reasons: string[];
	spanKinds: CoverageLexicalQuerySpanKind[];
};

export type CoverageLexicalPlanExplain = {
	spans: CoverageLexicalQuerySpan[];
	familyReasons: CoverageLexicalPlanFamilyReason[];
	queryKindReasons: string[];
};

export type CoverageLexicalPlan = {
	families: CoverageLexicalFamily[];
	queryKind: CoverageLexicalQueryKind;
	shortQueryOverlay: boolean;
	hasMetadataHint: boolean;
	hasMixedScriptHint: boolean;
	hasPathShapeHint: boolean;
	hasTitleShapeHint: boolean;
	route: CoverageLexicalRoute;
	hardAnchorFamilies: CoverageLexicalFamily[];
	decisiveBodyFamilies: CoverageLexicalFamily[];
	supportBodyFamilies: CoverageLexicalFamily[];
	optionalFamilies: CoverageLexicalFamily[];
	noiseFamilies: CoverageLexicalFamily[];
	bridgeFamilies: CoverageLexicalFamily[];
	relaxedMinimumMatchCount: number;
	coreFamilyCount: number;
	anchorFamilyCount: number;
	bodyFamilyCount: number;
	explain: CoverageLexicalPlanExplain;
};

export type CoverageLexicalAreaSignal = {
	coverageCount: number;
	exactWeight: number;
	prefixWeight: number;
	fuzzyWeight: number;
};

export type CoverageLexicalMetadataIdentitySignal = {
	phraseCoverageCount: number;
	phraseWeight: number;
	overall: CoverageLexicalAreaSignal;
	alias: CoverageLexicalAreaSignal;
	basename: CoverageLexicalAreaSignal;
	heading: CoverageLexicalAreaSignal;
	path: CoverageLexicalAreaSignal;
};

export type CoverageLexicalLocalWindowSignal = {
	start: number;
	end: number;
	coreCoverageCount: number;
	exactCoreWeight: number;
	prefixCoreWeight: number;
	fuzzyCoreWeight: number;
	anchorCoverageCount: number;
	softCoverageCount: number;
	adjacentCorePairCount: number;
	adjacentCorePairWeight: number;
	orderedPairCount: number;
	orderRatio: number;
	compactnessRatio: number;
	score: number;
	matchedExactCoreFamilyIndices: number[];
	matchedPrefixCoreFamilyIndices: number[];
	matchedFuzzyCoreFamilyIndices: number[];
	matchedAnchorFamilyIndices: number[];
	matchedSoftFamilyIndices: number[];
};

export type CoverageLexicalWindowFusionSignal = {
	primary: CoverageLexicalLocalWindowSignal;
	support: CoverageLexicalLocalWindowSignal;
	supportWindowCount: number;
	corroboratedCoreCoverageCount: number;
	corroboratedExactCoreWeight: number;
	corroboratedPrefixCoreWeight: number;
	corroboratedFuzzyCoreWeight: number;
	corroboratedAnchorCoverageCount: number;
	corroboratedSoftCoverageCount: number;
};

export type CoverageLexicalDisplayWindowKind =
	| "primary"
	| "support"
	| "supplemental";

export type CoverageLexicalDisplayWindow = {
	startTokenIndex: number;
	endTokenIndex: number;
	signal: CoverageLexicalLocalWindowSignal;
	matchedFamilyIndices: number[];
	kind: CoverageLexicalDisplayWindowKind;
	rank: number;
};

export type CoverageLexicalHighlightRange = {
	start: number;
	end: number;
};

export type CoverageLexicalPassageAdmissionSignal = {
	coreCoverageCount: number;
	exactWeight: number;
	prefixWeight: number;
	fuzzyWeight: number;
	anchorCoverageCount: number;
	softCoverageCount: number;
	phraseMatchCount: number;
	phraseMatchWeight: number;
	compactnessScore: number;
};

export type CoverageLexicalFamilySignal = {
	coreBody: CoverageLexicalAreaSignal;
	softBody: CoverageLexicalAreaSignal;
	metadataAnchor: CoverageLexicalAreaSignal;
	metadataIdentity: CoverageLexicalMetadataIdentitySignal;
	tailCoreWeight: number;
	tailSoftWeight: number;
	phraseBridgeCount: number;
	phraseBridgeWeight: number;
	localEvidence: CoverageLexicalWindowFusionSignal;
	matchedTerms: string[];
};
