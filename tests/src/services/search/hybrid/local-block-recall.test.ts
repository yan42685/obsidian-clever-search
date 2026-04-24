const mockReadIndexedTextSnapshots = jest.fn();

jest.mock("src/services/search/shared/file-snapshot-store", () => ({
	FileSnapshotStore: class FileSnapshotStore {},
}));

jest.mock("src/utils/my-lib", () => ({
	getInstance: jest.fn(() => ({
		readIndexedTextSnapshots: mockReadIndexedTextSnapshots,
	})),
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
	beforeEach(() => {
		mockReadIndexedTextSnapshots.mockReset();
	});

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

	test("delegates non-empty snapshots to the V3 bridge", () => {
		const {
			buildHybridLexicalLaneBlockCandidatesForSnapshot,
		} = require("src/services/search/hybrid/lexical-lane/local-block-recall") as typeof import("src/services/search/hybrid/lexical-lane/local-block-recall");

		const candidates = buildHybridLexicalLaneBlockCandidatesForSnapshot({
			queryText: "cache outage",
			file: createFileCandidate(),
			snapshotText: "sdk cache restore checklist after outage",
			maxBlocksPerFile: 3,
		});

		expect(candidates).toHaveLength(1);
		expect(candidates[0].filePath).toBe(createFileCandidate().filePath);
		expect(candidates[0].localSignals.coverageCount).toBe(2);
		expect(candidates[0].text).toContain("cache restore checklist");
	});

	test("reads generation-aligned shadow snapshots and propagates source", async () => {
		const {
			buildHybridLexicalLaneLocalBlockCandidates,
		} = require("src/services/search/hybrid/lexical-lane/local-block-recall") as typeof import("src/services/search/hybrid/lexical-lane/local-block-recall");
		const file = createFileCandidate({ snapshotGeneration: 42 });
		mockReadIndexedTextSnapshots.mockResolvedValue(
			new Map([
				[
					file.filePath,
					{
						path: file.filePath,
						text: "shadow cache restore evidence",
						generation: 42,
						source: "shadow",
					},
				],
			]),
		);

		const { blockCandidates, snapshotTextByPath } =
			await buildHybridLexicalLaneLocalBlockCandidates({
				queryText: "cache restore",
				files: [file],
				maxBlocksPerFile: 2,
			});

		expect(mockReadIndexedTextSnapshots).toHaveBeenCalledWith([
			{ path: file.filePath, generation: 42 },
		]);
		expect(snapshotTextByPath.get(file.filePath)).toBe(
			"shadow cache restore evidence",
		);
		expect(blockCandidates).toHaveLength(1);
		expect(blockCandidates[0].snapshotGeneration).toBe(42);
		expect(blockCandidates[0].snapshotSource).toBe("shadow");
	});

	test("propagates persisted indexed snapshot source", async () => {
		const {
			buildHybridLexicalLaneLocalBlockCandidates,
		} = require("src/services/search/hybrid/lexical-lane/local-block-recall") as typeof import("src/services/search/hybrid/lexical-lane/local-block-recall");
		const file = createFileCandidate({ snapshotGeneration: 7 });
		mockReadIndexedTextSnapshots.mockResolvedValue(
			new Map([
				[
					file.filePath,
					{
						path: file.filePath,
						text: "indexed cache restore evidence",
						generation: 7,
						source: "indexed",
					},
				],
			]),
		);

		const { blockCandidates } =
			await buildHybridLexicalLaneLocalBlockCandidates({
				queryText: "cache restore",
				files: [file],
				maxBlocksPerFile: 2,
			});

		expect(blockCandidates).toHaveLength(1);
		expect(blockCandidates[0].snapshotGeneration).toBe(7);
		expect(blockCandidates[0].snapshotSource).toBe("indexed");
	});
});

