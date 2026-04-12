import { container } from "tsyringe";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

jest.mock("src/services/database/database", () => ({
	Database: class MockDatabaseToken {},
}));

jest.mock("src/services/search/shared/file-snapshot-store", () => ({
	FileSnapshotStore: class MockFileSnapshotStoreToken {},
}));

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

const { Database } = jest.requireMock("src/services/database/database") as {
	Database: new () => unknown;
};

const { FileSnapshotStore } = jest.requireMock(
	"src/services/search/shared/file-snapshot-store",
) as {
	FileSnapshotStore: new () => unknown;
};

type IndexedDocument = {
	path: string;
	basename: string;
	folder: string;
	content?: string;
	aliases?: string;
	tags?: string;
	headings?: string;
};

function normalize(text: string): string {
	return text.toLowerCase().normalize("NFKC");
}

function createSimpleCoverageTokenizer() {
	return {
		tokenize(text: string): string[] {
			return this.tokenizeSequence(text);
		},
		tokenizeSequence(text: string): string[] {
			return normalize(text).match(/[a-z0-9_-]+/gu) ?? [];
		},
		tokenizeSequenceWithOffsets(text: string): Array<{
			token: string;
			start: number;
			end: number;
		}> {
			return Array.from(normalize(text).matchAll(/[a-z0-9_-]+/gu)).map(
				(match) => ({
					token: match[0],
					start: match.index ?? 0,
					end: (match.index ?? 0) + match[0].length,
				}),
			);
		},
	};
}

function createWholeHanCoverageTokenizer() {
	return {
		tokenize(text: string): string[] {
			return this.tokenizeSequence(text);
		},
		tokenizeSequence(text: string): string[] {
			return normalize(text).match(/[\p{Script=Han}]+|[a-z0-9_-]+/gu) ?? [];
		},
		tokenizeSequenceWithOffsets(text: string): Array<{
			token: string;
			start: number;
			end: number;
		}> {
			return Array.from(normalize(text).matchAll(/[\p{Script=Han}]+|[a-z0-9_-]+/gu)).map(
				(match) => ({
					token: match[0],
					start: match.index ?? 0,
					end: (match.index ?? 0) + match[0].length,
				}),
			);
		},
	};
}

