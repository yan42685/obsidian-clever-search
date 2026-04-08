import fs from "fs/promises";
import path from "path";
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

type CoverageLexicalEngineLike = {
	addDocuments(documents: IndexedDocument[]): Promise<void>;
	estimateIndexBytes?(): number | null;
	getIndexBreakdown?(): Record<string, unknown> | null;
	serialize(): unknown;
};

const realVaultAnchorTest =
	process.env.COVERAGE_LEXICAL_REAL_VAULT_ANCHOR === "1" ? test : test.skip;

function registerMockFileSnapshotStore(
	documents: readonly IndexedDocument[] = [],
): {
	currentTexts: Map<string, string>;
	readCurrentTexts: jest.Mock;
} {
	const { FileSnapshotStore } = require(
		"src/services/search/shared/file-snapshot-store",
	) as {
		FileSnapshotStore: new () => unknown;
	};
	const currentTexts = new Map<string, string>();
	for (const document of documents) {
		currentTexts.set(document.path, document.content ?? "");
	}
	const readCurrentTexts = jest.fn(
		async (fileOrPaths: ReadonlyArray<string | { path: string }>) => {
			const result = new Map<string, string>();
			for (const fileOrPath of fileOrPaths) {
				const filePath =
					typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
				const text = currentTexts.get(filePath);
				if (text !== undefined) {
					result.set(filePath, text);
				}
			}
			return result;
		},
	);
	container.registerInstance(FileSnapshotStore, {
		readCurrentTexts,
	} as any);
	return { currentTexts, readCurrentTexts };
}

async function withExperimentalBodyTokenOffloadEnv<T>(
	enabled: boolean,
	action: () => Promise<T>,
): Promise<T> {
	const previous = process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD;
	process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD = enabled
		? "1"
		: "0";
	try {
		return await action();
	} finally {
		if (previous === undefined) {
			delete process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD;
		} else {
			process.env.COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD = previous;
		}
	}
}

function normalize(text: string): string {
	return text.toLowerCase().normalize("NFKC");
}

async function loadRealVaultDocuments(vaultRoot: string): Promise<{
	documents: IndexedDocument[];
	rawMarkdownBytes: number;
}> {
	const markdownPaths = await collectMarkdownPaths(vaultRoot);
	const documents: IndexedDocument[] = [];
	let rawMarkdownBytes = 0;
	for (const markdownPath of markdownPaths) {
		const content = await fs.readFile(markdownPath, "utf8");
		rawMarkdownBytes += Buffer.byteLength(content, "utf8");
		const relativePath = toVaultRelativePath(vaultRoot, markdownPath);
		documents.push({
			path: relativePath,
			basename: path.parse(relativePath).name,
			folder: toVaultRelativeFolder(relativePath),
			aliases: extractAliases(content),
			tags: extractTags(content),
			headings: extractHeadings(content),
			content,
		});
	}
	documents.sort((left, right) => left.path.localeCompare(right.path));
	return { documents, rawMarkdownBytes };
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
			normalized.add(normalize(tag));
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

function round(value: number): number {
	return Number(value.toFixed(3));
}

describe("coverage lexical real vault size anchor", () => {
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
	});

	afterEach(() => {
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
	});

	realVaultAnchorTest("measures live index bytes on the current Test-Vault", async () => {
		process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT = "1";
		const { createMockTokenizer } = require(
			"./coverage-lexical-automation-benchmark.bench",
		) as {
			createMockTokenizer: () => unknown;
		};
		delete process.env.COVERAGE_LEXICAL_FIXTURE_IMPORT;

		const vaultRoot = path.resolve(process.cwd(), "..", "..", "..");
		const { documents, rawMarkdownBytes } = await loadRealVaultDocuments(vaultRoot);
		expect(documents.length).toBeGreaterThan(0);

		const { CoverageLexicalFileSearchEngine } = require(
			"src/services/search/coverage-lexical/coverage-lexical-engine",
		) as {
			CoverageLexicalFileSearchEngine: new () => CoverageLexicalEngineLike;
		};

		container.registerInstance(Tokenizer, createMockTokenizer());
		const baselineEngine = await withExperimentalBodyTokenOffloadEnv(
			false,
			async () => {
				const engine = new CoverageLexicalFileSearchEngine();
				await engine.addDocuments(documents);
				return engine;
			},
		);
		const baselineBytes = baselineEngine.estimateIndexBytes?.() ?? 0;
		const baselineBreakdown = baselineEngine.getIndexBreakdown?.() ?? null;
		const baselineSnapshot = baselineEngine.serialize() as
			| { data?: ArrayBuffer }
			| null;

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
		registerMockFileSnapshotStore(documents);
		const offloadedEngine = await withExperimentalBodyTokenOffloadEnv(
			true,
			async () => {
				const engine = new CoverageLexicalFileSearchEngine();
				await engine.addDocuments(documents);
				return engine;
			},
		);
		const offloadedBytes = offloadedEngine.estimateIndexBytes?.() ?? 0;
		const offloadedBreakdown = offloadedEngine.getIndexBreakdown?.() ?? null;
		const offloadedSnapshot = offloadedEngine.serialize() as
			| { data?: ArrayBuffer }
			| null;

		console.log(
			"[coverage-lexical-real-vault-size-anchor] anchor",
			JSON.stringify(
				{
					vaultRoot,
					corpus: {
						documentCount: documents.length,
						rawMarkdownBytes,
						rawMarkdownKB: round(rawMarkdownBytes / 1024),
					},
					baseline: {
						estimatedIndexBytes: baselineBytes,
						estimatedIndexKB: round(baselineBytes / 1024),
						snapshotBytes: baselineSnapshot?.data?.byteLength ?? 0,
						bodyTokenLexicon:
							((baselineBreakdown?.estimatedBytes as Record<string, unknown>)
								?.documentIdentity as Record<string, unknown> | undefined)
								?.bodyTokenLexicon ?? null,
						bodyTokensById:
							((baselineBreakdown?.estimatedBytes as Record<string, unknown>)
								?.documentIdentity as Record<string, unknown> | undefined)
								?.bodyTokensById ?? null,
					},
					offloaded: {
						estimatedIndexBytes: offloadedBytes,
						estimatedIndexKB: round(offloadedBytes / 1024),
						snapshotBytes: offloadedSnapshot?.data?.byteLength ?? 0,
						bodyTokenLexicon:
							((offloadedBreakdown?.estimatedBytes as Record<string, unknown>)
								?.documentIdentity as Record<string, unknown> | undefined)
								?.bodyTokenLexicon ?? null,
						bodyTokensById:
							((offloadedBreakdown?.estimatedBytes as Record<string, unknown>)
								?.documentIdentity as Record<string, unknown> | undefined)
								?.bodyTokensById ?? null,
					},
					ratios: {
						baselineVsRaw:
							rawMarkdownBytes > 0 ? round(baselineBytes / rawMarkdownBytes) : null,
						offloadedVsRaw:
							rawMarkdownBytes > 0 ? round(offloadedBytes / rawMarkdownBytes) : null,
						offloadedVsBaseline:
							baselineBytes > 0 ? round(offloadedBytes / baselineBytes) : null,
					},
				},
				null,
				2,
			),
		);
	}, 1200000);
});
