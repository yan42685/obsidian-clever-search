import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { container } from "tsyringe";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

const { Tokenizer } = jest.requireMock("src/services/search/tokenizer") as {
	Tokenizer: new () => unknown;
};

type MockTokenizer = {
	tokenize(text: string, mode?: "index" | "search"): string[];
	tokenizeSequence(text: string, mode?: "index" | "search"): string[];
};

type CorpusManifest = {
	fileCount: number;
	totalBytes: number;
	totalMiB: number;
	files: Array<{ path: string; bytes: number }>;
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

function createMockTokenizer(): MockTokenizer {
	const segmentRegex = /[\p{Script=Han}]+|[a-z0-9][a-z0-9_-]*/gu;
	return {
		tokenize(text: string): string[] {
			return Array.from(new Set(this.tokenizeSequence(text)));
		},
		tokenizeSequence(text: string): string[] {
			const normalized = text.toLowerCase().normalize("NFKC");
			const tokens: string[] = [];
			for (const segment of normalized.match(segmentRegex) ?? []) {
				if (/^[\p{Script=Han}]+$/u.test(segment)) {
					if (segment.length <= 4) {
						tokens.push(segment);
					}
					for (let index = 0; index < segment.length - 1; index++) {
						tokens.push(segment.slice(index, index + 2));
					}
					continue;
				}
				if (segment.length > 1) {
					tokens.push(segment);
				}
			}
			return tokens;
		},
	};
}

function stripFrontmatter(raw: string): string {
	return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function extractHeadings(raw: string): string[] {
	return Array.from(raw.matchAll(/^#{1,6}\s+(.+)$/gm)).map((match) =>
		match[1].trim(),
	);
}

function extractTitle(raw: string, fallback: string): string {
	const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	const titleMatch = frontmatter?.[1].match(/^title:\s*(.+)$/m);
	if (titleMatch?.[1]) {
		return titleMatch[1].trim().replace(/^["']|["']$/g, "");
	}
	return extractHeadings(raw)[0] ?? fallback;
}

function createEngine() {
	const { OuterSetting, DEFAULT_OUTER_SETTING } = require("src/globals/plugin-setting");
	const { PassageFileSearchEngine } = require(
		"src/services/search/passage-lexical/passage-file-search-engine",
	);

	const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
	setting.fileSearchBackend = "passage-bm25";
	setting.isCaseSensitive = false;
	setting.enableChinesePatch = false;
	setting.enableStopWordsEn = false;
	setting.enableStopWordsZh = false;

	container.register(OuterSetting, { useValue: setting });
	container.register(Tokenizer, { useValue: createMockTokenizer() });

	return new PassageFileSearchEngine() as InstanceType<typeof PassageFileSearchEngine>;
}

function loadCorpusManifest(): { manifest: CorpusManifest; corpusRoot: string } {
	const corpusRoot = path.join(
		process.cwd(),
		".codex-bench",
		"corpora",
		"big-vault-mixed-v1",
	);
	const manifestPath = path.join(corpusRoot, "manifest.json");
	if (!fs.existsSync(manifestPath)) {
		throw new Error(
			`Missing corpus manifest at ${manifestPath}. Run node scripts/sync-big-vault-corpus.mjs first.`,
		);
	}
	return {
		manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8")) as CorpusManifest,
		corpusRoot,
	};
}

function loadCorpusDocuments(
	manifest: CorpusManifest,
	corpusRoot: string,
): IndexedDocument[] {
	return manifest.files.map((file) => {
		const absolutePath = path.join(corpusRoot, file.path);
		const raw = fs.readFileSync(absolutePath, "utf8");
		return {
			path: file.path,
			basename: extractTitle(raw, path.basename(file.path, path.extname(file.path))),
			folder: path.posix.dirname(file.path),
			headings: extractHeadings(raw).join(" "),
			content: stripFrontmatter(raw),
		};
	});
}

describe("Passage serialization benchmark", () => {
	beforeEach(() => {
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "en"),
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

	test(
		"compares full passage rebuild with serialized snapshot restore on big-vault-mixed-v1",
		async () => {
			const { manifest, corpusRoot } = loadCorpusManifest();

			const readStart = performance.now();
			const documents = loadCorpusDocuments(manifest, corpusRoot);
			const readDocsMs = performance.now() - readStart;

			const fullEngine = createEngine();
			const fullIndexStart = performance.now();
			await fullEngine.addDocuments(documents);
			const fullIndexMs = performance.now() - fullIndexStart;

			const snapshot = fullEngine.serialize();
			if (!snapshot) {
				throw new Error("expected passage snapshot to serialize");
			}

			const cloneStart = performance.now();
			const clonedSnapshot = structuredClone(snapshot);
			const cloneMs = performance.now() - cloneStart;

			const restoredEngine = createEngine();
			const restoreStart = performance.now();
			const restoredOk = await restoredEngine.reIndexAll(clonedSnapshot);
			const restoreIndexMs = performance.now() - restoreStart;
			expect(restoredOk).toBe(true);

			const queryStart = performance.now();
			const results = await restoredEngine.searchFiles({
				queryText: "alpha beta gamma",
				isPrefixMatch: true,
				isFuzzy: true,
				maxItemResults: 10,
			});
			const restoreQueryMs = performance.now() - queryStart;

			console.log(
				"[passage-serialization-benchmark]",
				JSON.stringify(
					{
						corpus: {
							fileCount: manifest.fileCount,
							totalMiB: manifest.totalMiB,
						},
						stagesMs: {
							readDocsMs: Number(readDocsMs.toFixed(3)),
							fullIndexMs: Number(fullIndexMs.toFixed(3)),
							fullInitTotalMs: Number((readDocsMs + fullIndexMs).toFixed(3)),
							cloneSnapshotMs: Number(cloneMs.toFixed(3)),
							restoreIndexMs: Number(restoreIndexMs.toFixed(3)),
							restoreTotalMs: Number((cloneMs + restoreIndexMs).toFixed(3)),
							restoreQueryMs: Number(restoreQueryMs.toFixed(3)),
						},
						snapshot: {
							jsonMiB: Number(
								(
									Buffer.byteLength(JSON.stringify(snapshot), "utf8") /
									(1024 * 1024)
								).toFixed(2),
							),
						},
						deltaMs: {
							restoreVsFullInit: Number(
								(readDocsMs + fullIndexMs - (cloneMs + restoreIndexMs)).toFixed(3),
							),
						},
						restoreQueryResultCount: results.length,
					},
					null,
					2,
				),
			);
		},
		1200000,
	);
});
