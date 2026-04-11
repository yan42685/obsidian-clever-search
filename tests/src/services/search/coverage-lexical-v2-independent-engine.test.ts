import {
	searchCoverageLexicalV2Engine,
	type CoverageLexicalV2CandidateCascadeStorageReader,
} from "src/services/search/coverage-lexical-v2";

function createStorageReader(): CoverageLexicalV2CandidateCascadeStorageReader {
	const documents = new Map([
		[1, {
			path: "notes/ai-design.md",
			basenameText: "ai",
			aliasesText: "",
			headingsText: "",
			folderText: "notes",
			tagsText: "",
		}],
		[2, {
			path: "notes/exam-summary.md",
			basenameText: "exam-summary",
			aliasesText: "",
			headingsText: "",
			folderText: "notes",
			tagsText: "",
		}],
		[3, {
			path: "notes/study-plan.md",
			basenameText: "study-plan",
			aliasesText: "",
			headingsText: "",
			folderText: "notes",
			tagsText: "",
		}],
	]);
	const postings = new Map<string, readonly number[]>([
		["basename:ai", [1]],
		["body:ai", [1, 2]],
		["body:exam", [1, 2, 3]],
	]);
	const bodyTokenSequences = new Map<number, readonly string[]>([
		[1, ["ai", "exam", "design"]],
		[2, ["ai", "exam", "summary"]],
		[3, ["exam", "plan"]],
	]);
	const bodyHanSegments = new Map<number, readonly string[]>([
		[1, []],
		[2, []],
		[3, []],
	]);
	return {
		getDocumentRecord(docId) {
			return documents.get(docId) ?? null;
		},
		getPostingMatches(field, term) {
			return postings.get(`${field}:${term}`);
		},
		getHanBigramPostingMatches(_scope, field, bigram) {
			return postings.get(`${field}:${bigram}`);
		},
		getBodyHanSegments(docId) {
			return bodyHanSegments.get(docId);
		},
		getMetadataVerificationTexts(docId) {
			const document = documents.get(docId);
			if (!document) {
				return null;
			}
			return {
				basenameText: document.basenameText,
				aliasesText: document.aliasesText,
				headingsText: document.headingsText,
				folderText: document.folderText,
				tagsText: document.tagsText,
			};
		},
		getSortedLexicon() {
			return ["ai", "exam", "plan", "summary"];
		},
		getBodyTokenSequence(docId) {
			return bodyTokenSequences.get(docId);
		},
		async prefetchBodyTokenSequences(_docIds) {},
		tokenizeText(text) {
			return text.toLowerCase().match(/[a-z0-9_-]+/gu) ?? [];
		},
	};
}

describe("coverage lexical v2 independent engine", () => {
	test("searches through the independent v2 engine entry with only storage-boundary inputs", async () => {
		const result = await searchCoverageLexicalV2Engine({
			queryText: "ai exam",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
			fuzzyProportion: 0.2,
			tokenizeQueryText(queryText) {
				return queryText.toLowerCase().match(/[a-z0-9_-]+/gu) ?? [];
			},
			storageReader: createStorageReader(),
		});

		expect(result.queryTerms).toEqual(["ai", "exam"]);
		expect(result.matchedFiles.map((file) => file.path)).toEqual([
			"notes/ai-design.md",
			"notes/exam-summary.md",
			"notes/study-plan.md",
		]);
		expect(result.matchedFiles[0]?.matchedTerms).toEqual(["ai", "exam"]);
	});
});