describe("coverage lexical v2 engine candidate-cascade path", () => {
	beforeEach(() => {
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};
		container.registerInstance(Tokenizer, createSimpleCoverageTokenizer());
	});

	afterEach(() => {
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

test("searchFiles routes through the independent V2 lexical engine", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string; matchedTerms: string[] }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/ai-design.md",
				basename: "ai",
				folder: "notes",
				content: "ai exam design",
			},
			{
				path: "notes/exam-summary.md",
				basename: "exam-summary",
				folder: "notes",
				content: "ai exam summary",
			},
			{
				path: "notes/study-plan.md",
				basename: "study-plan",
				folder: "notes",
				content: "exam plan",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "ai exam",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results[0]?.path).toBe("notes/ai-design.md");
		expect(results[0]?.matchedTerms).toEqual(["ai", "exam"]);
		expect(results.length).toBeGreaterThanOrEqual(1);
	});

	test("experimental v2 candidate-cascade path keeps latin exact above prefix above fuzzy on tied coverage", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string; matchedTerms: string[] }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/cache-reset.md",
				basename: "cache-reset",
				folder: "notes",
				content: "cache reset",
			},
			{
				path: "notes/cached-reset.md",
				basename: "cached-reset",
				folder: "notes",
				content: "cached reset",
			},
			{
				path: "notes/cace-reset.md",
				basename: "cace-reset",
				folder: "notes",
				content: "cace reset",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "cache reset",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results.slice(0, 3).map((result) => result.path)).toEqual([
			"notes/cache-reset.md",
			"notes/cached-reset.md",
			"notes/cace-reset.md",
		]);
	});

	test("searchFiles recovers metadata and body Han hits even when the tokenizer drops Han query terms", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string; matchedTerms: string[] }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/win-song-metadata.md",
				basename: "关于赢宋的笔记",
				folder: "notes",
				content: "latin filler",
			},
			{
				path: "notes/win-song-body.md",
				basename: "misc",
				folder: "notes",
				content: "这里提到了赢宋这两个字",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "赢宋",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results.map((result) => result.path)).toEqual([
			"notes/win-song-metadata.md",
			"notes/win-song-body.md",
		]);
	});

	test("searchFiles recovers fragile-covered Han body hits when tokenizer keeps the whole Han query opaque", async () => {
		container.registerInstance(Tokenizer, createWholeHanCoverageTokenizer());
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string; matchedTerms: string[] }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/chairperson.md",
				basename: "misc",
				folder: "notes",
				content: "委员长大之后继续发言",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "委员长",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results.map((result) => result.path)).toEqual([
			"notes/chairperson.md",
		]);
	});

	test("live index breakdown removes bodyChar postings while keeping bodyHanSegments resident", async () => {
		const { CoverageLexicalV2IndexStore } = require(
			"src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-index-store",
		) as {
			CoverageLexicalV2IndexStore: new () => {
				replaceDocument(document: Record<string, unknown>): number;
				buildIndexBreakdown(): Record<string, unknown>;
				compactOverlayIntoSegment(force?: boolean): boolean;
			};
		};

		const store = new CoverageLexicalV2IndexStore();
		store.replaceDocument({
			path: "notes/win-song-body.md",
			generation: 1,
			indexedRef: {
				path: "notes/win-song-body.md",
				generation: 1,
				size: 64,
			},
			record: {
				path: "notes/win-song-body.md",
				stableDeterministicKey: "notes/win-song-body.md",
				basenameText: "misc",
				aliasesText: "",
				headingsText: "",
				folderText: "notes",
				tagsText: "",
			},
			exactTermsByField: {
				basename: ["misc"],
				aliases: [],
				headings: [],
				folder: ["notes"],
				tag: [],
				body: [],
			},
			metadataHanBigramsByField: {
				basename: [],
				aliases: [],
				headings: [],
				folder: [],
				tag: [],
			},
			bodyHanSegments: ["\u8fd9\u91cc\u63d0\u5230\u4e86\u8d62\u5b8b\u8fd9\u4e24\u4e2a\u5b57"],
			bodyTokens: [],
		});
		store.replaceDocument({
			path: "notes/win-song-metadata.md",
			generation: 2,
			indexedRef: {
				path: "notes/win-song-metadata.md",
				generation: 2,
				size: 48,
			},
			record: {
				path: "notes/win-song-metadata.md",
				stableDeterministicKey: "notes/win-song-metadata.md",
				basenameText: "\u5173\u4e8e\u8d62\u5b8b\u7684\u7b14\u8bb0",
				aliasesText: "",
				headingsText: "",
				folderText: "notes",
				tagsText: "",
			},
			exactTermsByField: {
				basename: [],
				aliases: [],
				headings: [],
				folder: ["notes"],
				tag: [],
				body: ["latin", "filler"],
			},
			metadataHanBigramsByField: {
				basename: ["\u5173\u4e8e", "\u8d62\u5b8b"],
				aliases: [],
				headings: [],
				folder: [],
				tag: [],
			},
			bodyHanSegments: [],
			bodyTokens: ["latin", "filler"],
		});
		store.compactOverlayIntoSegment(true);

		const breakdown = store.buildIndexBreakdown();
		expect(breakdown).not.toBeNull();
		expect("bodyCharTermCount" in (breakdown ?? {})).toBe(false);
		expect(
			(breakdown as any).estimatedBytes.residentHot.postings.bodyChar,
		).toBeUndefined();
		expect(
			(breakdown as any).estimatedBytes.residentHot.verification.bodyHanSegments,
		).toBeGreaterThan(0);
	});

	test("releases hot body-token cache after cold-store writes while keeping body verification working", async () => {
		const {
			COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN,
		} = require(
			"src/services/search/coverage-lexical/coverage-lexical-body-token-cold-types",
		) as {
			COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN: string;
		};
		const storedDocuments = new Map<string, readonly string[]>();
		const readDocuments = jest.fn(async (paths: readonly string[]) => {
			const result = new Map<
				string,
				{ path: string; generation?: number; bodyTokens: readonly string[] }
			>();
			for (const path of paths) {
				const bodyTokens = storedDocuments.get(path);
				if (!bodyTokens) {
					continue;
				}
				result.set(path, {
					path,
					bodyTokens,
				});
			}
			return result;
		});
		container.registerInstance(COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN, {
			clearAll: jest.fn(async () => undefined),
			deleteDocuments: jest.fn(async (paths: readonly string[]) => {
				for (const path of paths) {
					storedDocuments.delete(path);
				}
			}),
			getMeta: jest.fn(async () => null),
			inspectConsistency: jest.fn(async () => ({
				needsRepair: false,
				requiresReset: false,
				reason: "up-to-date",
				missingOrStalePaths: [],
				danglingPaths: [],
			})),
			readDocuments,
			updateIndexedRefsMetadata: jest.fn(async () => undefined),
			upsertDocuments: jest.fn(async (documents: readonly any[]) => {
				for (const document of documents) {
					storedDocuments.set(document.path, document.bodyTokens);
				}
			}),
		} as any);
		container.registerInstance(Database, {
			appendCoverageLexicalV2IndexStoreJournalEntries: jest.fn(
				async () => undefined,
			),
		} as any);
		container.registerInstance(FileSnapshotStore, {
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
		} as any);

		const { CoverageLexicalV2FileSearchEngine } = require(
			"src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-file-search-engine",
		) as {
			CoverageLexicalV2FileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				getIndexBreakdown(): Record<string, unknown> | null;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string; matchedTerms: string[] }>>;
			};
		};

		const engine = new CoverageLexicalV2FileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/offloaded-body.md",
				basename: "offloaded-body",
				folder: "notes",
				content: "alpha beta gamma cluster",
			},
		]);

		const breakdown = engine.getIndexBreakdown();
		expect(
			(breakdown as any).estimatedBytes.residentHot.caches.bodyTokensHot,
		).toBe(0);
		expect(
			(breakdown as any).estimatedBytes.coldOwned.bodyTokensSidecar,
		).toBeGreaterThan(0);

		const results = await engine.searchFiles({
			queryText: "alpha beta gamma",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
		});

		expect(readDocuments).toHaveBeenCalled();
		expect(results[0]?.path).toBe("notes/offloaded-body.md");
	});

