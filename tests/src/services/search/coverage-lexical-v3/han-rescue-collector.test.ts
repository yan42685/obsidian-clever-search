import { collectHanRescueArtifacts } from "src/services/search/coverage-lexical-v3/han-rescue-collector";
import { createMinimalResidentBaseForBlockCounts } from "./test-fixtures";
import type { V3CandidateDocRecall } from "src/services/search/coverage-lexical-v3/recall";
import type { V3QueryAnalysis } from "src/services/search/coverage-lexical-v3/query";

describe("coverage lexical v3 Han rescue collector", () => {
	test("uses candidate liveDocSlot when collecting same-doc body rescue blocks", () => {
		const fullSurface = "\u7f13\u5b58\u6062\u590d\u6b65\u9aa4";
		const base = createMinimalResidentBaseForBlockCounts([1, 1]);
		const candidateRecall: V3CandidateDocRecall = {
			shardId: "sealed-0",
			shardGeneration: 1,
			docId: 0,
			liveDocSlot: 1,
			matchedIdentityUnitIndices: [],
			matchedRouteUnitIndices: [],
			matchedHeadingUnitIndices: [],
			hasQuerySingletonHanMetadataSupport: false,
			hasScopedSingletonHanMetadataSupport: false,
			shortlistedBodyBlocks: [],
			shortlistedBodyBlockIds: [],
			hanMetadataGateStats: null,
			hanBodyBlockGateStats: [],
			hanSurfaceGroupRecalls: [
				{
					surfaceGroupIndex: 0,
					metadataGateStats: null,
					bodySeedBlockIds: [1],
					bodySeedBlockGates: [],
				},
			],
		};
		const queryAnalysis: V3QueryAnalysis = {
			queryText: fullSurface,
			normalizedQueryText: fullSurface,
			querySingletonHanChar: null,
			querySingletonHanCodePoint: null,
			querySingletonHanRecallEligible: false,
			surfaceGroups: [
				{
					index: 0,
					text: fullSurface,
					kind: "han",
					hanBigramTexts: ["\u7f13\u5b58"],
					coveredCharMask: [],
					queryResidualUniqueBigrams: ["\u7f13\u5b58"],
					hasQueryResidualHanCoverage: true,
				},
			],
			primaryUnits: [],
			hanBackstopGroups: [],
			surfaceCoverageShapeKey: "h",
		};
		const artifacts = collectHanRescueArtifacts({
			base,
			queryAnalysis,
			candidateRecall,
			docEvidence: {
				identityWitnessTexts: [],
				identityWitnessSourceMasks: [],
				routeWitnessTexts: [],
				routeWitnessSourceMasks: [],
				headingWitnessTexts: [],
			},
			bodyBlockEvidenceByBlockId: new Map([
				[
					1,
					{
						witnessOccurrences: [
							{
								ordinalPosition: 0,
								localPosition: 0,
								localEndPosition: fullSurface.length,
							},
						],
						witnessTexts: [fullSurface],
					},
				],
			]),
			resolvedHanSurfaceGroups: [
				{
					surfaceGroupIndex: 0,
					surfaceText: fullSurface,
					realUnitIndices: [],
					matchedRealUnitIndices: [],
					matchedCharMask: [],
					rescueMode: "whole_group_when_real_miss",
					rescueBigrams: ["\u7f13\u5b58"],
				},
			],
			bodyApproxSpanByBlockId: new Map([[1, 1]]),
			bodyOrdinalSpanByBlockId: new Map([[1, 1]]),
			excludedSurfaceGroupIndices: null,
			chooseBestBodyWindow: ({ syntheticOccurrencesByBlockId }) => {
				const blockIds = [...syntheticOccurrencesByBlockId.keys()];
				const coveredUnitIndices = [
					...new Set(
						[...syntheticOccurrencesByBlockId.values()].flatMap((occurrences) =>
							occurrences.map((occurrence) => occurrence.unitIndex),
						),
					),
				];
				return {
					blockIds,
					coveredUnitIndices,
					preservesQueryOrder: true,
					approxMaxAdjacentGap: 0,
					approxHeadTailSpan: 1,
				};
			},
		});

		expect(artifacts.bodyEvaluationBySurfaceGroupIndex.get(0)?.assessment.blockIds).toEqual([1]);
		expect(artifacts.summary.hasAnyAssessment).toBe(true);
	});
});
