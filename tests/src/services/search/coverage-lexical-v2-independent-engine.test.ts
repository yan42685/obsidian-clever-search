import {
	searchCoverageLexicalV2Engine,
	getCoverageLexicalV2CandidateCascadeMatchQuality,
	type CoverageLexicalV2CandidateCascadeStorageReader,
} from "src/services/search/coverage-lexical-v2";

type TestDocument = {
	docId: number;
	path: string;
	basenameText: string;
	aliasesText?: string;
	headingsText?: string;
	folderText?: string;
	tagsText?: string;
	bodyText?: string;
};

function normalize(text: string): string {
	return text.toLowerCase().normalize("NFKC");
}

function tokenize(text: string): string[] {
	return normalize(text).match(/[a-z0-9_-]+/gu) ?? [];
}

function createStorageReader(config: {
	documents: readonly TestDocument[];
	postings: Readonly<Record<string, readonly number[]>>;
	lexicon: readonly string[];
}): CoverageLexicalV2CandidateCascadeStorageReader {
	const documentMap = new Map(config.documents.map((document) => [document.docId, document] as const));
	const bodyTokenSequences = new Map(
		config.documents.map((document) => [document.docId, tokenize(document.bodyText ?? "")] as const),
	);
	return {
		readerKind: "v2_runtime",
		getDocumentRecord(docId) {
			const document = documentMap.get(docId);
			if (!document) {
				return null;
			}
			return {
				path: document.path,
				stableDeterministicKey: document.path,
				basenameText: document.basenameText,
				aliasesText: document.aliasesText ?? "",
				headingsText: document.headingsText ?? "",
				folderText: document.folderText ?? "",
				tagsText: document.tagsText ?? "",
			};
		},
		getPostingMatches(field, term) {
			return config.postings[`${field}:${term}`];
		},
		getMetadataHanBigramPostingMatches() {
			return undefined;
		},
		getBodyHanBlockPostingMatches() {
			return undefined;
		},
		getBodyHanLogicalBlockDescriptor() {
			return null;
		},
		getBodyHanLogicalBlockIds() {
			return undefined;
		},
		async prefetchBodyHanExactBlocks() {
			return {
				fetchedBlockIds: [],
				fetchedBlockCount: 0,
				byteSum: 0,
				skippedByBudget: 0,
				skippedReason: "none" as const,
				blockResults: [],
			};
		},
		getBodyHanExactBlockBackstopStats() {
			return null;
		},
		getBodyHanExactDocumentWitness() {
			return null;
		},
		collectLatinPrefixTerms(queryTerm, cap) {
			if (cap <= 0) {
				return [];
			}
			const matches: string[] = [];
			for (const candidateTerm of config.lexicon) {
				if (matches.length >= cap) {
					break;
				}
				if (
					getCoverageLexicalV2CandidateCascadeMatchQuality(queryTerm, candidateTerm, {
						includePrefix: true,
					}) === "prefix"
				) {
					matches.push(candidateTerm);
				}
			}
			return matches;
		},
		collectLatinFuzzyTerms(queryTerm, cap, fuzzyProportion) {
			if (cap <= 0) {
				return [];
			}
			const matches: string[] = [];
			for (const candidateTerm of config.lexicon) {
				if (matches.length >= cap) {
					break;
				}
				if (
					getCoverageLexicalV2CandidateCascadeMatchQuality(queryTerm, candidateTerm, {
						includeFuzzy: true,
						fuzzyProportion,
					}) === "fuzzy"
				) {
					matches.push(candidateTerm);
				}
			}
			return matches;
		},
		getBodyTokenSequence(docId) {
			return bodyTokenSequences.get(docId);
		},
		async prefetchBodyTokenSequences(_docIds) {},
		tokenizeText(text) {
			return tokenize(text);
		},
	};
}

describe("coverage lexical v2 independent engine", () => {
	test("searches through the independent v2 engine entry with storage-boundary inputs only", async () => {
		const result = await searchCoverageLexicalV2Engine({
			queryText: "ai exam",
			isPrefixMatch: true,
			isFuzzy: true,
			maxItemResults: 5,
			fuzzyProportion: 0.2,
			tokenizeQueryText(queryText) {
				return tokenize(queryText);
			},
			storageReader: createStorageReader({
				documents: [
					{ docId: 1, path: "notes/ai-design.md", basenameText: "ai", bodyText: "ai exam design" },
					{ docId: 2, path: "notes/exam-summary.md", basenameText: "exam-summary", bodyText: "ai exam summary" },
					{ docId: 3, path: "notes/study-plan.md", basenameText: "study-plan", bodyText: "exam plan" },
				],
				postings: {
					"basename:ai": [1],
					"body:ai": [1, 2],
					"body:exam": [1, 2, 3],
				},
				lexicon: ["ai", "exam", "plan", "summary"],
			}),
		});

		expect(result.queryTerms).toEqual(["ai", "exam"]);
		expect(result.matchedFiles.map((file) => file.path)).toEqual([
			"notes/ai-design.md",
			"notes/exam-summary.md",
		]);
		expect(result.matchedFiles[0]?.matchedTerms).toEqual(["ai", "exam"]);
	});

	test("prefers basename prefix over folder-only prefix for short latin queries", async () => {
		const result = await searchCoverageLexicalV2Engine({
			queryText: "pas",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
			fuzzyProportion: 0.2,
			tokenizeQueryText(queryText) {
				return tokenize(queryText);
			},
			storageReader: createStorageReader({
				documents: [
					{ docId: 1, path: "notes/password.md", basenameText: "password", folderText: "vaults" },
					{ docId: 2, path: "notes/archive.md", basenameText: "misc", folderText: "password-archive" },
				],
				postings: {
					"basename:password": [1],
					"folder:password": [2],
				},
				lexicon: ["password"],
			}),
		});

		expect(result.matchedFiles.map((file) => file.path)).toEqual([
			"notes/password.md",
			"notes/archive.md",
		]);
	});

	test("rescues short metadata prefixes like sec -> security", async () => {
		const result = await searchCoverageLexicalV2Engine({
			queryText: "sec",
			isPrefixMatch: true,
			isFuzzy: false,
			maxItemResults: 5,
			fuzzyProportion: 0.2,
			tokenizeQueryText(queryText) {
				return tokenize(queryText);
			},
			storageReader: createStorageReader({
				documents: [
					{ docId: 1, path: "notes/security.md", basenameText: "security" },
					{ docId: 2, path: "notes/secondary.md", basenameText: "secondary" },
				],
				postings: {
					"basename:security": [1],
					"basename:secondary": [2],
				},
				lexicon: ["security", "secondary"],
			}),
		});

		expect(result.matchedFiles.map((file) => file.path)).toEqual([
			"notes/security.md",
			"notes/secondary.md",
		]);
	});
});
