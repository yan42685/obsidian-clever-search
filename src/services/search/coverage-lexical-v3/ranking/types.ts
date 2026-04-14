import type { V3QueryFamilyMatchKind } from "../recall";

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
		blockId: number;
		windowWidth: number;
		gapCount: number;
		density: number;
		headingCorroboration: HeadingCorroboration;
	}>;

export type RealizedQueryUnitFamily = Readonly<{
	queryUnitIndex: number;
	queryUnitText: string;
	familyId: number;
	familyText: string;
	matchKind: V3QueryFamilyMatchKind;
	inIdentity: boolean;
	inRoute: boolean;
	inHeading: boolean;
	inBestBodyWindow: boolean;
	inBodyResidue: boolean;
}>;

export type FragmentationPenalty = Readonly<{
	bodyResidueUnitCount: number;
	uncoveredByTopTwoCount: number;
	activeContainerCount: number;
}>;

export type EvidencePackingProfile = Readonly<{
	docId: number;
	path: string;
	stableKey: string;
	surfaceCoverageShapeKey: string;
	realizedCoverageCount: number;
	exactUnitCount: number;
	realizedFamilies: readonly RealizedQueryUnitFamily[];
	identityContainer: IdentityContainer | null;
	routeContainer: RouteContainer | null;
	bodyWindowContainer: BodyWindowContainer | null;
	strongestContainer: EvidenceContainer | null;
	secondStrongestContainer: EvidenceContainer | null;
	fragmentationPenalty: FragmentationPenalty;
}>;
