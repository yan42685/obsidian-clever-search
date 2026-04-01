import { container } from "tsyringe";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
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

function createMockTokenizer() {
	function normalize(text: string): string {
		return text.toLowerCase().normalize("NFKC");
	}
	function tokenizeSegment(segment: string): string[] {
		const compact = normalize(segment);
		if (compact.trim().length === 0) {
			return [];
		}
		return compact.match(/[\p{Script=Han}]+|[a-z0-9_-]+/gu) ?? [];
	}
	return {
		tokenize(text: string): string[] {
			return tokenizeSegment(text);
		},
		tokenizeSequence(text: string): string[] {
			return tokenizeSegment(text);
		},
		tokenizeSequenceWithOffsets(text: string): Array<{
			token: string;
			start: number;
			end: number;
		}> {
			const normalized = normalize(text);
			return Array.from(
				normalized.matchAll(/[\p{Script=Han}]+|[a-z0-9_-]+/gu),
			).map((match) => ({
				token: match[0],
				start: match.index ?? 0,
				end: (match.index ?? 0) + match[0].length,
			}));
		},
	};
}

function registerMockFileSnapshotStore(
	documents: readonly IndexedDocument[] = [],
): {
	currentTexts: Map<string, string>;
	persistedTexts: Map<string, string>;
} {
	const { FileSnapshotStore } = require(
		"src/services/search/shared/file-snapshot-store",
	) as {
		FileSnapshotStore: new () => unknown;
	};
	const currentTexts = new Map<string, string>();
	const persistedTexts = new Map<string, string>();
	for (const document of documents) {
		const text = document.content ?? "";
		currentTexts.set(document.path, text);
		persistedTexts.set(document.path, text);
	}
	container.registerInstance(FileSnapshotStore, {
		peekCurrentFileText: jest.fn((path: string) => currentTexts.get(path)),
		setCurrentFileText: jest.fn((path: string, text: string) => {
			currentTexts.set(path, text);
			return text;
		}),
		getIndexedSnapshotTexts: jest.fn(async (paths: string[]) => {
			const results = new Map<string, string>();
			for (const path of paths) {
				const persisted = persistedTexts.get(path);
				if (persisted !== undefined) {
					results.set(path, persisted);
				}
			}
			return results;
		}),
		readCurrentFileText: jest.fn(async (path: string) => {
			const text = currentTexts.get(path) ?? persistedTexts.get(path) ?? "";
			currentTexts.set(path, text);
			return text;
		}),
	} as any);
	return { currentTexts, persistedTexts };
}

describe("coverage lexical binary snapshot", () => {
	beforeEach(() => {
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "en"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};
	});

	afterEach(() => {
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	test("round-trips its own binary snapshot without changing search behavior", async () => {
		container.registerInstance(Tokenizer, createMockTokenizer());
		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => {
				readonly supportsSerialization: boolean;
				addDocuments(documents: IndexedDocument[]): Promise<void>;
				deleteDocuments(paths: string[]): void;
				reIndexAll(data: unknown): Promise<boolean>;
				serialize(): unknown;
				getDirectSubItems(
					queryText: string,
					path: string,
					maxSubItemCount: number,
				): Promise<Array<{ text: string }> | null>;
				searchFiles(request: {
					queryText: string;
					isPrefixMatch: boolean;
					isFuzzy: boolean;
					maxItemResults: number;
				}): Promise<Array<{ path: string; matchedTerms?: string[] }>>;
			};
		};

		const query = {
			queryText: "alpha beta gamma",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		};
		const targetPath = "notes/restore-target.md";
		const documents = [
			{
				path: targetPath,
				basename: "restore target",
				folder: "notes",
				aliases: "gamma restore note",
				tags: "#restore #alpha",
				headings: "Alpha heading",
				content:
					"alpha beta gamma live together in one compact paragraph for restore verification",
			},
			{
				path: "notes/distractor.md",
				basename: "distractor",
				folder: "notes",
				content:
					"alpha appears here but beta and gamma are separated by unrelated filler text",
			},
		];
		const fileSnapshotStore = registerMockFileSnapshotStore(documents);
		const engine = new CoverageLexicalFileSearchEngine();
		expect(engine.supportsSerialization).toBe(true);
		await engine.addDocuments(documents);

		const beforeSnapshot = await engine.searchFiles(query);
		expect(beforeSnapshot[0]?.path).toBe(targetPath);

		const snapshot = engine.serialize() as Record<string, unknown> | null;
		expect(snapshot).not.toBeNull();
		expect(snapshot).toMatchObject({
			__backend: "coverage-lexical",
			__version: 2,
			__encoding: "binary-snapshot-v2",
		});
		expect(snapshot?.data).toBeInstanceOf(ArrayBuffer);

		const restored = new CoverageLexicalFileSearchEngine();
		const restoredOk = await restored.reIndexAll(snapshot);
		expect(restoredOk).toBe(true);

		const restoredResults = await restored.searchFiles(query);
		expect(restoredResults[0]?.path).toBe(targetPath);
		expect(restoredResults[0]?.matchedTerms).toEqual(
			expect.arrayContaining(["alpha", "beta", "gamma"]),
		);

		const subItems = await restored.getDirectSubItems("gamma", targetPath, 2);
		expect(subItems).not.toBeNull();
		expect(subItems?.length).toBeGreaterThan(0);

		restored.deleteDocuments([targetPath]);
		const afterDelete = await restored.searchFiles(query);
		expect(afterDelete.map((entry) => entry.path)).not.toContain(targetPath);

		await restored.addDocuments([
			{
				path: targetPath,
				basename: "restore target",
				folder: "notes",
				content: "rewritten focus note keeps restore behavior after binary hydrate",
			},
		]);
		const afterReAdd = await restored.searchFiles({
			queryText: "rewritten focus restore",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 10,
		});
		expect(afterReAdd[0]?.path).toBe(targetPath);
	});
});
