import fs from "fs/promises";
import path from "path";
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

type IndexedDocument = {
	path: string;
	basename: string;
	folder: string;
	content?: string;
	aliases?: string;
	tags?: string;
	headings?: string;
	generation?: number;
	size?: number;
};

type SweepCase = {
	name: string;
	env: Record<string, string>;
};

type SweepSummary = {
	name: string;
	latencyMs: {
		avg: number;
		p50: number;
		p95: number;
		p100: number;
	};
	prefetch: {
		requested: number;
		fetched: number;
		skippedByBudget: number;
		skippedReason: string;
		docStatusCounts: Record<string, number>;
	};
	resultCount: number;
	topPath: string | null;
};

const realVaultHanSweepTest =
	process.env.COVERAGE_LEXICAL_REAL_VAULT_HAN_SWEEP === "1" ? test : test.skip;

async function loadRealVaultDocuments(vaultRoot: string): Promise<IndexedDocument[]> {
	const markdownPaths = await collectMarkdownPaths(vaultRoot);
	const documents: IndexedDocument[] = [];
	for (const markdownPath of markdownPaths) {
		const content = await fs.readFile(markdownPath, "utf8");
		const relativePath = toVaultRelativePath(vaultRoot, markdownPath);
		documents.push({
			path: relativePath,
			basename: path.parse(relativePath).name,
			folder: toVaultRelativeFolder(relativePath),
			aliases: extractAliases(content),
			tags: extractTags(content),
			headings: extractHeadings(content),
			content,
			generation: 1,
			size: Buffer.byteLength(content, "utf8"),
		});
	}
	documents.sort((left, right) => left.path.localeCompare(right.path));
	return documents;
}

async function collectMarkdownPaths(root: string): Promise<string[]> {
	const entries = await fs.readdir(root, { withFileTypes: true });
	const out: string[] = [];
	for (const entry of entries) {
		if (entry.name === ".obsidian") {
			continue;
		}
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			out.push(...(await collectMarkdownPaths(entryPath)));
			continue;
		}
		if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
			out.push(entryPath);
		}
	}
	return out;
}

function toVaultRelativePath(vaultRoot: string, absolutePath: string): string {
	return path.relative(vaultRoot, absolutePath).split(path.sep).join("/");
}

function toVaultRelativeFolder(relativePath: string): string {
	const directory = path.posix.dirname(relativePath);
	return directory === "." ? "" : directory;
}

function extractFrontmatter(text: string): string | null {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
	return match?.[1] ?? null;
}

function extractAliases(text: string): string {
	const frontmatter = extractFrontmatter(text);
	if (!frontmatter) {
		return "";
	}
	const aliases: string[] = [];
	const arrayMatch = frontmatter.match(
		/^aliases:\s*\r?\n((?:[ \t]*-[ \t].*\r?\n?)*)/mu,
	);
	if (arrayMatch?.[1]) {
		for (const line of arrayMatch[1].split(/\r?\n/u)) {
			const itemMatch = line.match(/^[ \t]*-[ \t]*(.+?)\s*$/u);
			if (!itemMatch) {
				continue;
			}
			const value = stripYamlQuotes(itemMatch[1]);
			if (value.length > 0) {
				aliases.push(value);
			}
		}
	}
	const inlineMatch = frontmatter.match(/^aliases:\s*(.+)$/mu);
	if (inlineMatch?.[1]) {
		const raw = inlineMatch[1].trim();
		if (raw.startsWith("[") && raw.endsWith("]")) {
			for (const part of raw.slice(1, -1).split(",")) {
				const value = stripYamlQuotes(part.trim());
				if (value.length > 0) {
					aliases.push(value);
				}
			}
		} else {
			const value = stripYamlQuotes(raw);
			if (value.length > 0) {
				aliases.push(value);
			}
		}
	}
	return aliases.join(" ");
}

