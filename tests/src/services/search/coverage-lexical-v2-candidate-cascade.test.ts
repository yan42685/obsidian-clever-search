import {
	buildCoverageLexicalV2QueryAnalysis,
} from "src/services/search/coverage-lexical-v2/query";
import {
	getCoverageLexicalV2CandidateCascadeMatchQuality,
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

function computeHanBackstopGateStats(
	segments: readonly string[] | undefined,
	bigrams: readonly string[],
) {
	if (!segments || segments.length === 0 || bigrams.length === 0) {
		return null;
	}
	let best:
		| {
				longestContiguousBigramChain: number;
				matchedBigramCount: number;
				bigramCoverageRatio: number;
		  }
		| null = null;
	for (const segment of segments) {
		const matched = new Set<number>();
		for (let index = 0; index < bigrams.length; index += 1) {
			if (segment.includes(bigrams[index])) {
				matched.add(index);
			}
		}
		if (matched.size === 0) {
			continue;
		}
		const sorted = [...matched].sort((left, right) => left - right);
		let longest = 0;
		let current = 0;
		let previous = Number.NaN;
		for (const bigramIndex of sorted) {
			if (!Number.isFinite(previous) || bigramIndex === previous + 1) {
				current += 1;
			} else {
				current = 1;
			}
			longest = Math.max(longest, current);
			previous = bigramIndex;
		}
		const stats = {
			longestContiguousBigramChain: longest,
			matchedBigramCount: matched.size,
			bigramCoverageRatio: matched.size / bigrams.length,
		};
		if (
			!best ||
			stats.longestContiguousBigramChain > best.longestContiguousBigramChain ||
			(
				stats.longestContiguousBigramChain === best.longestContiguousBigramChain &&
				stats.matchedBigramCount > best.matchedBigramCount
			)
		) {
			best = stats;
		}
	}
	return best;
}

function computeHanBackstopExactStats(
	segments: readonly string[] | undefined,
	normalizedText: string,
	bigrams: readonly string[],
) {
	if (!segments || segments.length === 0) {
		return null;
	}
	for (const segment of segments) {
		if (segment.includes(normalizedText)) {
			return {
				longestContiguousBigramChain: bigrams.length,
				matchedBigramCount: bigrams.length,
				bigramCoverageRatio: bigrams.length > 0 ? 1 : 0,
			};
		}
	}
	return null;
}

function collectCanonicalLatinPrefixTerms(
	lexicon: readonly string[],
	queryTerm: string,
	cap: number,
): readonly string[] {
	if (cap <= 0) {
		return [];
	}
	const matches: string[] = [];
	for (const candidateTerm of lexicon) {
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
	lexicon: readonly string[],
	queryTerm: string,
	cap: number,
	fuzzyProportion: number,
): readonly string[] {
	if (cap <= 0) {
		return [];
	}
	const matches: string[] = [];
	for (const candidateTerm of lexicon) {
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

function createStorageReader(config: {
	documents: readonly TestDocument[];
	postings: Readonly<Record<string, readonly number[]>>;
	lexicon: readonly string[];
}): {
	reader: CoverageLexicalV2CandidateCascadeStorageReader;
	prefetchBodyTokenSequences: jest.Mock<Promise<void>, [readonly number[]]>;
	getBodyTokenSequence: jest.Mock<readonly string[] | undefined, [number]>;
	prefetchBodyHanExact: jest.Mock<Promise<any>, [readonly number[]]>;
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
	const prefetchBodyHanExact = jest.fn(async (docIds: readonly number[]) => ({
		fetchedDocIds: [...docIds],
		fetchedDocCount: docIds.length,
		byteSum: docIds.reduce(
			(sum, docId) =>
				sum +
				(bodyHanSegments.get(docId)?.reduce(
					(inner, segment) => inner + Array.from(segment).length * 4,
					0,
				) ?? 0),
			0,
		),
		skippedByBudget: 0,
		skippedReason: "none" as const,
	}));
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
			getPostingMatches(field, term) {
				return config.postings[`${field}:${term}`];
			},
			getMetadataHanBigramPostingMatches(field, bigram) {
				return hanBigramPostings.get(`${field}:${bigram}`);
			},
			getBodyHanBlockPostingMatches(bigram) {
				return hanBigramPostings.get(`body:${bigram}`);
			},
			getBodyHanLogicalBlockDescriptor(blockId) {
				const document = documentMap.get(blockId);
				const segments = bodyHanSegments.get(blockId) ?? [];
				if (!document || segments.length === 0) {
					return null;
				}
				return {
					blockId,
					docId: blockId,
					path: document.path,
					blockOrdinal: 0,
					segmentCount: segments.length,
					symbolCount: segments.reduce(
						(sum, segment) => sum + Array.from(segment).length,
						0,
					),
					encodedByteLength: segments.reduce(
						(sum, segment) => sum + Array.from(segment).length * 4,
						0,
					),
				};
			},
			prefetchBodyHanExactBlocks(blockIds, _budget) {
				return prefetchBodyHanExact(blockIds).then((prefetch) => ({
					fetchedBlockIds: prefetch.fetchedDocIds,
					fetchedBlockCount: prefetch.fetchedDocCount,
					byteSum: prefetch.byteSum,
					skippedByBudget: prefetch.skippedByBudget,
					skippedReason:
						prefetch.skippedReason === "doc_budget"
							? "block_budget"
							: prefetch.skippedReason,
					blockResults: (prefetch.docResults ?? []).map((docResult: any) => ({
						blockId: docResult.docId,
						docId: docResult.docId,
						path: docResult.path,
						blockOrdinal: 0,
						status:
							docResult.status === "doc_budget"
								? "block_budget"
								: docResult.status === "zero_segment_count"
									? "zero_symbol_count"
									: docResult.status,
						estimatedBytes: docResult.estimatedBytes,
						segmentCount: docResult.segmentCount,
						symbolCount: null,
					})),
				}));
			},
			getBodyHanExactBlockBackstopStats(blockId, normalizedText, bigrams) {
				return computeHanBackstopExactStats(
					bodyHanSegments.get(blockId),
					normalizedText,
					bigrams,
				);
			},
			collectLatinPrefixTerms(queryTerm, cap) {
				return collectCanonicalLatinPrefixTerms(config.lexicon, queryTerm, cap);
			},
			collectLatinFuzzyTerms(queryTerm, cap, fuzzyProportion) {
				return collectCanonicalLatinFuzzyTerms(
					config.lexicon,
					queryTerm,
					cap,
					fuzzyProportion,
				);
			},
			getBodyTokenSequence,
			prefetchBodyTokenSequences,
			tokenizeText(text) {
				return tokenize(text);
			},
		},
		prefetchBodyTokenSequences,
		getBodyTokenSequence,
		prefetchBodyHanExact,
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
		const queryText = "\u59d4\u5458";
		const { reader } = createStorageReader({
			documents: [
				{ docId: 1, path: "notes/committee-note.md", basenameText: "note \u59d4\u5458 entry" },
				{ docId: 2, path: "notes/committee-noise.md", basenameText: "\u59d4\u4f1a\u62c6\u5f00\u8bb0\u5f55" },
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
			{ path: "notes/committee-note.md", hasHanBackstop: true, potential: 1 },
		]);
		expect(result.matchedFiles.map((matchedFile) => matchedFile.path)).toEqual([
			"notes/committee-note.md",
		]);
	});

	test("uses the Han backstop to recover a fragile-covered body hit when tokenizer exact recall is empty", async () => {
		const queryText = "\u59d4\u5458\u957f";
		const { reader } = createStorageReader({
			documents: [
				{ docId: 1, path: "notes/chairperson.md", basenameText: "misc", bodyText: "\u59d4\u5458\u957f\u5927" },
				{ docId: 2, path: "notes/member.md", basenameText: "misc", bodyText: "\u59d4\u5458\u4f1a\u8bb0\u5f55" },
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
		const queryText = "\u751f\u547d\u529b";
		const { reader } = createStorageReader({
			documents: [
				{ docId: 1, path: "notes/fake-life-force.md", basenameText: "\u751f\u547d\u548c\u547d\u529b" },
				{ docId: 2, path: "notes/real-life-force.md", basenameText: "\u751f\u547d\u529b" },
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
		expect(result.trace.hanPromotionDocCount).toBe(1);
		expect(result.trace.hanPromotionVerifiedDocCount).toBe(0);
		expect(result.trace.bodyHanCandidateBlockCount).toBe(1);
		expect(result.trace.bodyHanIntersectedBlockCount).toBe(1);
		expect(result.trace.bodyHanColdExactRequestedBlockCount).toBe(1);
		expect(result.trace.bodyHanColdExactFetchedBlockCount).toBe(1);
		expect(result.trace.bodyHanColdExactSkippedReason).toBe("none");
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
