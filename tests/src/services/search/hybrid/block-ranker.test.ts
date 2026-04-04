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
});
