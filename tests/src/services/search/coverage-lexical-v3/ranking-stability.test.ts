import { comparePackingProfiles } from "src/services/search/coverage-lexical-v3/ranking";
import type { EvidencePackingProfile } from "src/services/search/coverage-lexical-v3/ranking/types";

function createPackingProfile(
	overrides: Partial<EvidencePackingProfile> & Pick<EvidencePackingProfile, "path">,
): EvidencePackingProfile {
	return {
		shardId: overrides.shardId ?? "test-shard",
		shardGeneration: overrides.shardGeneration ?? 1,
		docId: overrides.docId ?? 0,
		liveDocSlot: overrides.liveDocSlot ?? (overrides.docId ?? 0),
		path: overrides.path,
		stableKey: overrides.stableKey ?? overrides.path,
		surfaceCoverageShapeKey: overrides.surfaceCoverageShapeKey ?? "l",
		realizedCoverageCount: overrides.realizedCoverageCount ?? 1,
		coverageGate: overrides.coverageGate ?? {
			realizedCoverageCount: overrides.realizedCoverageCount ?? 1,
			fullySatisfiedSurfaceGroupCount: 1,
			startedSurfaceGroupCount: 1,
			crossScriptSatisfiedGroupCount: 1,
		},
		exactOrPrefixUnitCount:
			overrides.exactOrPrefixUnitCount ?? overrides.exactUnitCount ?? 0,
		exactUnitCount: overrides.exactUnitCount ?? 0,
		completedHanSurfaceGroupCount: overrides.completedHanSurfaceGroupCount ?? 0,
		hanSurfaceCompletionTierScoreTotal: overrides.hanSurfaceCompletionTierScoreTotal ?? 0,
		strongestHanSurfaceCompletionTier:
			overrides.strongestHanSurfaceCompletionTier ?? "none",
		hanSurfaceCompletionGroups: overrides.hanSurfaceCompletionGroups ?? [],
		singletonHanCompletion: overrides.singletonHanCompletion ?? {
			singletonHanChar: null,
			singletonHanCharIndex: null,
			singletonHanSurfaceGroupIndex: null,
			matched: false,
			matchSource: "none",
			bestAnchorKind: "none",
			bestAnchorDistance: null,
			sameBlockAsAnchor: false,
			sameBlockAsBestBodyWindow: false,
			tier: "none",
		},
		hanStrongRescueGroupCount: overrides.hanStrongRescueGroupCount ?? 0,
		hanWeakRescueGroupCount: overrides.hanWeakRescueGroupCount ?? 0,
		hanRescueSupportWeightTotal: overrides.hanRescueSupportWeightTotal ?? 0,
		hasOnlyWeakHanRescue: overrides.hasOnlyWeakHanRescue ?? false,
		hasAnyHanRescueAssessment: overrides.hasAnyHanRescueAssessment ?? false,
		hanRescueAssessments: overrides.hanRescueAssessments ?? [],
		prefixCompletionGainTotal: overrides.prefixCompletionGainTotal ?? 0,
		compoundBackedPrefixCount: overrides.compoundBackedPrefixCount ?? 0,
		compoundPrefixCount: overrides.compoundPrefixCount ?? 0,
		fuzzyUnitCount: overrides.fuzzyUnitCount ?? 0,
		fuzzyEditDistanceTotal: overrides.fuzzyEditDistanceTotal ?? 0,
		metadataPackingSignature: overrides.metadataPackingSignature ?? {
			basenameUnitCount: 0,
			aliasUnitCount: 0,
			routeUnitCount: 0,
			sortedBuckets: [],
		},
		realizedFamilies: overrides.realizedFamilies ?? [],
		identityContainer: overrides.identityContainer ?? null,
		routeContainer: overrides.routeContainer ?? null,
		bodyWindowContainer: overrides.bodyWindowContainer ?? null,
		strongestContainer: overrides.strongestContainer ?? null,
		secondStrongestContainer: overrides.secondStrongestContainer ?? null,
		fragmentationPenalty:
			overrides.fragmentationPenalty ?? {
				bodyResidueUnitCount: 0,
				uncoveredByTopTwoCount: 0,
				explanatoryContainerCount: 0,
			},
	};
}

describe("coverage lexical v3 ranking stability", () => {
	test("mixed exact, prefix, and fuzzy ties sort repeatably", () => {
		const profiles = [
			createPackingProfile({
				path: "b-fuzzy.md",
				fuzzyUnitCount: 1,
				fuzzyEditDistanceTotal: 1,
			}),
			createPackingProfile({
				path: "a-exact.md",
				exactUnitCount: 1,
			}),
			createPackingProfile({
				path: "c-prefix.md",
				prefixCompletionGainTotal: 1,
			}),
		];

		const firstOrder = [...profiles].sort(comparePackingProfiles).map((profile) => profile.path);
		const secondOrder = [...profiles].sort(comparePackingProfiles).map((profile) => profile.path);

		expect(firstOrder).toEqual(secondOrder);
		expect(firstOrder).toEqual(["a-exact.md", "b-fuzzy.md", "c-prefix.md"]);
	});
});
