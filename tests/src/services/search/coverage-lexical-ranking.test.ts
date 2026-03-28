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
		const parts = compact.match(/[\p{Script=Han}]+|[a-z0-9_-]+/gu) ?? [];
		const tokens: string[] = [];
		for (const part of parts) {
			if (/^[a-z0-9_-]+$/u.test(part)) {
				tokens.push(part);
				continue;
			}
			tokens.push(part);
			if (part.length <= 2) {
				continue;
			}
			for (let index = 0; index < part.length - 1; index++) {
				tokens.push(part.slice(index, index + 2));
			}
		}
		return Array.from(new Set(tokens));
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
			const matches = normalized.matchAll(/[\p{Script=Han}]+|[a-z0-9_-]+/gu);
			const seen = new Set<string>();
			const out: Array<{ token: string; start: number; end: number }> = [];
			for (const match of matches) {
				const part = match[0];
				const start = match.index ?? 0;
				if (/^[a-z0-9_-]+$/u.test(part)) {
					if (!seen.has(part)) {
						out.push({ token: part, start, end: start + part.length });
						seen.add(part);
					}
					continue;
				}
				if (!seen.has(part)) {
					out.push({ token: part, start, end: start + part.length });
					seen.add(part);
				}
				if (part.length <= 2) {
					continue;
				}
				for (let index = 0; index < part.length - 1; index++) {
					const token = part.slice(index, index + 2);
					if (seen.has(token)) {
						continue;
					}
					out.push({
						token,
						start: start + index,
						end: start + index + 2,
					});
					seen.add(token);
				}
			}
			return out;
		},
	};
}

describe("coverage lexical ranking", () => {
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
		container.registerInstance(Tokenizer, createMockTokenizer());
	});

	afterEach(() => {
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	test("prefers stronger metadata identity evidence for mixed-anchor queries", async () => {
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
				}): Promise<Array<{ path: string }>>;
			};
		};

		const documents: IndexedDocument[] = [
			{
				path: "pkm-en/notes/linking/aliases-deep-dive.md",
				basename: "aliases-deep-dive.md",
				folder: "pkm-en/notes/linking",
				headings: "Aliases and old names",
				content:
					"aliases let one note answer to multiple old names when project links drift",
				aliases: "old project aliases;legacy aliases",
			},
			{
				path: "pkm-en/notes/linking/project-rename-map.md",
				basename: "project-rename-map.md",
				folder: "pkm-en/notes/linking",
				headings: "Project rename map",
				content:
					"canonical project rename map covers old project names and migration references",
				aliases: "rename map;canonical project names",
			},
			{
				path: "pkm-en/notes/linking/old-project-index.md",
				basename: "old-project-index.md",
				folder: "pkm-en/notes/linking",
				headings: "Old project index",
				content:
					"index of old project names and archived references without alias guidance",
			},
		];

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments(documents);

		const results = await engine.searchFiles({
			queryText: "old names still resolve through aliases",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results[0]?.path).toBe("pkm-en/notes/linking/aliases-deep-dive.md");
	});

	test("uses best local explanation window for partial-memory ties", async () => {
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
				}): Promise<Array<{ path: string }>>;
			};
		};

		const documents: IndexedDocument[] = [
			{
				path: "pkm-en/projects/sdk/cache-restore-checklist.md",
				basename: "cache-restore-checklist.md",
				folder: "pkm-en/projects/sdk",
				headings: "Cache restore checklist",
				content:
					"note about cache restore after warmup failed needs checkpoint replay warmup verification and shard checks",
				aliases: "cache restore after outage;restore note",
			},
			{
				path: "pkm-en/inbox/restart-cache-after-outage.md",
				basename: "restart-cache-after-outage.md",
				folder: "pkm-en/inbox",
				headings: "Restart cache after outage",
				content:
					"note about restart actions after outage with filler context then cache then more filler then after then more filler then warmup then more filler then failed replay",
			},
			{
				path: "pkm-en/notes/cache-restart-verification.md",
				basename: "cache-restart-verification.md",
				folder: "pkm-en/notes",
				headings: "Cache restart verification",
				content:
					"verification note covers cache restart after outage with replay checks and later after warmup confirmation after many checklist steps",
			},
		];

		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments(documents);

		const results = await engine.searchFiles({
			queryText: "note about restoring cache after warmup failed",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
		});

		expect(results[0]?.path).toBe("pkm-en/projects/sdk/cache-restore-checklist.md");
	});

	test("builds native direct subitems with mixed-script row col anchors", async () => {
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
					maxDirectSubItemResults?: number;
					maxSubItemResults?: number;
				}): Promise<
					Array<{
						path: string;
						nativeSubItemsReady?: boolean;
						directSubItems?: Array<{
							row: number;
							col: number;
							text: string;
							highlightRanges?: Array<{ start: number; end: number }>;
						}>;
					}>
				>;
			};
		};

		const content = [
			"alpha outline line",
			"第二行 mixed cache 恢复 note bridge",
			"third trailing line",
		].join("\n");
		const engine = new CoverageLexicalFileSearchEngine();
		await engine.addDocuments([
			{
				path: "pkm-zh/mixed/cache-note.md",
				basename: "cache-note.md",
				folder: "pkm-zh/mixed",
				headings: "Cache note",
				content,
			},
		]);

		const results = await engine.searchFiles({
			queryText: "cache 恢复 note",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 3,
			maxDirectSubItemResults: 3,
			maxSubItemResults: 6,
		});

		expect(results[0]?.nativeSubItemsReady).toBe(true);
		expect(results[0]?.directSubItems?.length ?? 0).toBeGreaterThan(0);
		const firstSubItem = results[0]?.directSubItems?.[0];
		expect(firstSubItem?.row).toBe(1);
		expect(firstSubItem?.col).toBe("第二行 mixed ".length);
		expect(firstSubItem?.highlightRanges?.length ?? 0).toBeGreaterThan(0);
		expect(firstSubItem?.text.includes("cache")).toBe(true);
	});
});
