import { analyzeQuery } from "src/services/search/coverage-lexical-v3/query/analysis";
import type { V3CandidateDocRecall } from "src/services/search/coverage-lexical-v3/recall";
import type { EvidencePackingProfile } from "src/services/search/coverage-lexical-v3/ranking";
import { buildV3DirectSubitems } from "src/services/search/coverage-lexical-v3/direct-subitems";
import {
	createMinimalCandidate as createBaseCandidate,
	createMinimalCandidateRecall,
	createMinimalResidentBaseForBlockCounts as createResidentBaseForBlockCounts,
	createRealizedFamily,
} from "./test-fixtures";

function createCandidate(
	overrides: Partial<EvidencePackingProfile>,
): EvidencePackingProfile {
	const coveredUnitIndices =
		overrides.bodyWindowContainer?.coveredUnitIndices ??
		overrides.strongestContainer?.coveredUnitIndices ??
		[0];
	const defaultBodyWindow = {
		tier: "bodyWindow" as const,
		blockIds: [0],
		boundaryCrossingCount: 0,
		coveredUnitIndices,
		coveredDistinctUnitCount: coveredUnitIndices.length,
		containerCompactness: 100,
		exactUnitCount: coveredUnitIndices.length,
		windowWidth: 1,
		gapCount: 0,
		density: 1,
		headingCorroboration: { coveredUnitIndices: [], unitCount: 0 },
	};
	return createBaseCandidate({
		...overrides,
		bodyWindowContainer: overrides.bodyWindowContainer ?? defaultBodyWindow,
		strongestContainer:
			overrides.strongestContainer ?? overrides.bodyWindowContainer ?? defaultBodyWindow,
		secondStrongestContainer: overrides.secondStrongestContainer ?? null,
		fragmentationPenalty:
			overrides.fragmentationPenalty ?? {
				bodyResidueUnitCount: 0,
				uncoveredByTopTwoCount: 0,
				explanatoryContainerCount: 1,
			},
	});
}

function createCandidateRecall(
	overrides: Partial<V3CandidateDocRecall>,
): V3CandidateDocRecall {
	const shortlistedBodyBlockIds = overrides.shortlistedBodyBlockIds ?? [0];
	return createMinimalCandidateRecall(shortlistedBodyBlockIds, {
		...overrides,
		hanSurfaceGroupRecalls:
			overrides.hanSurfaceGroupRecalls ?? [
				{
					surfaceGroupIndex: 0,
					metadataGateStats: null,
					bodySeedBlockIds: shortlistedBodyBlockIds,
					bodySeedBlockGates: shortlistedBodyBlockIds.map((blockId) => ({
						blockId,
						stats: {
							matchedBigramCount: 0,
							longestContiguousBigramChain: 0,
							bigramCoverageRatio: 0,
						},
					})),
				},
			],
	});
}

