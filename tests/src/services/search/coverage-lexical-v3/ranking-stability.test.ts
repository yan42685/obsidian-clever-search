import type { IndexedDocument } from "src/globals/search-types";
import { CoverageLexicalV3Engine } from "src/services/search/coverage-lexical-v3/engine";
import type { V3DocumentTokenizer } from "src/services/search/coverage-lexical-v3/query";

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
		generation: overrides.generation,
		size: overrides.size,
	};
}

function createDocumentTokenizer(
	termMap: Readonly<Record<string, readonly string[]>>,
): V3DocumentTokenizer {
	return (text) => termMap[text] ?? [];
}

function createWidthStressDocuments(): IndexedDocument[] {
	return Array.from({ length: 260 }, (_, index) =>
		createDocument({
			path: `stress/irrelevant-${index.toString().padStart(3, "0")}.md`,
			basename: "stress",
			folder: "stress",
			content: Array.from({ length: 4 }, (_, blockIndex) => `noise${index}_${blockIndex}`).join(
				"\n\n",
			),
		}),
	);
}

function summarizeCandidates(engine: CoverageLexicalV3Engine, queryText: string, queryTerms: readonly string[] = []) {
	return engine.search(queryText, queryTerms).rankedCandidates.map((candidate) => ({
		path: candidate.path,
		realizedCoverageCount: candidate.realizedCoverageCount,
		strongestContainer: candidate.strongestContainer?.tier ?? null,
		strongestHanSurfaceCompletionTier: candidate.strongestHanSurfaceCompletionTier,
	}));
}

describe("coverage lexical v3 ranking stability", () => {
	test("layout widening leaves latin, han gate, and metadata-vs-body rankings unchanged", () => {
		const tokenizer = createDocumentTokenizer({
			"缓存恢复说明": ["缓存", "恢复", "说明"],
			"缓存扩容说明": ["缓存", "扩容", "说明"],
			"system proxy access": ["system", "proxy", "access"],
		});
		const corpus = [
			createDocument({
				path: "latin/exact.md",
				basename: "cache restore",
				folder: "latin",
				content: "plain note",
			}),
			createDocument({
				path: "latin/prefix.md",
				basename: "cache restoration",
				folder: "latin",
				content: "plain note",
			}),
			createDocument({
				path: "zh/metadata-hit.md",
				basename: "缓存恢复说明",
				folder: "zh",
				content: "普通记录",
			}),
			createDocument({
				path: "zh/metadata-distractor.md",
				basename: "缓存扩容说明",
				folder: "zh",
				content: "普通记录",
			}),
			createDocument({
				path: "infra/metadata-strong.md",
				basename: "system proxy access",
				folder: "infra",
				content: "plain note",
			}),
			createDocument({
				path: "infra/body-strong.md",
				basename: "plain note",
				folder: "infra",
				content: "system proxy access",
			}),
		];
		const widenedCorpus = [...corpus, ...createWidthStressDocuments()];
		const baseEngine = new CoverageLexicalV3Engine();
		const widenedEngine = new CoverageLexicalV3Engine();

		baseEngine.buildResidentBase(corpus, tokenizer);
		widenedEngine.buildResidentBase(widenedCorpus, tokenizer);

		expect(summarizeCandidates(baseEngine, "cache restore")).toEqual(
			summarizeCandidates(widenedEngine, "cache restore"),
		);
		expect(summarizeCandidates(baseEngine, "缓存恢复", ["缓存", "恢复"])).toEqual(
			summarizeCandidates(widenedEngine, "缓存恢复", ["缓存", "恢复"]),
		);
		expect(summarizeCandidates(baseEngine, "system proxy access")).toEqual(
			summarizeCandidates(widenedEngine, "system proxy access"),
		);
	});
});
