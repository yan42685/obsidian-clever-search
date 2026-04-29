import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentHotBaseArtifacts } from "src/services/search/coverage-lexical-v3/build";
import { CoverageLexicalV3Engine } from "src/services/search/coverage-lexical-v3/engine";
import {
	analyzeQuery,
	type V3DocumentTokenizer,
} from "src/services/search/coverage-lexical-v3/query";
import {
	getFamilyText,
} from "src/services/search/coverage-lexical-v3/recall";
import {
	collectHanBigramVisibilityEvidence,
	materializeOpaqueBodyRescues,
} from "src/services/search/coverage-lexical-v3/ranking/containers";

function createDocument(
	overrides: Partial<IndexedDocument> &
		Pick<IndexedDocument, "path" | "basename" | "folder">,
): IndexedDocument {
	return {
		path: overrides.path,
		basename: overrides.basename,
		folder: overrides.folder,
		content: overrides.content,
		aliases: overrides.aliases,
		tags: overrides.tags,
		headings: overrides.headings,
			generation: overrides.generation ?? 1,
		size: overrides.size,
	};
}

function createDocumentTokenizer(
	termMap: Readonly<Record<string, readonly string[]>>,
): V3DocumentTokenizer {
	return (text) => termMap[text] ?? [];
}

describe("coverage lexical v3 witness split", () => {
	test("tokenizer-backed Han completion stays out of the main family lexicon", () => {
		const tokenizer = createDocumentTokenizer({
			"生命力": ["生命"],
			"这里记录生命力训练": ["这里", "记录", "生命", "训练"],
		});
		const document = createDocument({
			path: "zh/life-force.md",
			basename: "普通笔记",
			folder: "zh",
			content: "这里记录生命力训练",
		});
		const artifacts = buildResidentHotBaseArtifacts([document], tokenizer);
		const residentBase = artifacts.base;
		const familyTexts = Array.from(
			{ length: residentBase.familyLexicon.familyCount },
			(_, familyId) => getFamilyText(residentBase, familyId),
		);
		const engine = new CoverageLexicalV3Engine();

		expect(familyTexts).not.toContain("生命力");
		expect(artifacts.hanBodyEvidenceRows).toHaveLength(0);
		expect(residentBase.hanRoute.bodyWitnessOccurrenceTextIds).toHaveLength(0);

		engine.buildResidentIndexView([document], tokenizer);
		const result = engine.search("生命力", ["生命"]);

		expect(result.rankedCandidates).toHaveLength(1);
		expect(result.rankedCandidates[0].path).toBe("zh/life-force.md");
		expect(result.rankedCandidates[0].completedHanSurfaceGroupCount).toBe(1);
		expect(result.rankedCandidates[0].strongestHanSurfaceCompletionTier).toBe(
			"body_window",
		);
	});

	test("explicit body opaque rescue gate suppresses unadmitted Han body rescues", () => {
		const queryAnalysis = analyzeQuery("赢宋", ["赢宋"]);
		const bodyEvaluation = {
			surfaceGroupIndex: 0,
			bodyWindow: {
				blockIds: [0],
				boundaryCrossingCount: 0,
				coveredUnitIndices: [0],
				coveredDistinctUnitCount: 1,
				approxWindowStart: 0,
				approxWindowEnd: 2,
				approxHeadTailSpan: 2,
				approxMaxAdjacentGap: 0,
				approxTotalGapMass: 0,
				preservesQueryOrder: true,
				representatives: [],
			},
			assessment: {
				surfaceGroupIndex: 0,
				context: "body",
				rescueMode: "whole_group_when_real_miss",
				strength: "strong",
				matchedBigramCount: 1,
				matchedRealAnchorCount: 0,
				coversStartAnchor: true,
				coversEndAnchor: true,
				coversEndpoints: true,
				preservesSurfaceOrder: true,
				rankingScore: 1,
				approxMaxAdjacentGap: 0,
				approxHeadTailSpan: 2,
				blockIds: [0],
				witnessKind: "body",
			},
			unresolvedBigrams: ["赢宋"],
			matchedBigrams: ["赢宋"],
			matchedOccurrencesByBlockId: new Map(),
		};
		const bodyEvaluationBySurfaceGroupIndex = new Map([[0, bodyEvaluation]]) as never;

		expect(
			materializeOpaqueBodyRescues({
				queryAnalysis,
				bodyEvaluationBySurfaceGroupIndex,
				allowSurfaceGroupIndices: null,
			}),
		).toEqual([]);
		expect(
			materializeOpaqueBodyRescues({
				queryAnalysis,
				bodyEvaluationBySurfaceGroupIndex,
				allowSurfaceGroupIndices: new Set(),
			}),
		).toEqual([]);
		expect(
			materializeOpaqueBodyRescues({
				queryAnalysis,
				bodyEvaluationBySurfaceGroupIndex,
				allowSurfaceGroupIndices: new Set([1]),
			}),
		).toEqual([]);
		expect(
			materializeOpaqueBodyRescues({
				queryAnalysis,
				bodyEvaluationBySurfaceGroupIndex,
				allowSurfaceGroupIndices: new Set([0]),
			}),
		).toEqual([
			expect.objectContaining({
				surfaceGroupIndex: 0,
				queryUnitText: "赢宋",
				familyText: "赢宋",
			}),
		]);
	});

	test("body opaque rescue gate also suppresses unadmitted Han visibility evidence", () => {
		const createBodyEvaluation = (
			surfaceGroupIndex: number,
			matchedBigram: string,
		) =>
			({
				surfaceGroupIndex,
				bodyWindow: {
					blockIds: [surfaceGroupIndex],
					boundaryCrossingCount: 0,
					coveredUnitIndices: [surfaceGroupIndex],
					coveredDistinctUnitCount: 1,
					approxWindowStart: 0,
					approxWindowEnd: 2,
					approxHeadTailSpan: 2,
					approxMaxAdjacentGap: 0,
					approxTotalGapMass: 0,
					preservesQueryOrder: true,
					representatives: [],
				},
				assessment: {
					surfaceGroupIndex,
					context: "body",
					rescueMode: "whole_group_when_real_miss",
					strength: "strong",
					matchedBigramCount: 1,
					matchedRealAnchorCount: 0,
					coversStartAnchor: true,
					coversEndAnchor: true,
					coversEndpoints: true,
					preservesSurfaceOrder: true,
					rankingScore: 1,
					approxMaxAdjacentGap: 0,
					approxHeadTailSpan: 2,
					blockIds: [surfaceGroupIndex],
					witnessKind: "body",
				},
				unresolvedBigrams: [matchedBigram],
				matchedBigrams: [matchedBigram],
				matchedOccurrencesByBlockId: new Map(),
			}) as never;
		const bodyEvaluationBySurfaceGroupIndex = new Map([
			[0, createBodyEvaluation(0, "赢宋")],
			[1, createBodyEvaluation(1, "星河")],
		]);
		const metadataWitnessBySurfaceGroupIndex = new Map() as never;

		expect(
			collectHanBigramVisibilityEvidence({
				metadataWitnessBySurfaceGroupIndex,
				bodyEvaluationBySurfaceGroupIndex,
				allowBodySurfaceGroupIndices: null,
			}),
		).toEqual([]);
		expect(
			collectHanBigramVisibilityEvidence({
				metadataWitnessBySurfaceGroupIndex,
				bodyEvaluationBySurfaceGroupIndex,
				allowBodySurfaceGroupIndices: new Set([1]),
			}),
		).toEqual([{ surfaceGroupIndex: 1, matchedBigrams: ["星河"] }]);
		expect(
			collectHanBigramVisibilityEvidence({
				metadataWitnessBySurfaceGroupIndex,
				bodyEvaluationBySurfaceGroupIndex,
			}),
		).toEqual([
			{ surfaceGroupIndex: 0, matchedBigrams: ["赢宋"] },
			{ surfaceGroupIndex: 1, matchedBigrams: ["星河"] },
		]);
	});
});
