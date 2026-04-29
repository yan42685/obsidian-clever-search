import type { HybridLexicalLaneBlockCandidate } from "src/services/search/hybrid/lexical-lane/contracts";
import { buildHybridLexicalLaneDisplayCandidates } from "src/services/search/hybrid/lexical-lane/display-window";
import { buildIndexedSnapshotRequestKey } from "src/services/search/shared/file-snapshot-store";

function createCandidate(
	overrides: Partial<HybridLexicalLaneBlockCandidate> = {},
): HybridLexicalLaneBlockCandidate {
	return {
		filePath: "notes/same-path.md",
		snapshotGeneration: 1,
		snapshotSource: "indexed",
		blockId: "notes/same-path.md#0-10",
		startOffset: 0,
		endOffset: 10,
		startLine: 0,
		startCol: 0,
		endLine: 0,
		endCol: 10,
		text: "first text",
		headingChain: [],
		parentFileScore: 1,
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
		localScore: 1,
		localSignals: {
			coverageCount: 1,
			exactCount: 1,
			prefixCount: 0,
			fuzzyCount: 0,
			queryTermCount: 1,
			missCount: 0,
			occurrenceCount: 1,
			occurrenceSpread: 0,
			distancePenaltyTotal: 0,
			distancePenaltyMax: 0,
			spanLength: 10,
			anchorOffset: 0,
		},
		termStats: [
			{
				termId: "text",
				bestTier: "exact",
				bestDistancePenalty: 0,
			},
		],
		matchOccurrences: [
			{
				termId: "text",
				tier: "exact",
				start: 6,
				end: 10,
				distancePenalty: 0,
			},
		],
		...overrides,
	};
}

describe("hybrid lexical lane display window", () => {
	test("renders same-path candidates against their own snapshot generations", () => {
		const snapshotTextByRequestKey = new Map<string, string>([
			[
				buildIndexedSnapshotRequestKey({
					path: "notes/same-path.md",
					generation: 1,
				}),
				"first text",
			],
			[
				buildIndexedSnapshotRequestKey({
					path: "notes/same-path.md",
					generation: 2,
				}),
				"second text",
			],
		]);

		const candidates = buildHybridLexicalLaneDisplayCandidates({
			candidates: [
				createCandidate({ snapshotGeneration: 1 }),
				createCandidate({
					snapshotGeneration: 2,
					blockId: "notes/same-path.md#0-11",
					endOffset: 11,
					endCol: 11,
					text: "second text",
					matchOccurrences: [
						{
							termId: "text",
							tier: "exact",
							start: 7,
							end: 11,
							distancePenalty: 0,
						},
					],
				}),
			],
			snapshotTextByRequestKey,
		});

		expect(candidates.map((candidate) => candidate.bodyText)).toEqual([
			"first text",
			"second text",
		]);
	});
});
