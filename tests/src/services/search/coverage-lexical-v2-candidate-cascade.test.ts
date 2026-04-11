import {
	buildCoverageLexicalV2QueryAnalysis,
} from "src/services/search/coverage-lexical-v2/query";
import {
	planCoverageLexicalV2CandidateCascadeLayer1Frontier,
	resolveCoverageLexicalV2CandidateCascadePolicy,
	searchCoverageLexicalV2CandidateCascade,
	type CoverageLexicalV2CascadeCandidateState,
	type CoverageLexicalV2CandidateCascadeStorageReader,
} from "src/services/search/coverage-lexical-v2/candidate-cascade";

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
	return normalize(text).match(/[\p{Script=Han}]+|[a-z0-9_-]+/gu) ?? [];
}

function extractHanSegments(text: string): string[] {
	return normalize(text).match(/[\p{Script=Han}]+/gu) ?? [];
}

function extractHanBigrams(text: string): string[] {
	const bigrams: string[] = [];
	const seen = new Set<string>();
	for (const segment of extractHanSegments(text)) {
		const chars = Array.from(segment);
		for (let index = 0; index < chars.length - 1; index += 1) {
			const bigram = chars[index] + chars[index + 1];
			if (seen.has(bigram)) {
				continue;
			}
			seen.add(bigram);
			bigrams.push(bigram);
		}
	}
	return bigrams;
}

function createStorageReader(config: {
	documents: readonly TestDocument[];
	postings: Readonly<Record<string, readonly number[]>>;
	lexicon: readonly string[];
}): {
	reader: CoverageLexicalV2CandidateCascadeStorageReader;
	prefetchBodyTokenSequences: jest.Mock<Promise<void>, [readonly number[]]>;
	getBodyTokenSequence: jest.Mock<readonly string[] | undefined, [number]>;
} {
	const documentMap = new Map(
		config.documents.map((document) => [document.docId, document] as const),
	);
	const bodyTokenSequences = new Map(
		config.documents.map((document) => [document.docId, tokenize(document.bodyText ?? "")] as const),
	);
	const bodyHanSegments = new Map(
		config.documents.map((document) => [document.docId, extractHanSegments(document.bodyText ?? "")] as const),
	);
	const hanBigramPostings = new Map<string, number[]>();
	for (const document of config.documents) {
		const metadataFields = [
			["basename", document.basenameText],
			["aliases", document.aliasesText ?? ""],
			["headings", document.headingsText ?? ""],
			["folder", document.folderText ?? ""],
			["tag", document.tagsText ?? ""],
		] as const;
		for (const [field, text] of metadataFields) {
			for (const bigram of extractHanBigrams(text)) {
				const key = `${field}:${bigram}`;
				const docIds = hanBigramPostings.get(key) ?? [];
				if (!docIds.includes(document.docId)) {
					docIds.push(document.docId);
				}
				hanBigramPostings.set(key, docIds);
			}
		}
		for (const bigram of extractHanBigrams(document.bodyText ?? "")) {
			const key = `body:${bigram}`;
			const docIds = hanBigramPostings.get(key) ?? [];
			if (!docIds.includes(document.docId)) {
				docIds.push(document.docId);
			}
			hanBigramPostings.set(key, docIds);
		}
	}
	const prefetchBodyTokenSequences = jest.fn(async (_docIds: readonly number[]) => {});
	const getBodyTokenSequence = jest.fn((docId: number) => bodyTokenSequences.get(docId));
	return {
		reader: {
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
			getBodyHanSegmentDocIds() {
				return [...bodyHanSegments.entries()]
					.filter(([, segments]) => segments.length > 0)
					.map(([docId]) => docId);
			},
			getPostingMatches(field, term) {
				return config.postings[`${field}:${term}`];
			},
			getMetadataHanBigramPostingMatches(field, bigram) {
				return hanBigramPostings.get(`${field}:${bigram}`);
			},
			getBodyHanSegments(docId) {
				return bodyHanSegments.get(docId);
			},
			collectLatinPrefixTerms(queryTerm, cap) {
				return config.lexicon
					.filter((term) => term.startsWith(queryTerm) && term !== queryTerm)
					.slice(0, cap);
			},
			collectLatinFuzzyTerms(queryTerm, cap, _fuzzyProportion) {
				return config.lexicon
					.filter((term) =>
						term !== queryTerm &&
						term.length >= queryTerm.length &&
						term.slice(1) === queryTerm.slice(1),
					)
					.slice(0, cap);
			},
			getBodyTokenSequence,
			prefetchBodyTokenSequences,
			tokenizeText(text) {
				return tokenize(text);
			},
		},
		prefetchBodyTokenSequences,
		getBodyTokenSequence,
	};
}

