jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

jest.mock("src/services/search/shared/file-snapshot-store", () => ({
	FileSnapshotStore: class MockFileSnapshotStore {
		readIndexedTexts(): Promise<Map<string, string>> {
			return Promise.resolve(new Map());
		}

		readCurrentTexts(): Promise<Map<string, string>> {
			return Promise.resolve(new Map());
		}

		publishIndexedTexts(): Promise<void> {
			return Promise.resolve();
		}

		publishIndexedMetadata(): Promise<void> {
			return Promise.resolve();
		}

		publishLexicalBodyEvidence(): Promise<void> {
			return Promise.resolve();
		}

		publishLexicalHanDocEvidence(): Promise<void> {
			return Promise.resolve();
		}

		publishLexicalHanBodyEvidence(): Promise<void> {
			return Promise.resolve();
		}
	}
}));

jest.mock(
	"src/services/search/coverage-lexical-v3/direct-subitems",
	() => ({
		buildV3DirectSubitems: () => ({ subItems: [] }),
	}),
	{ virtual: true },
);

jest.mock(
	"src/services/search/coverage-lexical-v3/direct-subitems",
	() => ({
		buildDirectSubitemsExactFileSubItems: () => [],
	}),
	{ virtual: true },
);

import type { IndexedDocument } from "src/globals/search-types";
import { CoverageLexicalV3FileSearchEngine } from "src/services/search/coverage-lexical-v3/file-search-engine";
import type { CoverageLexicalV3Engine } from "src/services/search/coverage-lexical-v3/engine";
import type { ResidentBase } from "src/services/search/coverage-lexical-v3/layout/types";
import { FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";
import { container } from "tsyringe";

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

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

function createBaselineDocuments(count: number): IndexedDocument[] {
	return Array.from({ length: count }, (_, index) =>
		createDocument({
			path: `notes/doc-${index.toString().padStart(3, "0")}.md`,
			basename: "alpha",
			folder: "notes",
			content: "alpha",
		}),
	);
}

function createStressDocument(path: string): IndexedDocument {
	const content = Array.from({ length: 257 }, (_, index) => `stress${index}`).join("\n\n");
	return createDocument({
		path,
		basename: "stress",
		folder: "stress",
		content,
	});
}

function tokenizeSequence(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/u)
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
}

function getResidentBase(engine: CoverageLexicalV3FileSearchEngine): ResidentBase {
	const residentBase = (
		engine as unknown as {
			engine: CoverageLexicalV3Engine;
		}
	).engine.getResidentIndexView()?.shards[0]?.base ?? null;
	if (residentBase == null) {
		throw new Error("Expected resident base to be available");
	}
	return residentBase;
}

async function searchAlphaPaths(
	engine: CoverageLexicalV3FileSearchEngine,
	maxItemResults = 16,
): Promise<string[]> {
	const matches = await engine.searchFiles({
		queryText: "alpha",
		isPrefixMatch: true,
		isFuzzy: false,
		maxItemResults,
		hideWeaklyRelatedResults: false,
	});
	return matches.map((match) => match.path);
}

describe("coverage lexical v3 reindex width transitions", () => {
	beforeEach(() => {
		container.clearInstances();
		container.registerInstance(
			Tokenizer,
			{
				tokenizeSequence,
			} as unknown as InstanceType<typeof Tokenizer>,
		);
		container.registerInstance(
			FileSnapshotStore,
			new FileSnapshotStore(),
		);
	});

	afterEach(() => {
		container.clearInstances();
	});

	test("addDocuments and deleteDocuments can widen resident widths without changing unrelated ranking", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		const baselineDocuments = createBaselineDocuments(256);
		const stressDocument = createStressDocument("notes/stress-width.md");

		await engine.reIndexAll(baselineDocuments);
		const baselinePaths = await searchAlphaPaths(engine);
		const baselineBase = getResidentBase(engine);

		expect(baselineBase.bodyBlocks.docIdByBlockId).toBeInstanceOf(Uint8Array);

		await engine.addDocuments([stressDocument]);
		const widenedBase = getResidentBase(engine);

		expect(widenedBase.bodyBlocks.docIdByBlockId).toBeInstanceOf(Uint16Array);
		expect(await searchAlphaPaths(engine)).toEqual(baselinePaths);

		engine.deleteDocuments([stressDocument.path]);
		const postDeleteBase = getResidentBase(engine);

		expect(postDeleteBase.bodyBlocks.docIdByBlockId).toBeInstanceOf(Uint16Array);
		expect(await searchAlphaPaths(engine)).toEqual(baselinePaths);
	});

	test("moveDocument, batch reindex, and reIndexAll preserve correctness across rebuild boundaries", async () => {
		const engine = new CoverageLexicalV3FileSearchEngine();
		const baselineDocuments = createBaselineDocuments(32);
		const movedDocument = createDocument({
			path: "notes/doc-000-renamed.md",
			basename: "alpha",
			folder: "notes",
			content: "alpha",
		});
		const stressDocument = createStressDocument("notes/stress-batch.md");

		await engine.reIndexAll(baselineDocuments);
		await engine.moveDocument("notes/doc-000.md", movedDocument);

		const movedPaths = await searchAlphaPaths(engine, 64);
		expect(movedPaths).toContain("notes/doc-000-renamed.md");
		expect(movedPaths).not.toContain("notes/doc-000.md");

		engine.beginBatchReindex();
		await engine.addDocuments([stressDocument]);
		engine.deleteDocuments(["notes/doc-000-renamed.md"]);

		const preFinishPaths = await searchAlphaPaths(engine, 64);
		expect(preFinishPaths).toContain("notes/doc-000-renamed.md");

		engine.finishBatchReindex();

		const postFinishPaths = await searchAlphaPaths(engine, 64);
		expect(postFinishPaths).not.toContain("notes/doc-000-renamed.md");
		expect(postFinishPaths).not.toContain("notes/doc-000.md");

		await engine.reIndexAll(createBaselineDocuments(8));
		expect(getResidentBase(engine).bodyBlocks.docIdByBlockId).toBeInstanceOf(Uint8Array);
		expect(await searchAlphaPaths(engine, 8)).toEqual([
			"notes/doc-000.md",
			"notes/doc-001.md",
			"notes/doc-002.md",
			"notes/doc-003.md",
			"notes/doc-004.md",
			"notes/doc-005.md",
			"notes/doc-006.md",
			"notes/doc-007.md",
		]);
	});
});
