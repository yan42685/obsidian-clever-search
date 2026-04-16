jest.mock("src/services/obsidian/user-data/data-provider", () => ({
	DataProvider: class DataProvider {},
}));

jest.mock("src/utils/my-lib", () => ({
	getInstance: jest.fn(() => {
		throw new Error("getInstance should not be called in local-block-recall unit tests");
	}),
}));

import {
	V3_HYBRID_LEXICAL_SUBITEMS_NOT_IMPLEMENTED_ERROR,
} from "src/services/search/coverage-lexical-v3/hybrid-lexical-subitems";
import type { HybridLexicalLaneFileCandidate } from "src/services/search/hybrid/lexical-lane/contracts";

function createFileCandidate(
	overrides: Partial<HybridLexicalLaneFileCandidate> = {},
): HybridLexicalLaneFileCandidate {
	return {
		filePath: "pkm-en/projects/sdk/cache-restore-checklist.md",
		fileScore: 100,
		fileRank: 0,
		basename: "cache-restore-checklist",
		metadataSignals: {
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
			aliasHit: true,
			aliasExactCount: 0,
			aliasPrefixCount: 0,
			aliasContainedInQueryCount: 0,
			aliasTokenCoverageCount: 0,
		},
		metadataValues: {
			aliases: ["cache restore after outage"],
			headings: ["Recovery checklist"],
		},
		...overrides,
	};
}

describe("hybrid lexical lane local block recall", () => {
	test("returns no candidates for blank snapshots before touching the V3 bridge", () => {
		const {
			buildHybridLexicalLaneBlockCandidatesForSnapshot,
		} = require("src/services/search/hybrid/lexical-lane/local-block-recall") as typeof import("src/services/search/hybrid/lexical-lane/local-block-recall");

		expect(
			buildHybridLexicalLaneBlockCandidatesForSnapshot({
				queryText: "restore cache",
				file: createFileCandidate(),
				snapshotText: "   ",
				maxBlocksPerFile: 3,
			}),
		).toEqual([]);
	});

	test("delegates non-empty snapshots to the V3 placeholder bridge", () => {
		const {
			buildHybridLexicalLaneBlockCandidatesForSnapshot,
		} = require("src/services/search/hybrid/lexical-lane/local-block-recall") as typeof import("src/services/search/hybrid/lexical-lane/local-block-recall");

		expect(() =>
			buildHybridLexicalLaneBlockCandidatesForSnapshot({
				queryText: "restoring cache after outage",
				file: createFileCandidate(),
				snapshotText: "sdk cache restore checklist after outage",
				maxBlocksPerFile: 3,
			}),
		).toThrow(V3_HYBRID_LEXICAL_SUBITEMS_NOT_IMPLEMENTED_ERROR);
	});
});

