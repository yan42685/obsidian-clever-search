import type { V3QueryFamilyMatchKind } from "../recall";
import type { HanRescueAssessment } from "../han-rescue";
import type {
	IdentityMetadataSource,
	MetadataPackingSource,
	RouteMetadataSource,
} from "../metadata-source";

export type HeadingCorroboration = Readonly<{
	coveredUnitIndices: readonly number[];
	unitCount: number;
}>;

export type EvidenceContainerTier = "identity" | "route" | "bodyWindow";

export type EvidenceContainer = Readonly<{
	tier: EvidenceContainerTier;
	coveredUnitIndices: readonly number[];
	coveredDistinctUnitCount: number;
	containerCompactness: number;
	exactUnitCount: number;
}>;

export type IdentityContainer = EvidenceContainer &
	Readonly<{
		tier: "identity";
	}>;

export type RouteContainer = EvidenceContainer &
	Readonly<{
		tier: "route";
	}>;

export type BodyWindowContainer = EvidenceContainer &
	Readonly<{
		tier: "bodyWindow";
		blockIds: readonly number[];
		boundaryCrossingCount: number;
		windowWidth: number;
		gapCount: number;
		density: number;
		headingCorroboration: HeadingCorroboration;
	}>;

export type BodyPrefixSupportKind = "none" | "standalone" | "compound_only" | "mixed";

export type RealizedQueryUnitFamily = Readonly<{
	queryUnitIndex: number;
	queryUnitText: string;
	querySurfaceGroupIndex: number | null;
	familyId: number;
	shardLocalFamilySlot: number;
	familyText: string;
	matchKind: V3QueryFamilyMatchKind;
	editDistance: 0 | 1;
	identityMetadataSource: IdentityMetadataSource;
	routeMetadataSource: RouteMetadataSource;
	metadataPackingSource: MetadataPackingSource;
	bodyPrefixSupportKind: BodyPrefixSupportKind;
	inIdentity: boolean;
	inRoute: boolean;
	inHeading: boolean;
	inBestBodyWindow: boolean;
	inBodyResidue: boolean;
}>;

export type MetadataPackingBucket = Readonly<{
	source: Exclude<MetadataPackingSource, "none">;
	unitCount: number;
}>;

export type MetadataPackingSignature = Readonly<{
	basenameUnitCount: number;
	aliasUnitCount: number;
	routeUnitCount: number;
	sortedBuckets: readonly MetadataPackingBucket[];
}>;

export type FragmentationPenalty = Readonly<{
	bodyResidueUnitCount: number;
	uncoveredByTopTwoCount: number;
	explanatoryContainerCount: number;
}>;

export type HanSurfaceCompletionTier =
	| "none"
	| "body_residue"
	| "body_window"
	| "route"
	| "identity";

export type CoverageGateProfile = Readonly<{
	realizedCoverageCount: number;
	fullySatisfiedSurfaceGroupCount: number;
	startedSurfaceGroupCount: number;
	crossScriptSatisfiedGroupCount: number;
}>;

export type HanSurfaceCompletionGroupResult = Readonly<{
	surfaceGroupIndex: number;
	surfaceText: string;
	tier: HanSurfaceCompletionTier;
}>;

export type SingletonHanCompletionMatchSource =
	| "none"
	| "identity"
	| "route"
	| "body_same_block"
	| "body_adjacent_block";

export type SingletonHanCompletionAnchorKind =
	| "none"
	| "exact"
	| "prefix"
	| "fuzzy"
	| "bigram";

export type SingletonHanCompletionTier = "none" | "tight";

export type SingletonHanCompletion = Readonly<{
	singletonHanChar: string | null;
	singletonHanCharIndex: number | null;
	singletonHanSurfaceGroupIndex: number | null;
	matched: boolean;
	matchSource: SingletonHanCompletionMatchSource;
	bestAnchorKind: SingletonHanCompletionAnchorKind;
	bestAnchorDistance: number | null;
	sameBlockAsAnchor: boolean;
	sameBlockAsBestBodyWindow: boolean;
	tier: SingletonHanCompletionTier;
}>;

export type EvidencePackingProfile = Readonly<{
	docId: number;
	path: string;
	stableKey: string;
	surfaceCoverageShapeKey: string;
	realizedCoverageCount: number;
	coverageGate: CoverageGateProfile;
	exactUnitCount: number;
	completedHanSurfaceGroupCount: number;
	hanSurfaceCompletionTierScoreTotal: number;
	strongestHanSurfaceCompletionTier: HanSurfaceCompletionTier;
	hanSurfaceCompletionGroups: readonly HanSurfaceCompletionGroupResult[];
	singletonHanCompletion: SingletonHanCompletion;
	hanStrongRescueGroupCount: number;
	hanWeakRescueGroupCount: number;
	hanRescueSupportWeightTotal: number;
	hasOnlyWeakHanRescue: boolean;
	hasAnyHanRescueAssessment: boolean;
	hanRescueAssessments: readonly HanRescueAssessment[];
	prefixCompletionGainTotal: number;
	compoundBackedPrefixCount: number;
	compoundPrefixCount: number;
	fuzzyUnitCount: number;
	fuzzyEditDistanceTotal: number;
	metadataPackingSignature: MetadataPackingSignature;
	realizedFamilies: readonly RealizedQueryUnitFamily[];
	identityContainer: IdentityContainer | null;
	routeContainer: RouteContainer | null;
	bodyWindowContainer: BodyWindowContainer | null;
	strongestContainer: EvidenceContainer | null;
	secondStrongestContainer: EvidenceContainer | null;
	fragmentationPenalty: FragmentationPenalty;
}>;
