import {
	rankHybridLexicalLaneBlockCandidates,
} from "src/services/search/hybrid/lexical-lane/block-ranker";
import type { HybridLexicalLaneBlockCandidate } from "src/services/search/hybrid/lexical-lane/contracts";

function createBlockCandidate(
	overrides: Partial<HybridLexicalLaneBlockCandidate> = {},
): HybridLexicalLaneBlockCandidate {
	return {
		filePath: "tech-en/content/en/docs/concepts/services-networking/ingress.md",
		blockId: "candidate-1",
		startOffset: 0,
		endOffset: 64,
		startLine: 0,
		startCol: 0,
		endLine: 0,
		endCol: 64,
		text: "ingress service routing sends traffic to services through cluster rules",
		headingChain: ["Ingress"],
		parentFileScore: 100,
		parentFileRank: 0,
		parentMetadataSignals: {
			basenameExact: false,
			basenamePrefix: false,
			basenameContainedInQuery: false,
			basenameTokenCoverageCount: 0,
			pathExact: false,
			pathPrefix: false,
			pathTokenCoverageCount: 0,
			pathAnchorCoverageCount: 0,
			pathRootAnchorCoverageCount: 0,
			pathRootAnchorExact: false,
			folderHintCount: 0,
			templateFolderHit: false,
			archivePenaltyEligible: false,
			headingMetaHit: false,
			headingExactCount: 0,
			headingPrefixCount: 0,
			headingContainedInQueryCount: 0,
			headingTokenCoverageCount: 0,
			aliasHit: false,
			aliasExactCount: 0,
			aliasPrefixCount: 0,
			aliasContainedInQueryCount: 0,
			aliasTokenCoverageCount: 0,
		},
		localScore: 160,
		localSignals: {
			coverageCount: 3,
			exactCount: 3,
			prefixCount: 0,
			fuzzyCount: 0,
			queryTermCount: 4,
			missCount: 1,
			occurrenceCount: 3,
			occurrenceSpread: 32,
			distancePenaltyTotal: 0,
			distancePenaltyMax: 0,
			spanLength: 64,
			anchorOffset: 12,
		},
		termStats: [
			{ termId: "q1", bestTier: "exact", bestDistancePenalty: 0 },
			{ termId: "q2", bestTier: "exact", bestDistancePenalty: 0 },
			{ termId: "q3", bestTier: "exact", bestDistancePenalty: 0 },
			{ termId: "q4", bestTier: "miss", bestDistancePenalty: 0 },
		],
		matchOccurrences: [
			{ termId: "q1", tier: "exact", start: 0, end: 7, distancePenalty: 0 },
			{ termId: "q2", tier: "exact", start: 8, end: 15, distancePenalty: 0 },
			{ termId: "q3", tier: "exact", start: 16, end: 23, distancePenalty: 0 },
		],
		...overrides,
	};
}