function createSyntheticCandidateState(
	docId: number,
	potentialPrimaryCoverageCount: number,
): CoverageLexicalV2CascadeCandidateState {
	return {
		docId,
		path: `notes/${docId}.md`,
		stableDeterministicKey: `notes/${docId}.md`,
		record: {
			path: `notes/${docId}.md`,
			stableDeterministicKey: `notes/${docId}.md`,
			basenameText: `${docId}`,
			aliasesText: "",
			headingsText: "",
			folderText: "",
			tagsText: "",
		},
		fieldTerms: {
			basenameTerms: new Set<string>(),
			aliasTerms: new Set<string>(),
			headingsTerms: new Set<string>(),
			folderTerms: new Set<string>(),
			tagTerms: new Set<string>(),
			bodyTerms: new Set<string>(),
		},
		exactQueryTerms: {
			basenameExactQueryTerms: new Set<string>(),
			aliasExactQueryTerms: new Set<string>(),
			headingsExactQueryTerms: new Set<string>(),
			bodyExactQueryTerms: new Set<string>(),
		},
		exactPrimaryMask: new Set<number>(Array.from({ length: potentialPrimaryCoverageCount }, (_, index) => index)),
		prefixPrimaryMask: new Set<number>(),
		fuzzyPrimaryMask: new Set<number>(),
		matchedGroupMask: new Set<number>(),
		matchedLatinGroupMask: new Set<number>(),
		matchedHanGroupMask: new Set<number>(),
		bestFieldByPrimaryUnit: new Map(),
		corroboratedFieldMaskByPrimaryUnit: new Map(),
		sourceFlags: {
			hasExact: potentialPrimaryCoverageCount > 0,
			hasPrefix: false,
			hasFuzzy: false,
			hasFallback: false,
			hasHanBackstop: false,
			hasMetadata: false,
			hasBody: false,
			hasBodyExact: false,
		},
		needsVerification: false,
		hydrationStatus: "not_requested",
		prefetchedBodyTokenSequence: undefined,
		potentialPrimaryCoverageCount,
		fuzzySalvageCoverageCount: 0,
		hanFallbackSalvageGroupCount: 0,
		matchedFieldsByPrimaryUnit: new Map(),
		bestQualityByPrimaryUnit: new Map(),
		fallbackMatchedSurfaceGroups: new Set<number>(),
	};
}

