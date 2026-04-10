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

export type CoverageLexicalPrefixWitness = {
	channel: "body" | "metadata";
	field: CoverageLexicalMetadataField | null;
	term: string;
	surfaceText: string | null;
	completionGain: number;
	surfaceCompletionGain: number;
	boundaryQuality: number;
	compoundPenalty: number;
	shapePenalty: number;
	targetDocCount: number;
	totalDocCount: number;
};

export type CoverageLexicalUnresolvedBodyEvidence = {
	needsPassageSignal: boolean;
	hasUnverifiedPhraseWitness: boolean;
	hasUnresolvedPrefixSurface: boolean;
	hasUnresolvedBodyCharVerification: boolean;
	unresolvedFamilyCount: number;
	unresolvedWeightUpperBound: number;
};

export type CoverageLexicalCandidateState = {
	bodyMatches: number[];
	bodyCharMatchIndices: number[];
	bodyCharMatchFlags: number[];
	bodyPrefixWitness: CoverageLexicalPrefixWitness | null;
	metadataMatches: number[];
	metadataAssistFieldMatches: Record<
		CoverageLexicalMetadataField,
		number[]
	>;
	metadataCharMatchIndices: number[];
	metadataCharMatchFlags: number[];
	metadataFieldMatches: Record<
		CoverageLexicalMetadataField,
		number[]
	>;
	metadataPrefixWitness: CoverageLexicalPrefixWitness | null;
	phraseMatches: number[];
	phraseMatchFlags: number[];
	unresolvedBodyPhraseMatchIndices: number[];
	tagCharMatchIndices: number[];
	tagCharMatchFlags: number[];
	tagExactMatchIndices: number[];
	tagExactMatchFlags: number[];
	unresolvedBodyEvidence: CoverageLexicalUnresolvedBodyEvidence;
};

export type CoverageLexicalRecallLaneDebug = {
	laneName:
	| "strict_metadata_lane"
	| "strict_hybrid_lane"
	| "relaxed_hybrid_lane"
	| "local_body_lane"
	| "bridge_lane"
	| "char_fallback_lane";
	candidateCount: number;
	candidatePaths: string[];
	prefilterCount: number;
	admittedCount: number;
	prefilteredPaths: string[];
	admittedPaths: string[];
};

export type CoverageLexicalRecallDebug = {
	lanes: CoverageLexicalRecallLaneDebug[];
	unionSize: number;
};

export type CoverageLexicalQueryKind =
	| "metadata_only_anchored"
	| "body_only_local"
	| "anchor_body_hybrid"
	| "bridge_dependent"
	| "memory_relaxed";

export type CoverageLexicalFamilyScriptClass =
	| "han"
	| "latin"
	| "mixed"
	| "other";

export type CoverageLexicalFamilyTier = "decisive" | "support" | "weak";

export type CoverageLexicalFamilyProbe = {
	bodyExactDocCount: number;
	metadataExactDocCount: number;
	basenameExactDocCount: number;
	folderExactDocCount: number;
	headingExactDocCount: number;
	aliasExactDocCount: number;
	combinedExactDocCount?: number;
	scriptClass?: CoverageLexicalFamilyScriptClass;
	lengthWeight?: number;
	rarityWeight?: number;
	weakTokenPenalty?: number;
	familyWeight?: number;
	familyTier?: CoverageLexicalFamilyTier;
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
	queryKind: CoverageLexicalQueryKind;
	spans: CoverageLexicalQuerySpan[];
	familyReasons: CoverageLexicalPlanFamilyReason[];
	queryKindReasons: string[];
};

export type CoverageLexicalResourceHints = {
	metadataBudget: number;
	hybridBudget: number;
	bodyBudget: number;
	memoryBudget: number;
	bridgeBudget: number;
	localWitnessBudget: number;
};

export type CoverageLexicalCoverageRequirements = {
	requiredFamilyIndices: number[];
	decisiveFamilyIndices: number[];
	supportFamilyIndices: number[];
	optionalFamilyIndices: number[];
	bridgeFamilyIndices: number[];
	minimumMatchCount: number;
	requiresCrossScriptCoverage: boolean;
	requiresBalancedMultiTermCoverage: boolean;
};

export type CoverageLexicalRescuePotential = {
	metadataIdentityLikely: boolean;
	phraseRescueLikely: boolean;
	localWitnessLikely: boolean;
	bridgeRescueLikely: boolean;
	unresolvedBodyUpgradeLikely: boolean;
};