describe("hybrid lexical lane block ranker", () => {
	test("does not apply same-file overlap penalties across snapshot generations", () => {
		const first = createBlockCandidate({
			snapshotGeneration: 1,
			snapshotSource: "indexed",
			blockId: "generation-1",
		});
		const second = createBlockCandidate({
			snapshotGeneration: 2,
			snapshotSource: "indexed",
			blockId: "generation-2",
		});
		const sameGenerationSecond = createBlockCandidate({
			snapshotGeneration: 1,
			snapshotSource: "indexed",
			blockId: "same-generation-2",
		});

		const crossGeneration = rankHybridLexicalLaneBlockCandidates([
			first,
			second,
		]);
		const sameGeneration = rankHybridLexicalLaneBlockCandidates([
			first,
			sameGenerationSecond,
		]);

		expect(
			crossGeneration.find((candidate) => candidate.blockId === "generation-2")
				?.scoreBreakdown.overlapPenalty,
		).toBe(0);
		expect(
			sameGeneration.find((candidate) => candidate.blockId === "same-generation-2")
				?.scoreBreakdown.overlapPenalty,
		).toBeGreaterThan(0);
	});

	test("keeps explicit path-root anchors ahead of same-content mixed-script twins", () => {
		const englishCandidate = createBlockCandidate();
		const zhCandidate = createBlockCandidate({
			filePath: "tech-zh/content/zh-cn/docs/concepts/services-networking/ingress.md",
			blockId: "candidate-zh",
			parentFileScore: 96,
			parentFileRank: 1,
			parentMetadataSignals: {
				...englishCandidate.parentMetadataSignals,
				pathAnchorCoverageCount: 1,
				pathRootAnchorCoverageCount: 1,
				pathRootAnchorExact: true,
				headingTokenCoverageCount: 1,
			},
		});

		const ranked = rankHybridLexicalLaneBlockCandidates([
			englishCandidate,
			zhCandidate,
		]);

		expect(ranked[0]?.filePath).toBe(
			"tech-zh/content/zh-cn/docs/concepts/services-networking/ingress.md",
		);
		expect(ranked[0]?.scoreBreakdown.filePriorScore).toBeGreaterThan(
			ranked[1]?.scoreBreakdown.filePriorScore ?? 0,
		);
	});

	test("promotes blocks that add exact evidence missing from higher-ranked title-heavy siblings", () => {
		const titleLead = createBlockCandidate({
			filePath: "all_notes/test/unsorted/电子技术入门.md",
			blockId: "title-lead",
			parentFileRank: 0,
			parentFileScore: 180,
			headingChain: ["电子技术入门"],
			localScore: 320,
			localSignals: {
				coverageCount: 6,
				exactCount: 6,
				prefixCount: 0,
				fuzzyCount: 0,
				queryTermCount: 7,
				missCount: 1,
				occurrenceCount: 6,
				occurrenceSpread: 18,
				distancePenaltyTotal: 0,
				distancePenaltyMax: 0,
				spanLength: 52,
				anchorOffset: 0,
			},
			termStats: [
				{ termId: "q-电", bestTier: "exact", bestDistancePenalty: 0 },
				{ termId: "q-子", bestTier: "exact", bestDistancePenalty: 0 },
				{ termId: "q-技", bestTier: "exact", bestDistancePenalty: 0 },
				{ termId: "q-术", bestTier: "exact", bestDistancePenalty: 0 },
				{ termId: "q-入", bestTier: "exact", bestDistancePenalty: 0 },
				{ termId: "q-门", bestTier: "exact", bestDistancePenalty: 0 },
				{ termId: "q-ram", bestTier: "miss", bestDistancePenalty: 0 },
			],
			matchOccurrences: [
				{ termId: "q-电", tier: "exact", start: 0, end: 1, distancePenalty: 0 },
				{ termId: "q-子", tier: "exact", start: 1, end: 2, distancePenalty: 0 },
				{ termId: "q-技", tier: "exact", start: 2, end: 3, distancePenalty: 0 },
				{ termId: "q-术", tier: "exact", start: 3, end: 4, distancePenalty: 0 },
				{ termId: "q-入", tier: "exact", start: 4, end: 5, distancePenalty: 0 },
				{ termId: "q-门", tier: "exact", start: 5, end: 6, distancePenalty: 0 },
			],
		});
		const titleSibling = createBlockCandidate({
			...titleLead,
			blockId: "title-sibling",
			startOffset: 140,
			endOffset: 212,
			localScore: 284,
			localSignals: {
				...titleLead.localSignals,
				anchorOffset: 152,
				spanLength: 72,
			},
			matchOccurrences: [
				{ termId: "q-电", tier: "exact", start: 148, end: 149, distancePenalty: 0 },
				{ termId: "q-子", tier: "exact", start: 149, end: 150, distancePenalty: 0 },
				{ termId: "q-技", tier: "exact", start: 150, end: 151, distancePenalty: 0 },
				{ termId: "q-术", tier: "exact", start: 151, end: 152, distancePenalty: 0 },
				{ termId: "q-入", tier: "exact", start: 152, end: 153, distancePenalty: 0 },
				{ termId: "q-门", tier: "exact", start: 153, end: 154, distancePenalty: 0 },
			],
		});
		const ramBody = createBlockCandidate({
			filePath: titleLead.filePath,
			blockId: "ram-body",
			parentFileRank: 0,
			parentFileScore: 180,
			headingChain: ["电子技术入门", "触发器"],
			startOffset: 280,
			endOffset: 360,
			localScore: 92,
			localSignals: {
				coverageCount: 1,
				exactCount: 1,
				prefixCount: 0,
				fuzzyCount: 0,
				queryTermCount: 7,
				missCount: 6,
				occurrenceCount: 1,
				occurrenceSpread: 0,
				distancePenaltyTotal: 0,
				distancePenaltyMax: 0,
				spanLength: 80,
				anchorOffset: 312,
			},
			termStats: [
				{ termId: "q-电", bestTier: "miss", bestDistancePenalty: 0 },
				{ termId: "q-子", bestTier: "miss", bestDistancePenalty: 0 },
				{ termId: "q-技", bestTier: "miss", bestDistancePenalty: 0 },
				{ termId: "q-术", bestTier: "miss", bestDistancePenalty: 0 },
				{ termId: "q-入", bestTier: "miss", bestDistancePenalty: 0 },
				{ termId: "q-门", bestTier: "miss", bestDistancePenalty: 0 },
				{ termId: "q-ram", bestTier: "exact", bestDistancePenalty: 0 },
			],
			matchOccurrences: [
				{ termId: "q-ram", tier: "exact", start: 312, end: 315, distancePenalty: 0 },
			],
		});

		const ranked = rankHybridLexicalLaneBlockCandidates([
			titleLead,
			titleSibling,
			ramBody,
		]);

		expect(ranked[0]?.blockId).toBe("title-lead");
		expect(ranked[1]?.blockId).toBe("ram-body");
		expect(ranked[1]?.scoreBreakdown.totalScore).toBeGreaterThan(
			ranked[2]?.scoreBreakdown.totalScore ?? 0,
		);
	});
});