test("searchFiles keeps using the independent v2 candidate-cascade path without configuration switches", async () => {
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string; matchedTerms: string[] }>>;
			};
		};

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "notes/ai-design.md",
				basename: "ai-design",
				folder: "notes",
				content: "ai exam design",
			},
		]);

		const results = await engine.searchFiles({
			queryText: "ai exam",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results.map((result) => result.path)).toEqual([
			"notes/ai-design.md",
		]);
		expect(results[0]?.matchedTerms).toEqual(["ai", "exam"]);
	});

	test("restorePersistedFileIndex compacts journal replay back into resident segments", async () => {
		let storedSnapshot: unknown = null;
		let storedJournalEntries: any[] = [];

		const databaseMock = {
			appendCoverageLexicalV2IndexStoreJournalEntries: jest.fn(
				async (entries: readonly any[]) => {
					storedJournalEntries.push(...entries);
				},
			),
			readCoverageLexicalV2IndexStoreSnapshot: jest.fn(async () => storedSnapshot),
			readCoverageLexicalV2IndexStoreJournalEntries: jest.fn(
				async () => storedJournalEntries,
			),
			writeCoverageLexicalV2IndexStoreSnapshot: jest.fn(async (snapshot: unknown) => {
				storedSnapshot = snapshot;
				storedJournalEntries = [];
			}),
		};
		container.registerInstance(Database, databaseMock as any);
		container.registerInstance(FileSnapshotStore, {
			readCurrentTexts: jest.fn(async () => new Map<string, string>()),
		} as any);

		const { CoverageLexicalV2FileSearchEngine } = require(
			"src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-file-search-engine",
		) as {
			CoverageLexicalV2FileSearchEngine: new () => {
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				persistFileIndexArtifact(): Promise<void>;
				restorePersistedFileIndex(): Promise<boolean>;
				getIndexBreakdown(): Record<string, unknown> | null;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string; matchedTerms: string[] }>>;
			};
		};

		const seedEngine = new CoverageLexicalV2FileSearchEngine();
		await seedEngine.addDocuments([
			{
				path: "notes/base.md",
				basename: "base",
				folder: "notes",
				content: "base alpha",
			},
		]);
		await seedEngine.persistFileIndexArtifact();
		await seedEngine.addDocuments([
			{
				path: "notes/journal.md",
				basename: "journal",
				folder: "notes",
				content: "journal beta",
			},
		]);

		const restoredEngine = new CoverageLexicalV2FileSearchEngine();
		await expect(restoredEngine.restorePersistedFileIndex()).resolves.toBe(true);

		const breakdown = restoredEngine.getIndexBreakdown() as any;
		expect(breakdown.documentCount).toBe(2);
		expect(breakdown.segmentCount).toBe(1);
		expect(breakdown.estimatedBytes.residentHot.postings.exactIncidence).toBeLessThan(
			120,
		);
	});
});
