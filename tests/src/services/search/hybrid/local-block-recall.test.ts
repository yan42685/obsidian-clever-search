jest.mock("src/services/obsidian/user-data/data-provider", () => ({
	DataProvider: class DataProvider {},
}));

jest.mock("src/utils/my-lib", () => ({
	getInstance: jest.fn(() => {
		throw new Error("getInstance should not be called in local-block-recall unit tests");
	}),
}));

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
	beforeEach(() => {
		(global as typeof globalThis & {
			window?: { localStorage: { getItem: jest.Mock } };
		}).window = {
			localStorage: {
				getItem: jest.fn(() => "en"),
			},
		};
	});

	afterEach(() => {
		delete (global as typeof globalThis & { window?: unknown }).window;
		jest.resetModules();
	});

	test("file recall bridge catches lightweight english morphology like restoring -> restore", () => {
		const {
			buildHybridLexicalLaneBlockCandidatesForSnapshot,
		} = require("src/services/search/hybrid/lexical-lane/local-block-recall") as typeof import("src/services/search/hybrid/lexical-lane/local-block-recall");

		const snapshotText =
			"sdk cache restore checklist after outage covers checkpoint replay, shard verification, and warmup";
		const candidates = buildHybridLexicalLaneBlockCandidatesForSnapshot({
			queryText: "note about restoring cache after warmup failed",
			file: createFileCandidate(),
			snapshotText,
			maxBlocksPerFile: 3,
		});

		const bridgeCandidate = candidates.find((candidate) =>
			candidate.blockId.includes("#file-recall-bridge-"),
		);

		expect(bridgeCandidate).toBeDefined();
		expect(bridgeCandidate?.localSignals.coverageCount ?? 0).toBeGreaterThanOrEqual(4);
		expect(bridgeCandidate?.localSignals.prefixCount ?? 0).toBeGreaterThan(0);
		expect(bridgeCandidate?.localSignals.exactCount ?? 0).toBeLessThan(
			bridgeCandidate?.localSignals.coverageCount ?? 0,
		);
		expect(
			bridgeCandidate?.termStats.some(
				(termStat) =>
					termStat.termId.includes(":non_han_run:restoring") &&
					termStat.bestTier === "prefix",
			) ?? false,
		).toBe(true);
	});
});
