import {
	buildCoverageLexicalV2QueryAnalysis,
} from "src/services/search/coverage-lexical-v2/query-units";
import {
	planCoverageLexicalV2RuntimeCascadeLayer1Frontier,
	resolveCoverageLexicalV2RuntimeCascadePolicy,
	searchCoverageLexicalV2RuntimeCascade,
	type CoverageLexicalV2CascadeCandidateState,
	type CoverageLexicalV2RuntimeStorageReader,
} from "src/services/search/coverage-lexical-v2/runtime";

type TestDocument = {
	docId: number;
	path: string;
	basenameText: string;
	aliasesText?: string;
	headingsText?: string;
	bodyText?: string;
};

function normalize(text: string): string {
	return text.toLowerCase().normalize("NFKC");
}

function tokenize(text: string): string[] {
	return normalize(text).match(/[\p{Script=Han}]+|[a-z0-9_-]+/gu) ?? [];
}

function createStorageReader(config: {
	documents: readonly TestDocument[];
	postings: Readonly<Record<string, readonly number[]>>;
	lexicon: readonly string[];
}): {
	reader: CoverageLexicalV2RuntimeStorageReader;
	prefetchBodyTokenSequences: jest.Mock<Promise<void>, [readonly number[]]>;
	getBodyTokenSequence: jest.Mock<readonly string[] | undefined, [number]>;
} {
	const documentMap = new Map(
		config.documents.map((document) => [document.docId, document] as const),
	);
	const bodyTokenSequences = new Map(
		config.documents.map((document) => [document.docId, tokenize(document.bodyText ?? "")] as const),
	);
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
				};
			},
			getPostingMatches(field, term) {
				return config.postings[`${field}:${term}`];
			},
			getSortedLexicon() {
				return [...config.lexicon];
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
			hasMetadata: false,
			hasBody: false,
			hasBodyExact: false,
		},
		needsVerification: false,
		hydrationStatus: "not_requested",
		potentialPrimaryCoverageCount,
		fuzzySalvageCoverageCount: 0,
		matchedFieldsByPrimaryUnit: new Map(),
		bestQualityByPrimaryUnit: new Map(),
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

		const result = await searchCoverageLexicalV2RuntimeCascade({
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

		const result = await searchCoverageLexicalV2RuntimeCascade({
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

		const result = await searchCoverageLexicalV2RuntimeCascade({
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

		const plan = planCoverageLexicalV2RuntimeCascadeLayer1Frontier(candidates, false, {
			...resolveCoverageLexicalV2RuntimeCascadePolicy(1),
			frontierTarget: 2,
		});

		expect(plan.activeFrontier.map((candidateState) => candidateState.docId)).toEqual([1, 2]);
		expect(plan.deferredBuckets.flat().map((candidateState) => candidateState.docId)).toEqual([
			3,
			4,
			5,
		]);
	});

	test("allows fallback discovery to source documents without letting fallback-only docs survive as primary winners", async () => {
		const { reader } = createStorageReader({
			documents: [
				{ docId: 1, path: "notes/politics-theory.md", basenameText: "政治理论" },
				{ docId: 2, path: "notes/politics-only.md", basenameText: "政治" },
			],
			postings: {
				"basename:政治理论": [1],
				"basename:政治": [2],
			},
			lexicon: ["政治", "政治理论"],
		});
		const queryText = "政治理论";
		const queryTerms = ["政治理论"];

		const result = await searchCoverageLexicalV2RuntimeCascade({
			queryText,
			queryTerms,
			queryAnalysis: buildCoverageLexicalV2QueryAnalysis(queryText, queryTerms),
			maxItemResults: 5,
			storageReader: reader,
			matchOptions: {},
		});

		expect(result.candidateStates.map((candidateState) => ({
			path: candidateState.path,
			hasFallback: candidateState.sourceFlags.hasFallback,
			potential: candidateState.potentialPrimaryCoverageCount,
		}))).toEqual([
			{ path: "notes/politics-only.md", hasFallback: true, potential: 0 },
			{ path: "notes/politics-theory.md", hasFallback: false, potential: 1 },
		]);
		expect(result.matchedFiles.map((matchedFile) => matchedFile.path)).toEqual([
			"notes/politics-theory.md",
		]);
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

		const result = await searchCoverageLexicalV2RuntimeCascade({
			queryText,
			queryTerms,
			queryAnalysis: buildCoverageLexicalV2QueryAnalysis(queryText, queryTerms),
			maxItemResults: 1,
			storageReader: reader,
			matchOptions: {},
		});

		expect(result.verificationCandidateIds).toHaveLength(6);
		expect(prefetchBodyTokenSequences).toHaveBeenCalledTimes(1);
		expect(prefetchBodyTokenSequences).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6]);
		expect(getBodyTokenSequence).toHaveBeenCalledTimes(6);
	});
});