function extractTags(text: string): string {
	const matches = text.match(/(^|[\s(])#([\p{L}\p{N}_/\-]+)/gu) ?? [];
	const normalized = new Set<string>();
	for (const match of matches) {
		const tag = match.trim().replace(/^#/, "");
		if (tag.length > 0) {
			normalized.add(tag.toLowerCase().normalize("NFKC"));
		}
	}
	return Array.from(normalized).join(" ");
}

function extractHeadings(text: string): string {
	return Array.from(
		text.matchAll(/^#{1,6}\s+(.*?)\s*$/gmu),
		(match) => match[1]?.trim() ?? "",
	)
		.filter((heading) => heading.length > 0)
		.join(" ");
}

function stripYamlQuotes(value: string): string {
	return value.replace(/^['"]|['"]$/g, "").trim();
}

function normalize(text: string): string {
	return text.toLowerCase().normalize("NFKC");
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

function round(value: number): number {
	return Number(value.toFixed(3));
}

function summarizeTimings(values: readonly number[]) {
	const sorted = [...values].sort((left, right) => left - right);
	if (sorted.length === 0) {
		return { avg: 0, p50: 0, p95: 0, p100: 0 };
	}
	const percentile = (ratio: number) =>
		sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
	return {
		avg: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
		p50: round(percentile(0.5)),
		p95: round(percentile(0.95)),
		p100: round(sorted[sorted.length - 1]),
	};
}

function withEnv<T>(overrides: Record<string, string>, action: () => Promise<T>): Promise<T> {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(overrides)) {
		previous.set(key, process.env[key]);
		process.env[key] = value;
	}
	return action().finally(() => {
		for (const [key, value] of previous.entries()) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});
}

describe("coverage lexical v2 real-vault Han budget sweep", () => {
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
		container.registerInstance(Tokenizer, createWholeHanCoverageTokenizer());
	});

	afterEach(() => {
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	realVaultHanSweepTest(
		"sweeps Han cold exact thresholds on the current Test-Vault",
		async () => {
			const {
				COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_STORE_TOKEN,
			} = require(
				"src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-han-segment-exact-sidecar-types",
			) as {
				COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_STORE_TOKEN: string;
			};
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
					getLastBenchmarkV2CandidateCascadeDebug(): Record<string, any> | null;
				};
			};
			const queryText =
				process.env.COVERAGE_LEXICAL_REAL_VAULT_HAN_SWEEP_QUERY ?? "\u8d62\u5b8b";
			const vaultRoot = path.resolve(process.cwd(), "..", "..", "..");
			const documents = await loadRealVaultDocuments(vaultRoot);
			expect(documents.length).toBeGreaterThan(0);

			const sidecarDocuments = new Map<
				string,
				{
					path: string;
					generation?: number;
					bodyHanSymbolIds: readonly number[];
					segmentCount: number;
				}
			>();
			container.registerInstance(COVERAGE_LEXICAL_V2_HAN_SEGMENT_EXACT_SIDECAR_STORE_TOKEN, {
				clearAll: jest.fn(async () => {
					sidecarDocuments.clear();
				}),
				deleteDocuments: jest.fn(async (paths: readonly string[]) => {
					for (const filePath of paths) {
						sidecarDocuments.delete(filePath);
					}
				}),
				getMeta: jest.fn(async () => ({
					id: "active",
					epoch: 1,
					schemaVersion: 2,
					blockWriteMode: "multi-doc-v2",
					documentCount: sidecarDocuments.size,
					indexedRefsFingerprint: "",
					updatedAt: Date.now(),
				})),
				summarizeConsistency: jest.fn(async () => ({
					needsRepair: false,
					requiresReset: false,
					reason: "up-to-date",
					missingOrStalePaths: [],
					danglingPaths: [],
				})),
				moveDocument: jest.fn(async (oldPath: string, nextDocument: any) => {
					sidecarDocuments.delete(oldPath);
					sidecarDocuments.set(nextDocument.path, nextDocument);
					return true;
				}),
				readDocuments: jest.fn(async (paths: readonly string[]) => {
					const found = new Map<string, any>();
					for (const filePath of paths) {
						const stored = sidecarDocuments.get(filePath);
						if (stored) {
							found.set(filePath, stored);
						}
					}
					return found;
				}),
				updateIndexedRefsMetadata: jest.fn(async () => undefined),
				upsertDocuments: jest.fn(async (nextDocuments: readonly any[]) => {
					for (const document of nextDocuments) {
						sidecarDocuments.set(document.path, document);
					}
				}),
			});

			const engine = new CoverageLexicalFileSearchEngine();
			await engine.addDocuments(documents);

			const sweepCases: SweepCase[] = [
				{
					name: "defaults",
					env: {},
				},
				{
					name: "byte-256k",
					env: {
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_DOC_CAP_PER_GROUP: "256",
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_DOC_CAP_PER_QUERY: "256",
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_DOC_BUDGET: "256",
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_BYTE_BUDGET: String(256 * 1024),
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_TIME_BUDGET_MS: "1000",
					},
				},
				{
					name: "byte-512k",
					env: {
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_DOC_CAP_PER_GROUP: "256",
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_DOC_CAP_PER_QUERY: "256",
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_DOC_BUDGET: "256",
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_BYTE_BUDGET: String(512 * 1024),
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_TIME_BUDGET_MS: "1000",
					},
				},
				{
					name: "byte-1024k",
					env: {
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_DOC_CAP_PER_GROUP: "256",
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_DOC_CAP_PER_QUERY: "256",
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_DOC_BUDGET: "256",
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_BYTE_BUDGET: String(1024 * 1024),
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_TIME_BUDGET_MS: "1000",
					},
				},
				{
					name: "doc-64",
					env: {
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_DOC_CAP_PER_GROUP: "256",
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_DOC_CAP_PER_QUERY: "256",
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_DOC_BUDGET: "64",
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_BYTE_BUDGET: String(8 * 1024 * 1024),
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_TIME_BUDGET_MS: "1000",
					},
				},
				{
					name: "time-100",
					env: {
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_DOC_CAP_PER_GROUP: "256",
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_DOC_CAP_PER_QUERY: "256",
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_DOC_BUDGET: "256",
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_BYTE_BUDGET: String(8 * 1024 * 1024),
						COVERAGE_LEXICAL_V2_HAN_BACKSTOP_COLD_TIME_BUDGET_MS: "100",
					},
				},
			];

			const summaries: SweepSummary[] = [];
			for (const sweepCase of sweepCases) {
				const timings: number[] = [];
				let lastResults: Array<{ path: string }> = [];
				let lastDebug: Record<string, any> | null = null;
				await withEnv(sweepCase.env, async () => {
					for (let iteration = 0; iteration < 5; iteration += 1) {
						const startedAt = performance.now();
						lastResults = await engine.searchFiles({
							queryText,
							isPrefixMatch: true,
							isFuzzy: true,
							maxItemResults: 12,
						});
						timings.push(performance.now() - startedAt);
						lastDebug = engine.getLastBenchmarkV2CandidateCascadeDebug();
					}
				});
				summaries.push({
					name: sweepCase.name,
					latencyMs: summarizeTimings(timings),
						prefetch: {
							requested:
								lastDebug?.hanBackstopMetrics?.bodyHanColdExactRequestedBlockCount ??
								lastDebug?.prefetch?.requestedDocIds?.length ??
								0,
							fetched:
								lastDebug?.hanBackstopMetrics?.bodyHanColdExactFetchedBlockCount ??
								lastDebug?.prefetch?.fetchedDocCount ??
								0,
						skippedByBudget:
							lastDebug?.hanBackstopMetrics?.bodyHanColdExactSkippedByBudget ??
							lastDebug?.prefetch?.skippedByBudget ??
							0,
						skippedReason:
							lastDebug?.hanBackstopMetrics?.bodyHanColdExactSkippedReason ??
							lastDebug?.prefetch?.skippedReason ??
							"unknown",
						docStatusCounts: (lastDebug?.prefetch?.docStatusCounts ?? {}) as Record<
							string,
							number
						>,
					},
					resultCount: lastResults.length,
					topPath: lastResults[0]?.path ?? null,
				});
			}

			console.log(
				"[coverage-lexical-v2-real-vault-han-budget-sweep] sweep",
				JSON.stringify(
					{
						vaultRoot,
						queryText,
						documentCount: documents.length,
						summaries,
					},
					null,
					2,
				),
			);
		},
		120000,
	);
});