describe("coverage lexical v3 direct subitems residual support", () => {
	test("adds bridge residual support highlights within the local body scope", () => {
		const queryText = "\u751f\u547d\u529b";
		const queryAnalysis = analyzeQuery(queryText, ["\u751f\u547d"]);
		const result = buildV3DirectSubitems({
			snapshotText: "\u524d\u7f00\u751f\u547d\u529b\u540e\u7f00",
			queryAnalysis,
			candidate: createCandidate({
				path: "bridge.md",
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		const strongHighlights = result.subItems[0]?.highlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		const weakHighlights = result.subItems[0]?.weakHighlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(strongHighlights).toContain(queryText);
		expect(weakHighlights ?? []).toHaveLength(0);
	});

	test("same-scope full surface suppresses residual support highlights", () => {
		const queryText = "\u751f\u547d\u529b";
		const queryAnalysis = analyzeQuery(queryText, ["\u751f\u547d"]);
		const result = buildV3DirectSubitems({
			snapshotText: "\u524d\u7f00\u751f\u547d\u529b\u540e\u7f00",
			queryAnalysis,
			candidate: createCandidate({
				path: "full-body.md",
				realizedFamilies: [
					createRealizedFamily({
						queryUnitIndex: 0,
						queryUnitText: "\u751f\u547d",
						familyId: 0,
						familyText: "\u751f\u547d",
					}),
				],
				hanSurfaceCompletionGroups: [
					{ surfaceGroupIndex: 0, surfaceText: queryText, tier: "body_window" },
				],
				completedHanSurfaceGroupCount: 1,
				hanSurfaceCompletionTierScoreTotal: 2,
				strongestHanSurfaceCompletionTier: "body_window",
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		const strongHighlights = result.subItems[0]?.highlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(strongHighlights).toContain(queryText);
		expect(result.subItems[0]?.weakHighlightRanges ?? []).toHaveLength(0);
	});

	test("metadata completion does not globally suppress body residual support", () => {
		const queryText = "\u751f\u547d\u4e4b\u529b";
		const queryAnalysis = analyzeQuery(queryText, ["\u751f\u547d"]);
		const result = buildV3DirectSubitems({
			snapshotText:
				"\u524d\u7f00\u751f\u547d\uff0c\u7136\u540e\u662f\u4e4b\u529b\uff0c\u540e\u7f00",
			queryAnalysis,
			candidate: createCandidate({
				path: "identity-body.md",
				realizedFamilies: [
					createRealizedFamily({
						queryUnitIndex: 0,
						queryUnitText: "\u751f\u547d",
						familyId: 0,
						familyText: "\u751f\u547d",
					}),
				],
				hanSurfaceCompletionGroups: [
					{ surfaceGroupIndex: 0, surfaceText: queryText, tier: "identity" },
				],
				completedHanSurfaceGroupCount: 1,
				hanSurfaceCompletionTierScoreTotal: 4,
				strongestHanSurfaceCompletionTier: "identity",
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		const strongHighlights = result.subItems[0]?.highlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		const weakHighlights = result.subItems[0]?.weakHighlightRanges?.map((range) =>
			(result.subItems[0]?.snippetText ?? "").slice(range.start, range.end),
		);
		expect(strongHighlights).toContain("\u751f\u547d");
		expect(weakHighlights ?? []).toHaveLength(0);
		expect(strongHighlights).not.toContain(queryText);
	});

	test("renders weak Han rescue bigrams with the same visible highlight band as strong bigrams", () => {
		const queryText = "\u8d62\u5b8b\u7a84\u4f53";
		const queryAnalysis = analyzeQuery(queryText, ["\u8d62\u5b8b", "\u7a84\u4f53"]);
		const result = buildV3DirectSubitems({
			snapshotText: "\u8fd9\u662f\u4e00\u6b3e\u8d62\u5b8b\u98ce\u683c\u7684\u7a84\u4f53\u5b57\u3002",
			queryAnalysis,
			candidate: createCandidate({
				path: "winsong-condensed.md",
				realizedFamilies: [
					createRealizedFamily({
						queryUnitIndex: 0,
						queryUnitText: "\u8d62\u5b8b",
						familyId: 0,
						familyText: "\u8d62\u5b8b",
						querySurfaceGroupIndex: 0,
					}),
				],
				hanStrongRescueGroupCount: 0,
				hanWeakRescueGroupCount: 1,
				hanRescueSupportWeightTotal: 0.5,
				hasOnlyWeakHanRescue: false,
				hasAnyHanRescueAssessment: true,
				hanRescueAssessments: [
					{
						surfaceGroupIndex: 0,
						context: "body",
						rescueMode: "residual_only",
						strength: "weak",
						matchedBigramCount: 1,
						matchedRealAnchorCount: 1,
						coversStartAnchor: false,
						coversEndAnchor: true,
						coversEndpoints: false,
						preservesSurfaceOrder: true,
						rankingScore: 0.5,
						approxMaxAdjacentGap: 2,
						approxHeadTailSpan: 4,
						blockIds: [0],
						witnessKind: "body",
					},
				],
			}),
			candidateRecall: createCandidateRecall({ shortlistedBodyBlockIds: [0] }),
			residentBase: createResidentBaseForBlockCounts([1]),
		});

		const snippetText = result.subItems[0]?.snippetText ?? "";
		const strongHighlights = result.subItems[0]?.highlightRanges?.map((range) =>
			snippetText.slice(range.start, range.end),
		);
		expect(strongHighlights).toContain("\u8d62\u5b8b");
		expect(strongHighlights).toContain("\u7a84\u4f53");
		expect(result.subItems[0]?.weakHighlightRanges ?? []).toHaveLength(0);
	});
});
