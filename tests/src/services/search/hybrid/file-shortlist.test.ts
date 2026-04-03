jest.mock("obsidian", () => ({
	App: class App {},
	parseFrontMatterAliases: () => [],
}));

jest.mock("src/globals/plugin-setting", () => ({
	OuterSetting: class OuterSetting {},
}));

jest.mock("src/utils/logger", () => ({
	logger: {
		warn: jest.fn(),
	},
}));

jest.mock("src/utils/my-lib", () => ({
	getInstance: jest.fn(() => {
		throw new Error("getInstance should not be called in file-shortlist unit tests");
	}),
}));

jest.mock("src/services/search/file-search-engine", () => ({
	FileSearchEngineFactory: class FileSearchEngineFactory {},
}));

jest.mock("src/services/obsidian/user-data/data-provider", () => ({
	DataProvider: class DataProvider {},
}));

describe("hybrid lexical lane file shortlist", () => {
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

	test("boosts partial-memory matches when aliases and basename cover more query tokens", () => {
		const {
			buildHybridLexicalLaneFileCandidates,
		} = require("src/services/search/hybrid/lexical-lane/file-shortlist") as typeof import("src/services/search/hybrid/lexical-lane/file-shortlist");

		const candidates = buildHybridLexicalLaneFileCandidates({
			queryText: "cache restore after outage replay steps",
			limit: 2,
			matches: [
				{
					path: "pkm-en/ops/cache-replay-runbook.md",
					score: 120,
					rank: 0,
				},
				{
					path: "pkm-en/projects/sdk/cache-restore-checklist.md",
					score: 104,
					rank: 1,
				},
			],
			resolveMetadata: (path) => {
				if (path.endsWith("cache-restore-checklist.md")) {
					return {
						aliases: ["cache restore after outage"],
						headings: ["Recovery checklist"],
					};
				}
				return {
					aliases: ["checkpoint replay verification"],
					headings: ["Replay verification"],
				};
			},
		});

		expect(candidates[0]?.filePath).toBe(
			"pkm-en/projects/sdk/cache-restore-checklist.md",
		);
		expect(candidates[0]?.metadataSignals.aliasTokenCoverageCount).toBeGreaterThan(
			candidates[1]?.metadataSignals.aliasTokenCoverageCount ?? 0,
		);
	});

	test("preserves hyphenated path anchors to separate mixed-script twins", () => {
		const {
			buildHybridLexicalLaneFileCandidates,
		} = require("src/services/search/hybrid/lexical-lane/file-shortlist") as typeof import("src/services/search/hybrid/lexical-lane/file-shortlist");

		const candidates = buildHybridLexicalLaneFileCandidates({
			queryText: "tech-zh service account token note",
			limit: 2,
			matches: [
				{
					path: "tech-en/content/en/docs/tasks/configure-pod-container/configure-service-account.md",
					score: 100,
					rank: 0,
				},
				{
					path: "tech-zh/content/zh-cn/docs/tasks/configure-pod-container/configure-service-account.md",
					score: 96,
					rank: 1,
				},
			],
			resolveMetadata: () => ({
				aliases: [],
				headings: ["Service account token"],
			}),
		});

		expect(candidates[0]?.filePath).toBe(
			"tech-zh/content/zh-cn/docs/tasks/configure-pod-container/configure-service-account.md",
		);
		expect(candidates[0]?.metadataSignals.pathRootAnchorCoverageCount).toBeGreaterThan(
			candidates[1]?.metadataSignals.pathRootAnchorCoverageCount ?? 0,
		);
		expect(candidates[0]?.metadataSignals.pathAnchorCoverageCount).toBeGreaterThan(
			candidates[1]?.metadataSignals.pathAnchorCoverageCount ?? 0,
		);
	});
});
