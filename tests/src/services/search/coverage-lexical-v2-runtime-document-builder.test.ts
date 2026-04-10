import {
	buildCoverageLexicalV2RuntimeDocumentLexicalStates,
	type CoverageLexicalV2RuntimeStorageReader,
} from "src/services/search/coverage-lexical-v2/runtime";

function createStorageReader(): {
	reader: CoverageLexicalV2RuntimeStorageReader;
	prefetchBodyTokenSequences: jest.Mock<Promise<void>, [readonly number[]]>;
} {
	const documents = new Map([
		[1, {
			path: "notes/cache.md",
			basenameText: "cache",
			aliasesText: "",
			headingsText: "",
		}],
		[2, {
			path: "notes/cached.md",
			basenameText: "cached",
			aliasesText: "",
			headingsText: "",
		}],
		[3, {
			path: "notes/cace.md",
			basenameText: "cace",
			aliasesText: "",
			headingsText: "",
		}],
	]);
	const postings = new Map<string, readonly number[] | Uint32Array>([
		["body:cache", [1]],
		["body:cached", [2]],
		["body:cace", [3]],
		["basename:cache", [1]],
	]);
	const bodyTokenSequences = new Map<number, readonly string[]>([
		[1, ["cache"]],
		[2, ["cached"]],
		[3, ["cace"]],
	]);
	const prefetchBodyTokenSequences = jest.fn(async (_docIds: readonly number[]) => {});
	return {
		reader: {
			getDocumentRecord(docId) {
				return documents.get(docId) ?? null;
			},
			getPostingMatches(field, term) {
				return postings.get(`${field}:${term}`);
			},
			getSortedLexicon() {
				return ["cace", "cache", "cached"];
			},
			getBodyTokenSequence(docId) {
				return bodyTokenSequences.get(docId);
			},
			prefetchBodyTokenSequences,
			tokenizeText(text) {
				return text.toLowerCase().match(/[a-z0-9_-]+/gu) ?? [];
			},
		},
		prefetchBodyTokenSequences,
	};
}

describe("coverage lexical v2 runtime document builder", () => {
	test("collects exact, prefix, and fuzzy candidate documents through the runtime storage boundary", async () => {
		const { reader, prefetchBodyTokenSequences } = createStorageReader();

		const documents = await buildCoverageLexicalV2RuntimeDocumentLexicalStates(
			["cache"],
			reader,
			{
				includePrefix: true,
				includeFuzzy: true,
				fuzzyProportion: 0.2,
			},
		);

		expect(prefetchBodyTokenSequences).toHaveBeenCalledWith([1]);
		expect(documents).toEqual([
			{
				docId: 3,
				path: "notes/cace.md",
				stableDeterministicKey: "notes/cace.md",
				fieldTerms: {
					bodyTerms: ["cace"],
				},
			},
			{
				docId: 1,
				path: "notes/cache.md",
				stableDeterministicKey: "notes/cache.md",
				fieldTerms: {
					basenameTerms: ["cache"],
					bodyTerms: ["cache"],
				},
				basenameTokenSequence: ["cache"],
				bodyTokenSequence: ["cache"],
			},
			{
				docId: 2,
				path: "notes/cached.md",
				stableDeterministicKey: "notes/cached.md",
				fieldTerms: {
					bodyTerms: ["cached"],
				},
			},
		]);
	});
});
