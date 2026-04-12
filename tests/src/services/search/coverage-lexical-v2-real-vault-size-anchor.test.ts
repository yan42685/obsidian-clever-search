import fs from "fs/promises";
import path from "path";
import {
	CoverageLexicalV2IndexStore,
} from "src/services/search/coverage-lexical-v2/index-store/coverage-lexical-v2-index-store";
import {
	extractHanBigrams,
	extractHanSegments,
	splitCoverageLexicalTagValues,
} from "src/services/search/coverage-lexical/coverage-lexical-cjk";

jest.mock("src/services/search/tokenizer", () => ({
	Tokenizer: class MockTokenizerToken {},
}));

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

const realVaultAnchorTest =
	process.env.COVERAGE_LEXICAL_REAL_VAULT_ANCHOR === "1" ? test : test.skip;

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
			generation: 1,
			size: Buffer.byteLength(content, "utf8"),
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

function round(value: number): number {
	return Number(value.toFixed(3));
}

function dedupe(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))];
}

function tokenize(tokenizer: any, text: string): string[] {
	return tokenizer
		.tokenizeSequence(text, "index")
		.map((term: string) => term.toLowerCase());
}

function buildPreparedDocument(tokenizer: any, document: IndexedDocument) {
	const basenameText = document.basename ?? "";
	const aliasesText = document.aliases ?? "";
	const headingsText = document.headings ?? "";
	const folderText = document.folder ?? "";
	const tagsText = document.tags ?? "";
	const bodyText = document.content ?? "";
	const bodyTokens = tokenize(tokenizer, bodyText);
	return {
		path: document.path,
		generation: document.generation,
		indexedRef: {
			path: document.path,
			generation: document.generation ?? 0,
			size: document.size,
		},
		record: {
			path: document.path,
			stableDeterministicKey: document.path,
			basenameText,
			aliasesText,
			headingsText,
			folderText,
			tagsText,
		},
		exactTermsByField: {
			basename: dedupe(tokenize(tokenizer, basenameText)),
			aliases: dedupe(tokenize(tokenizer, aliasesText)),
			headings: dedupe(tokenize(tokenizer, headingsText)),
			folder: dedupe(tokenize(tokenizer, folderText)),
			tag: dedupe(tokenize(tokenizer, tagsText)),
			body: dedupe(bodyTokens),
		},
		metadataHanBigramsByField: {
			basename: dedupe(extractHanBigrams(basenameText)),
			aliases: dedupe(extractHanBigrams(aliasesText)),
			headings: dedupe(extractHanBigrams(headingsText)),
			folder: dedupe(extractHanBigrams(folderText)),
			tag: dedupe(
				splitCoverageLexicalTagValues(tagsText).flatMap((tagValue) =>
					extractHanBigrams(tagValue),
				),
			),
		},
		bodyHanSegments: extractHanSegments(bodyText),
		bodyTokens,
	};
}

describe("coverage lexical v2 real vault size anchor", () => {
	realVaultAnchorTest(
		"measures live index bytes on the current Test-Vault",
		async () => {
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

			const tokenizer = createMockTokenizer();
			const store = new CoverageLexicalV2IndexStore();
			for (const document of documents) {
				store.replaceDocument(buildPreparedDocument(tokenizer as any, document));
			}
			store.compactOverlayIntoSegment(true);

			const breakdown = store.buildIndexBreakdown();
			const residentBytes = breakdown.estimatedBytes.residentHot.total;

			console.log(
				"[coverage-lexical-v2-real-vault-size-anchor] anchor",
				JSON.stringify(
					{
						vaultRoot,
						corpus: {
							documentCount: breakdown.documentCount,
							rawMarkdownBytes,
							rawMarkdownKB: round(rawMarkdownBytes / 1024),
						},
						v2: {
							segmentCount: breakdown.segmentCount,
							estimatedIndexBytes: breakdown.estimatedBytes.combinedOwnedTotal,
							estimatedIndexKB: round(
								breakdown.estimatedBytes.combinedOwnedTotal / 1024,
							),
							residentBytes,
							residentKB: round(residentBytes / 1024),
							bodyTokenSidecarBytes:
								breakdown.estimatedBytes.coldOwned.bodyTokensSidecar,
							bodyTokenSidecarKB: round(
								breakdown.estimatedBytes.coldOwned.bodyTokensSidecar / 1024,
							),
							exactIncidenceBytes:
								breakdown.estimatedBytes.residentHot.postings.exactIncidence,
							metadataHanGateBytes:
								breakdown.estimatedBytes.residentHot.postings.metadataHanGate,
							documentViewBytes:
								breakdown.estimatedBytes.residentHot.documents.view,
							bodyHanVerificationViewBytes:
								breakdown.estimatedBytes.residentHot.verification.bodyHanSegments,
							latinExpansionLexiconBytes:
								breakdown.estimatedBytes.residentHot.lexicon.latinExpansion,
							bodyTokensHotBytes:
								breakdown.estimatedBytes.residentHot.caches.bodyTokensHot,
							overlapBytes:
								breakdown.estimatedBytes.overlapDiagnostics.total,
							exactTermCount: breakdown.exactTermCount,
							metadataHanBigramCount: breakdown.metadataHanBigramCount,
							latinExpansionTermCount:
								breakdown.latinExpansionTermCount,
						},
						ratios: {
							totalVsRaw:
								rawMarkdownBytes > 0
									? round(
											breakdown.estimatedBytes.combinedOwnedTotal /
												rawMarkdownBytes,
									  )
									: null,
							residentVsRaw:
								rawMarkdownBytes > 0
									? round(residentBytes / rawMarkdownBytes)
									: null,
							coldVsRaw:
								rawMarkdownBytes > 0
									? round(
											breakdown.estimatedBytes.coldOwned.bodyTokensSidecar /
												rawMarkdownBytes,
									  )
									: null,
						},
					},
					null,
					2,
				),
			);
		},
		1200000,
	);
});

