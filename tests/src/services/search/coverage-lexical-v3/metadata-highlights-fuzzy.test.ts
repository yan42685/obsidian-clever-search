import { analyzeQuery } from "src/services/search/coverage-lexical-v3/query";
import { buildV3MetadataFieldHighlightRanges } from "src/services/search/coverage-lexical-v3/metadata-highlights";
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
		fuzzyUnitCount: overrides.fuzzyUnitCount ?? 1,
		fuzzyEditDistanceTotal: overrides.fuzzyEditDistanceTotal ?? 1,
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

function sliceHighlights(
	text: string,
	ranges: readonly { start: number; end: number }[],
): string[] {
	return ranges.map((range) => text.slice(range.start, range.end));
}

describe("coverage lexical v3 fuzzy metadata highlights", () => {
	test("fuzzy metadata matches render as weak ranges while exact remains strong", () => {
		const queryAnalysis = analyzeQuery("obsidan runtime");
		const highlights = buildV3MetadataFieldHighlightRanges({
			queryAnalysis,
			candidate: createPackingProfile({
				path: "notes/runtime-obsidian.md",
				realizedFamilies: [
					{
						queryUnitIndex: 0,
						queryUnitText: "obsidan",
						querySurfaceGroupIndex: null,
						familyId: 1,
						shardLocalFamilySlot: 1,
						familyText: "obsidian",
						matchKind: "fuzzy",
						editDistance: 1,
						identityMetadataSource: "basename",
						routeMetadataSource: "none",
						metadataPackingSource: "basename",
						bodyPrefixSupportKind: "none",
						inIdentity: true,
						inRoute: false,
						inHeading: false,
						inBestBodyWindow: false,
						inBodyResidue: false,
					},
					{
						queryUnitIndex: 1,
						queryUnitText: "runtime",
						querySurfaceGroupIndex: null,
						familyId: 2,
						shardLocalFamilySlot: 2,
						familyText: "runtime",
						matchKind: "exact",
						editDistance: 0,
						identityMetadataSource: "basename",
						routeMetadataSource: "folder",
						metadataPackingSource: "basename",
						bodyPrefixSupportKind: "none",
						inIdentity: true,
						inRoute: true,
						inHeading: false,
						inBestBodyWindow: false,
						inBodyResidue: false,
					},
				],
			}),
			basenameText: "obsidian runtime guide",
			folderText: "notes/runtime/",
		});

		expect(
			sliceHighlights(
				"obsidian runtime guide",
				highlights.basenameWeakHighlightRanges,
			),
		).toContain("obsidian");
		expect(
			sliceHighlights(
				"obsidian runtime guide",
				highlights.basenameHighlightRanges,
			),
		).toContain("runtime");
		expect(
			sliceHighlights("notes/runtime/", highlights.folderWeakHighlightRanges),
		).toEqual([]);
	});

	test("singleton Han metadata matches render as strong ranges", () => {
		const queryAnalysis = analyzeQuery("\u9910");
		const highlights = buildV3MetadataFieldHighlightRanges({
			queryAnalysis,
			candidate: createPackingProfile({
				path: "notes/menu.md",
				realizedCoverageCount: 0,
				realizedFamilies: [],
				singletonHanCompletion: {
					singletonHanChar: "\u9910",
					singletonHanCharIndex: null,
					singletonHanSurfaceGroupIndex: 0,
					matched: true,
					matchSource: "identity",
					bestAnchorKind: "none",
					bestAnchorDistance: null,
					sameBlockAsAnchor: false,
					sameBlockAsBestBodyWindow: false,
					tier: "tight",
				},
			}),
			basenameText: "\u5957\u9910\u8bf4\u660e",
			folderText: "notes/\u9910\u996e/",
		});

		expect(
			sliceHighlights("\u5957\u9910\u8bf4\u660e", highlights.basenameHighlightRanges),
		).toContain("\u9910");
		expect(highlights.basenameWeakHighlightRanges).toEqual([]);
	});
});