export type CoverageLexicalPlan = {
	families: CoverageLexicalFamily[];
	queryKind: CoverageLexicalQueryKind;
	shortQueryOverlay: boolean;
	hasMetadataHint: boolean;
	hasMixedScriptHint: boolean;
	hasPathShapeHint: boolean;
	hasTitleShapeHint: boolean;
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
	probes?: readonly CoverageLexicalFamilyProbe[];
	weightedAnchorMass?: number;
	weightedBodyMass?: number;
	weightedOptionalMass?: number;
	decisiveAnchorMass?: number;
	decisiveBodyMass?: number;
	supportAnchorMass?: number;
	supportBodyMass?: number;
	resourceHints?: CoverageLexicalResourceHints;
	coverageRequirements: CoverageLexicalCoverageRequirements;
	rescuePotential: CoverageLexicalRescuePotential;
	explain: CoverageLexicalPlanExplain;
};

export type CoverageLexicalAreaSignal = {
	coverageCount: number;
	exactWeight: number;
	prefixWeight: number;
	fuzzyWeight: number;
};

export type CoverageLexicalCharSignal = {
	matchCount: number;
	matchRatio: number;
	exactSegmentCount: number;
	fullSegmentCount: number;
	bestSegmentCoverageCount: number;
	bestSegmentCoverageRatio: number;
};

export type CoverageLexicalTagSignal = {
	exactMatchCount: number;
	charMatchCount: number;
	charMatchRatio: number;
};

export type CoverageLexicalMetadataIdentitySignal = {
	phraseCoverageCount: number;
	phraseWeight: number;
	overall: CoverageLexicalAreaSignal;
	alias: CoverageLexicalAreaSignal;
	basename: CoverageLexicalAreaSignal;
	heading: CoverageLexicalAreaSignal;
	path: CoverageLexicalAreaSignal;
	tag: CoverageLexicalAreaSignal;
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

export type CoverageLexicalEvidenceMassSummary = {
	decisiveCoveredMass: number;
	decisiveExactIdentityMass: number;
	decisiveExactBodyMass: number;
	decisivePrefixIdentityMass: number;
	decisivePrefixBodyMass: number;
	decisiveFuzzyIdentityMass: number;
	decisiveFuzzyBodyMass: number;
	supportCoveredMass: number;
	supportExactIdentityMass: number;
	supportExactBodyMass: number;
	supportPrefixIdentityMass: number;
	supportPrefixBodyMass: number;
	supportFuzzyIdentityMass: number;
	supportFuzzyBodyMass: number;
	witnessMass: number;
	weakBridgeMass: number;
	displayIdealMass: number;
	displayRawMass: number;
	displayNormalizedMass: number;
};

export type CoverageLexicalCoverageProfile = {
	meaningfulFamilyCount: number;
	meaningfulCoveredFamilyCount: number;
	meaningfulFamilyWeight: number;
	meaningfulCoveredFamilyWeight: number;
	requiredFamilyCount: number;
	requiredCoveredFamilyCount: number;
	requiredFamilyWeight: number;
	requiredCoveredFamilyWeight: number;
	decisiveFamilyCount: number;
	decisiveCoveredFamilyCount: number;
	decisiveFamilyWeight: number;
	decisiveCoveredFamilyWeight: number;
	supportFamilyCount: number;
	supportCoveredFamilyCount: number;
	supportFamilyWeight: number;
	supportCoveredFamilyWeight: number;
	requiredHanFamilyCount: number;
	requiredHanCoveredFamilyCount: number;
	requiredLatinFamilyCount: number;
	requiredLatinCoveredFamilyCount: number;
	crossScriptRequired: boolean;
	crossScriptSatisfied: boolean;
};

export type CoverageLexicalFamilySignal = {
	evidenceMassSummary?: CoverageLexicalEvidenceMassSummary;
	coverageProfile: CoverageLexicalCoverageProfile;
	coreBody: CoverageLexicalAreaSignal;
	softBody: CoverageLexicalAreaSignal;
	metadataAnchor: CoverageLexicalAreaSignal;
	metadataPrefixAssist: CoverageLexicalAreaSignal;
	metadataIdentity: CoverageLexicalMetadataIdentitySignal;
	bodyPrefixWitness: CoverageLexicalPrefixWitness | null;
	metadataPrefixWitness: CoverageLexicalPrefixWitness | null;
	bodyChar: CoverageLexicalCharSignal;
	metadataChar: CoverageLexicalCharSignal;
	tagSignal: CoverageLexicalTagSignal;
	tailCoreWeight: number;
	tailSoftWeight: number;
	phraseBridgeCount: number;
	phraseBridgeWeight: number;
	localEvidence: CoverageLexicalWindowFusionSignal;
	matchedTerms: string[];
};