describe("coverage lexical v2 cascade", () => {
	test("keeps exact candidate sourcing exhaustive and preserves exact top results", async () => {
		const { reader } = createStorageReader({
			documents: [
				{ docId: 1, path: "notes/alpha-beta.md", basenameText: "alpha beta" },
				{ docId: 2, path: "notes/alpha.md", basenameText: "alpha" },
				{ docId: 3, path: "notes/beta.md", basenameText: "beta" },
				{ docId: 4, path: "notes/alpha-beta-body.md", basenameText: "misc", bodyText: "alpha beta" },
			],
			postings: {
				"basename:alpha": [1, 2],
				"basename:beta": [1, 3],
				"body:alpha": [4],
				"body:beta": [4],
			},
			lexicon: ["alpha", "beta"],
		});
		const queryText = "alpha beta";
		const queryTerms = ["alpha", "beta"];

		const result = await searchCoverageLexicalV2CandidateCascade({
			queryText,
			queryTerms,
			queryAnalysis: buildCoverageLexicalV2QueryAnalysis(queryText, queryTerms),
			maxItemResults: 2,
			storageReader: reader,
			matchOptions: {},
		});

		expect(result.candidateStates.map((candidateState) => candidateState.path)).toEqual([
			"notes/alpha-beta-body.md",
			"notes/alpha-beta.md",
			"notes/alpha.md",
			"notes/beta.md",
		]);
		expect(result.matchedFiles.map((matchedFile) => matchedFile.path)).toEqual([
			"notes/alpha-beta.md",
			"notes/alpha-beta-body.md",
		]);
	});

	test("counts latin exact and prefix in layer1 while keeping latin fuzzy out of the normal frontier", async () => {
		const { reader } = createStorageReader({
			documents: [
				{ docId: 1, path: "notes/cache.md", basenameText: "cache" },
				{ docId: 2, path: "notes/cached.md", basenameText: "cached" },
				{ docId: 3, path: "notes/cace.md", basenameText: "cace" },
			],
			postings: {
				"basename:cache": [1],
				"basename:cached": [2],
				"basename:cace": [3],
			},
			lexicon: ["cace", "cache", "cached"],
		});
		const queryText = "cache";
		const queryTerms = ["cache"];

		const result = await searchCoverageLexicalV2CandidateCascade({
			queryText,
			queryTerms,
			queryAnalysis: buildCoverageLexicalV2QueryAnalysis(queryText, queryTerms),
			maxItemResults: 5,
			storageReader: reader,
			matchOptions: {
				includePrefix: true,
				includeFuzzy: true,
				fuzzyProportion: 0.4,
			},
		});

		expect(result.usedFuzzySalvage).toBe(false);
		expect(result.candidateStates.map((candidateState) => ({
			path: candidateState.path,
			potential: candidateState.potentialPrimaryCoverageCount,
			fuzzy: candidateState.fuzzySalvageCoverageCount,
		}))).toEqual([
			{ path: "notes/cace.md", potential: 0, fuzzy: 1 },
			{ path: "notes/cache.md", potential: 1, fuzzy: 0 },
			{ path: "notes/cached.md", potential: 1, fuzzy: 0 },
		]);
		expect(result.activeFrontierCandidateIds).toEqual(expect.arrayContaining(["1", "2"]));
		expect(result.activeFrontierCandidateIds).not.toContain("3");
		expect(result.matchedFiles.map((matchedFile) => matchedFile.path)).toEqual([
			"notes/cache.md",
			"notes/cached.md",
		]);
	});

	test("uses fuzzy salvage only when exact and prefix coverage are both absent", async () => {
		const { reader } = createStorageReader({
			documents: [
				{ docId: 1, path: "notes/cache.md", basenameText: "cache" },
			],
			postings: {
				"basename:cache": [1],
			},
			lexicon: ["cache"],
		});
		const queryText = "cahce";
		const queryTerms = ["cahce"];

		const result = await searchCoverageLexicalV2CandidateCascade({
			queryText,
			queryTerms,
			queryAnalysis: buildCoverageLexicalV2QueryAnalysis(queryText, queryTerms),
			maxItemResults: 5,
			storageReader: reader,
			matchOptions: {
				includePrefix: true,
				includeFuzzy: true,
				fuzzyProportion: 0.4,
			},
		});

		expect(result.usedFuzzySalvage).toBe(true);
		expect(result.matchedFiles.map((matchedFile) => matchedFile.path)).toEqual([
			"notes/cache.md",
		]);
	});

	test("keeps lower layer1 buckets deferred when the frontier is already full", () => {
		const candidates = [
			createSyntheticCandidateState(1, 2),
			createSyntheticCandidateState(2, 2),
			createSyntheticCandidateState(3, 1),
			createSyntheticCandidateState(4, 1),
			createSyntheticCandidateState(5, 1),
		];

		const plan = planCoverageLexicalV2CandidateCascadeLayer1Frontier(candidates, false, false, {
			...resolveCoverageLexicalV2CandidateCascadePolicy(1),
			frontierTarget: 2,
		});

		expect(plan.activeFrontier.map((candidateState) => candidateState.docId)).toEqual([1, 2]);
		expect(plan.deferredBuckets.flat().map((candidateState) => candidateState.docId)).toEqual([
			3,
			4,
			5,
		]);
	});

	test("keeps complete layer3 buckets and re-enters deferred buckets when returnTarget needs them", async () => {
		const { reader } = createStorageReader({
			documents: [
				{ docId: 1, path: "notes/basename-1.md", basenameText: "cache" },
				{ docId: 2, path: "notes/basename-2.md", basenameText: "cache" },
				{ docId: 3, path: "notes/aliases-1.md", basenameText: "misc", aliasesText: "cache" },
				{ docId: 4, path: "notes/aliases-2.md", basenameText: "misc", aliasesText: "cache" },
				{ docId: 5, path: "notes/headings-1.md", basenameText: "misc", headingsText: "cache" },
				{ docId: 6, path: "notes/body-1.md", basenameText: "misc", bodyText: "cache" },
				{ docId: 7, path: "notes/body-2.md", basenameText: "misc", bodyText: "cache" },
			],
			postings: {
				"basename:cache": [1, 2],
				"aliases:cache": [3, 4],
				"headings:cache": [5],
				"body:cache": [6, 7],
			},
			lexicon: ["cache"],
		});

		const result = await searchCoverageLexicalV2CandidateCascade({
			queryText: "cache",
			queryTerms: ["cache"],
			queryAnalysis: buildCoverageLexicalV2QueryAnalysis("cache", ["cache"]),
			maxItemResults: 2,
			storageReader: reader,
			matchOptions: {},
		});

		expect(result.trace.retainedCandidateIdsByLayer.layer3).toEqual([
			"1",
			"2",
			"3",
			"4",
			"5",
			"6",
			"7",
		]);
		expect(result.trace.deferredCandidateIdsByLayer.layer3).toEqual([]);
	});

	test("keeps complete layer4 buckets instead of cutting prefix ties in half", async () => {
		const { reader } = createStorageReader({
			documents: [
				{ docId: 1, path: "notes/exact-1.md", basenameText: "cache" },
				{ docId: 2, path: "notes/exact-2.md", basenameText: "cache" },
				{ docId: 3, path: "notes/prefix-1.md", basenameText: "cached" },
				{ docId: 4, path: "notes/prefix-2.md", basenameText: "cached" },
				{ docId: 5, path: "notes/prefix-3.md", basenameText: "cached" },
				{ docId: 6, path: "notes/prefix-4.md", basenameText: "cached" },
			],
			postings: {
				"basename:cache": [1, 2],
				"basename:cached": [3, 4, 5, 6],
			},
			lexicon: ["cache", "cached"],
		});

		const result = await searchCoverageLexicalV2CandidateCascade({
			queryText: "cache",
			queryTerms: ["cache"],
			queryAnalysis: buildCoverageLexicalV2QueryAnalysis("cache", ["cache"]),
			maxItemResults: 1,
			storageReader: reader,
			matchOptions: {
				includePrefix: true,
			},
		});

		expect(result.trace.retainedCandidateIdsByLayer.layer4).toEqual([
			"1",
			"2",
			"3",
			"4",
			"5",
			"6",
		]);
		expect(result.trace.deferredCandidateIdsByLayer.layer4).toEqual([]);
	});

	test("uses the Han backstop to admit a verified metadata hit without promoting one-sided metadata noise", async () => {
		const queryText = "赢宋";
		const { reader } = createStorageReader({
			documents: [
				{ docId: 1, path: "notes/win-song.md", basenameText: "关于赢宋的笔记" },
				{ docId: 2, path: "notes/win-only.md", basenameText: "赢学条目" },
			],
			postings: {},
			lexicon: [],
		});

		const result = await searchCoverageLexicalV2CandidateCascade({
			queryText,
			queryTerms: [],
			queryAnalysis: buildCoverageLexicalV2QueryAnalysis(queryText, []),
			maxItemResults: 5,
			storageReader: reader,
			matchOptions: {},
		});

		expect(result.candidateStates.map((candidateState) => ({
			path: candidateState.path,
			hasHanBackstop: candidateState.sourceFlags.hasHanBackstop,
			potential: candidateState.potentialPrimaryCoverageCount,
		}))).toEqual([
			{ path: "notes/win-song.md", hasHanBackstop: true, potential: 1 },
		]);
		expect(result.matchedFiles.map((matchedFile) => matchedFile.path)).toEqual([
			"notes/win-song.md",
		]);
	});

	test("uses the Han backstop to recover a fragile-covered body hit when tokenizer exact recall is empty", async () => {
		const queryText = "委员长";
		const { reader } = createStorageReader({
			documents: [
				{ docId: 1, path: "notes/chairperson.md", basenameText: "misc", bodyText: "委员长大" },
				{ docId: 2, path: "notes/member.md", basenameText: "misc", bodyText: "委员会记录" },
			],
			postings: {},
			lexicon: [],
		});

		const result = await searchCoverageLexicalV2CandidateCascade({
			queryText,
			queryTerms: [queryText],
			queryAnalysis: buildCoverageLexicalV2QueryAnalysis(queryText, [queryText]),
			maxItemResults: 5,
			storageReader: reader,
			matchOptions: {},
		});

		expect(result.candidateStates.map((candidateState) => ({
			path: candidateState.path,
			hasHanBackstop: candidateState.sourceFlags.hasHanBackstop,
			hasBody: candidateState.sourceFlags.hasBody,
			potential: candidateState.potentialPrimaryCoverageCount,
		}))).toEqual([
			{ path: "notes/chairperson.md", hasHanBackstop: true, hasBody: true, potential: 1 },
		]);
		expect(result.matchedFiles.map((matchedFile) => matchedFile.path)).toEqual([
			"notes/chairperson.md",
		]);
	});

	test("filters bigram-only false positives unless one normalized field or Han segment contains the full query", async () => {
		const queryText = "生命力";
		const { reader } = createStorageReader({
			documents: [
				{ docId: 1, path: "notes/fake-life-force.md", basenameText: "生命和命力" },
				{ docId: 2, path: "notes/real-life-force.md", basenameText: "生命力" },
			],
			postings: {},
			lexicon: [],
		});

		const result = await searchCoverageLexicalV2CandidateCascade({
			queryText,
			queryTerms: [queryText],
			queryAnalysis: buildCoverageLexicalV2QueryAnalysis(queryText, [queryText]),
			maxItemResults: 5,
			storageReader: reader,
			matchOptions: {},
		});

		expect(result.candidateStates.map((candidateState) => candidateState.path)).toEqual([
			"notes/real-life-force.md",
		]);
		expect(result.matchedFiles.map((matchedFile) => matchedFile.path)).toEqual([
			"notes/real-life-force.md",
		]);
	});

	test("tracks Han promotion trace and only lets promoted Han exact evidence reach layer1", async () => {
		const queryText = "\u59d4\u5458\u957f";
		const { reader } = createStorageReader({
			documents: [
				{
					docId: 1,
					path: "notes/chairperson.md",
					basenameText: "misc",
					bodyText: "\u59d4\u5458\u957f\u5927",
				},
				{
					docId: 2,
					path: "notes/member.md",
					basenameText: "misc",
					bodyText: "\u59d4\u5458\u4f1a\u8bb0\u5f55",
				},
			],
			postings: {},
			lexicon: [],
		});

		const result = await searchCoverageLexicalV2CandidateCascade({
			queryText,
			queryTerms: [queryText],
			queryAnalysis: buildCoverageLexicalV2QueryAnalysis(queryText, [queryText]),
			maxItemResults: 5,
			storageReader: reader,
			matchOptions: {},
		});

		expect(result.candidateStates.map((candidateState) => ({
			path: candidateState.path,
			potential: candidateState.potentialPrimaryCoverageCount,
		}))).toEqual([
			{ path: "notes/chairperson.md", potential: 1 },
		]);
		expect(result.trace.pendingHanFrontierCount).toBe(1);
		expect(result.trace.hanPromotedCount).toBe(1);
		expect(result.trace.hanPromotionVerifiedCount).toBe(0);
		expect(result.trace.bodyHanScanDocCount).toBe(2);
		expect(result.trace.bodyHanScanMatchedDocCount).toBe(1);
		expect(result.trace.hanPromotionSkippedReason).toBe("none");
	});

	test("hydrates body tokens only for the late verification frontier", async () => {
		const documents = Array.from({ length: 8 }, (_, index) => ({
			docId: index + 1,
			path: `notes/body-${index + 1}.md`,
			basenameText: `body-${index + 1}`,
			bodyText: "alpha beta",
		}));
		const { reader, prefetchBodyTokenSequences, getBodyTokenSequence } = createStorageReader({
			documents,
			postings: {
				"body:alpha": documents.map((document) => document.docId),
				"body:beta": documents.map((document) => document.docId),
			},
			lexicon: ["alpha", "beta"],
		});
		const queryText = "alpha beta";
		const queryTerms = ["alpha", "beta"];

		const result = await searchCoverageLexicalV2CandidateCascade({
			queryText,
			queryTerms,
			queryAnalysis: buildCoverageLexicalV2QueryAnalysis(queryText, queryTerms),
			maxItemResults: 1,
			storageReader: reader,
			matchOptions: {},
		});

		expect(result.verificationCandidateIds).toHaveLength(8);
		expect(result.trace.verificationSkippedReason).toBe("none");
		expect(prefetchBodyTokenSequences).toHaveBeenCalledTimes(1);
		expect(prefetchBodyTokenSequences).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(getBodyTokenSequence).toHaveBeenCalledTimes(8);
	});

	test("skips late verification when the highest unresolved bucket exceeds the overflow cap", async () => {
		const documents = Array.from({ length: 13 }, (_, index) => ({
			docId: index + 1,
			path: `notes/overflow-${index + 1}.md`,
			basenameText: `overflow-${index + 1}`,
			bodyText: "alpha beta",
		}));
		const { reader, prefetchBodyTokenSequences, getBodyTokenSequence } = createStorageReader({
			documents,
			postings: {
				"body:alpha": documents.map((document) => document.docId),
				"body:beta": documents.map((document) => document.docId),
			},
			lexicon: ["alpha", "beta"],
		});

		const result = await searchCoverageLexicalV2CandidateCascade({
			queryText: "alpha beta",
			queryTerms: ["alpha", "beta"],
			queryAnalysis: buildCoverageLexicalV2QueryAnalysis("alpha beta", ["alpha", "beta"]),
			maxItemResults: 1,
			storageReader: reader,
			matchOptions: {},
		});

		expect(result.verificationCandidateIds).toHaveLength(13);
		expect(result.trace.verificationSkippedReason).toBe("overflow");
		expect(prefetchBodyTokenSequences).not.toHaveBeenCalled();
		expect(getBodyTokenSequence).not.toHaveBeenCalled();
	});
});
