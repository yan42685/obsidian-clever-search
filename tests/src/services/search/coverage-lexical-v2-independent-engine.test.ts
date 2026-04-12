import {
	searchCoverageLexicalV2Engine,
	getCoverageLexicalV2CandidateCascadeMatchQuality,
	type CoverageLexicalV2CandidateCascadeStorageReader,
} from "src/services/search/coverage-lexical-v2";

const TEST_LEXICON = ["ai", "exam", "plan", "summary"] as const;

function collectCanonicalLatinPrefixTerms(
	queryTerm: string,
	cap: number,
): readonly string[] {
	if (cap <= 0) {
		return [];
	}
	const matches: string[] = [];
	for (const candidateTerm of TEST_LEXICON) {
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
}

function collectCanonicalLatinFuzzyTerms(
	queryTerm: string,
	cap: number,
	fuzzyProportion: number,
): readonly string[] {
	if (cap <= 0) {
		return [];
	}
	const matches: string[] = [];
	for (const candidateTerm of TEST_LEXICON) {
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
}

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
		getBodyHanSegmentDocIds() {
			return [...bodyHanSegments.entries()]
				.filter(([, segments]) => segments.length > 0)
				.map(([docId]) => docId);
		},
		getPostingMatches(field, term) {
			return postings.get(`${field}:${term}`);
		},
		getMetadataHanBigramPostingMatches(field, bigram) {
			return postings.get(`${field}:${bigram}`);
		},
		getBodyHanBackstopGateStats(docId, bigrams) {
			const segments = bodyHanSegments.get(docId) ?? [];
			if (segments.length === 0 || bigrams.length === 0) {
				return null;
			}
			return {
				longestContiguousBigramChain: 0,
				matchedBigramCount: 0,
				bigramCoverageRatio: 0,
			};
		},
		async prefetchBodyHanExact(docIds, _budget) {
			return {
				fetchedDocIds: [...docIds],
				fetchedDocCount: docIds.length,
				byteSum: 0,
				skippedByBudget: 0,
				skippedReason: "none" as const,
			};
		},
		getBodyHanExactBackstopStats() {
			return null;
		},
		collectLatinPrefixTerms(queryTerm, cap) {
			return collectCanonicalLatinPrefixTerms(queryTerm, cap);
		},
		collectLatinFuzzyTerms(queryTerm, cap, fuzzyProportion) {
			return collectCanonicalLatinFuzzyTerms(
				queryTerm,
				cap,
				fuzzyProportion,
			);
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

