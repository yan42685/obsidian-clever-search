import { innerSetting, OuterSetting } from "src/globals/plugin-setting";
import type {
	FileSubItem,
	IndexedDocument,
	MatchedFile,
} from "src/globals/search-types";
import { FileUtil } from "src/utils/file-util";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { container, singleton } from "tsyringe";
import type {
	FileSearchEngine,
	FileSearchRequest,
	SerializedCoverageLexicalBinarySnapshot,
	SerializedFileSearchIndex,
} from "../file-search-engine";
import { FileSnapshotStore } from "../shared/file-snapshot-store";
import { Tokenizer } from "../tokenizer";
import {
	buildCoverageLexicalPassageAdmissionSignal,
	compareCoverageLexicalPassageAdmissionSignals,
} from "./coverage-lexical-admission";
import {
	buildCoverageLexicalBodyEvidenceTrace,
	type CoverageLexicalBodyEvidenceTrace,
} from "./coverage-lexical-body-evidence";
import type {
	CoverageLexicalBodyTokenColdDocumentWrite,
	CoverageLexicalBodyTokenColdStoreApi,
} from "./coverage-lexical-body-token-cold-types";
import {
	COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN,
} from "./coverage-lexical-body-token-cold-types";
import {
	buildCoverageLexicalPhraseSignatures,
	buildCoverageLexicalStructuredMetadataSignatures,
} from "./coverage-lexical-bridge";
import {
	buildCoverageLexicalCharQuery,
	evaluateCoverageLexicalTagFallback,
	extractHanBigrams,
	extractHanSegments,
	splitCoverageLexicalTagValues,
	type CoverageLexicalCharQuery,
} from "./coverage-lexical-cjk";
import {
	COVERAGE_LEXICAL_IDENTITY_FIELD_CONFIDENCE,
	createEmptyCoverageLexicalEvidenceMassSummary,
} from "./coverage-lexical-evidence";
import {
	buildCoverageLexicalWindowFusionSignal,
	createEmptyCoverageLexicalWindowFusionSignal,
} from "./coverage-lexical-fusion";
import {
	CoverageLexicalSharedStringPostingMap,
	CoverageLexicalSharedTokenIdPostingMap,
	isCoverageLexicalSharedPackedPostingMap,
	type CoverageLexicalSharedPackedPostingMap,
} from "./coverage-lexical-live-posting-store";
import { buildCoverageLexicalPlan } from "./coverage-lexical-planner";
import {
	COVERAGE_LEXICAL_LIVE_POSTING_DESCRIPTOR_BY_KEY,
	COVERAGE_LEXICAL_LIVE_POSTING_DESCRIPTORS,
	type CoverageLexicalLivePostingKey,
	type CoverageLexicalPostingOwnership,
} from "./coverage-lexical-posting-layout";
import {
	compareCoverageLexicalResultSignals,
} from "./coverage-lexical-ranker";
import {
	collectCoverageLexicalCandidateStatesByDocId,
	resolveHydratedCoverageLexicalCandidateState,
	type CoverageLexicalLaneEvaluateBenchmarkSubphaseName,
	type CoverageLexicalRecallBenchmarkSubphaseName,
} from "./coverage-lexical-recall";
import { buildCoverageLexicalPairSignatures } from "./coverage-lexical-signatures";
import {
	decodeCoverageLexicalSnapshotV1,
	encodeCoverageLexicalSnapshotV1,
	type CoverageLexicalSnapshotState,
} from "./coverage-lexical-snapshot";
import type {
	CoverageFamilyMatchKind,
	CoverageLexicalAreaSignal,
	CoverageLexicalCandidateState,
	CoverageLexicalCoverageProfile,
	CoverageLexicalEvidenceMassSummary,
	CoverageLexicalFamily,
	CoverageLexicalFamilyProbe,
	CoverageLexicalFamilyScriptClass,
	CoverageLexicalFamilySignal,
	CoverageLexicalFamilyTier,
	CoverageLexicalMetadataField,
	CoverageLexicalMetadataIdentitySignal,
	CoverageLexicalPairSignature,
	CoverageLexicalPhraseSignature,
	CoverageLexicalPlan,
	CoverageLexicalPrefixWitness,
	CoverageLexicalResourceHints,
} from "./coverage-lexical-types";
import { buildDirectSubitemsExactFileSubItems } from "./direct-subitems";

const COVERAGE_LEXICAL_BODY_TOKEN_OFFLOAD_ENV =
	"COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD";
const COVERAGE_LEXICAL_RECALL_BODY_TOKEN_PREFETCH_DOC_BUDGET = 96;
const COVERAGE_LEXICAL_OFFLOADED_BODY_TOKEN_HOT_CACHE_LIMIT = 24;
const COVERAGE_LEXICAL_OFFLOAD_HYDRATION_TIE_LOOKAHEAD = 24;
const COVERAGE_LEXICAL_OFFLOAD_UNRESOLVED_HYDRATION_LOOKAHEAD = 48;
const COVERAGE_LEXICAL_OFFLOAD_UNRESOLVED_HYDRATION_BUDGET = 12;
const COVERAGE_LEXICAL_COARSE_HYDRATION_PASSAGE_UPPER_BOUND = 0.9;
const COVERAGE_LEXICAL_COARSE_HYDRATION_PHRASE_UPPER_BOUND = 0.7;
const COVERAGE_LEXICAL_COARSE_HYDRATION_PREFIX_UPPER_BOUND = 0.55;
const COVERAGE_LEXICAL_COARSE_HYDRATION_CHAR_UPPER_BOUND = 0.25;
const COVERAGE_LEXICAL_COARSE_HYDRATION_REQUIRED_FAMILY_UPPER_BOUND = 0.8;
const COVERAGE_LEXICAL_COARSE_HYDRATION_SUPPORT_FAMILY_UPPER_BOUND = 0.35;
const COVERAGE_LEXICAL_COARSE_HYDRATION_CROSS_SCRIPT_UPPER_BOUND = 0.45;
const COVERAGE_LEXICAL_SOFT_EARLY_GATE_RATIO = 0.75;
const COVERAGE_LEXICAL_QUERY_ONLY_HAN_FUNCTION_WORD_REGEX =
	/(?:关于|有关|对于|什么是|什么叫|如何|怎么|为什么|以及|及|与|和|的|地|得|并且|并|中|里|上|下|将|要|会|吗|呢)/gu;

function isCoverageLexicalExperimentalBodyTokenOffloadEnabled(): boolean {
	const raw = process.env[COVERAGE_LEXICAL_BODY_TOKEN_OFFLOAD_ENV]?.trim();
	if (!raw) {
		return true;
	}
	return raw !== "0" && raw.toLowerCase() !== "false";
}

type CoverageLexicalDocument = {
	docId: number;
	generation?: number;
	basenameText: string;
	folderText: string;
	aliasesText: string;
	tagsText: string;
	headingsText: string;
};

type CoverageLexicalDocumentTextFields = {
	basenameText: string;
	folderText: string;
	aliasesText: string;
	tagsText: string;
	headingsText: string;
};

type CoverageLexicalTokenRange = {
	start: number;
	end: number;
};

type CoverageLexicalDerivedDocumentIndexState = {
	bodyTokenSequence: string[];
	bodyTerms: Set<string>;
	aliasTerms: Set<string>;
	aliasCharTerms: Set<string>;
	basenameTerms: Set<string>;
	basenameCharTerms: Set<string>;
	folderTerms: Set<string>;
	folderCharTerms: Set<string>;
	headingTerms: Set<string>;
	tagTerms: Set<string>;
	tagCharTerms: Set<string>;
	tagValues: string[];
};

type CoverageLexicalDerivedTermKey =
	| "bodyTerms"
	| "aliasTerms"
	| "aliasCharTerms"
	| "basenameTerms"
	| "basenameCharTerms"
	| "folderTerms"
	| "folderCharTerms"
	| "headingTerms"
	| "tagTerms"
	| "tagCharTerms"
	| "tagValues";

type CoverageLexicalDerivedPostingBinding = {
	termsKey: CoverageLexicalDerivedTermKey;
	postingKey: CoverageLexicalLivePostingKey;
	uniqueTerms?: boolean;
};

type CoverageLexicalDisplayPruneConfig = {
	enabled: boolean;
	top2To4Ratio: number;
	top5PlusRatio: number;
	bodyCharWeight: number;
	metadataCharWeight: number;
	tagExactWeight: number;
	tagCharWeight: number;
};

const COVERAGE_LEXICAL_DERIVED_POSTING_BINDINGS: readonly CoverageLexicalDerivedPostingBinding[] =
	[
		{ termsKey: "bodyTerms", postingKey: "bodyPostings" },
		{ termsKey: "aliasTerms", postingKey: "metadataAliasPostings" },
		{ termsKey: "aliasCharTerms", postingKey: "metadataAliasCharPostings" },
		{ termsKey: "basenameTerms", postingKey: "metadataBasenamePostings" },
		{
			termsKey: "basenameCharTerms",
			postingKey: "metadataBasenameCharPostings",
		},
		{ termsKey: "folderTerms", postingKey: "metadataFolderPostings" },
		{ termsKey: "folderCharTerms", postingKey: "metadataFolderCharPostings" },
		{ termsKey: "headingTerms", postingKey: "metadataHeadingPostings" },
		{ termsKey: "tagTerms", postingKey: "metadataTagPostings" },
		{
			termsKey: "tagValues",
			postingKey: "metadataTagFullPostings",
			uniqueTerms: true,
		},
		{ termsKey: "tagCharTerms", postingKey: "metadataTagCharPostings" },
	];

type CoverageLexicalMutableNumericPostingMap = ReadonlyMap<
	string,
	number[] | Uint32Array
> & {
	set(term: string, docIds: number[] | Uint32Array): unknown;
	delete(term: string): boolean;
	clear(): void;
};

function compareCoverageLexicalTerms(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}

function createCoverageLexicalDocument(
	docId: number,
	fields: CoverageLexicalDocumentTextFields,
	generation?: number,
): CoverageLexicalDocument {
	return {
		docId,
		generation,
		...fields,
	};
}

function createCoverageLexicalDocumentTextFields(
	document: Pick<
		IndexedDocument,
		"basename" | "folder" | "aliases" | "tags" | "headings"
	>,
): CoverageLexicalDocumentTextFields {
	return {
		basenameText: document.basename ?? "",
		folderText: document.folder ?? "",
		aliasesText: document.aliases ?? "",
		tagsText: document.tags ?? "",
		headingsText: document.headings ?? "",
	};
}

function buildCoverageLexicalDerivedDocumentIndexState(
	tokenizer: Tokenizer,
	document: CoverageLexicalDocumentTextFields,
	options: {
		bodyText?: string;
		existingBodyTokenSequence?: readonly string[];
		existingTagValues?: readonly string[];
	} = {},
): CoverageLexicalDerivedDocumentIndexState {
	const bodyTokenSequence = options.existingBodyTokenSequence
		? [...options.existingBodyTokenSequence]
		: tokenizeCoverageLexicalDocumentText(tokenizer, options.bodyText ?? "");
	const bodyTerms = new Set(bodyTokenSequence);
	const basenameTerms = new Set(
		tokenizeCoverageLexicalDocumentText(tokenizer, document.basenameText),
	);
	const basenameCharTerms = new Set(extractHanBigrams(document.basenameText));
	const folderTerms = new Set(
		tokenizeCoverageLexicalDocumentText(tokenizer, document.folderText),
	);
	const folderCharTerms = new Set(extractHanBigrams(document.folderText));
	const aliasTerms = new Set(
		tokenizeCoverageLexicalDocumentText(tokenizer, document.aliasesText),
	);
	const aliasCharTerms = new Set(extractHanBigrams(document.aliasesText));
	const tagTerms = new Set(
		tokenizeCoverageLexicalDocumentText(tokenizer, document.tagsText),
	);
	const tagValues = options.existingTagValues
		? [...options.existingTagValues]
		: splitCoverageLexicalTagValues(document.tagsText);
	const tagCharTerms = new Set(
		tagValues.flatMap((tagValue) => extractHanBigrams(tagValue)),
	);
	const headingTerms = new Set(
		tokenizeCoverageLexicalDocumentText(tokenizer, document.headingsText),
	);
	return {
		bodyTokenSequence,
		bodyTerms,
		aliasTerms,
		aliasCharTerms,
		basenameTerms,
		basenameCharTerms,
		folderTerms,
		folderCharTerms,
		headingTerms,
		tagTerms,
		tagCharTerms,
		tagValues,
	};
}

function tokenizeCoverageLexicalDocumentText(
	tokenizer: Tokenizer,
	text: string,
): string[] {
	return tokenizer
		.tokenizeSequence(text, "index")
		.map((term) => term.toLowerCase());
}

function buildCoverageLexicalSearchQueryTerms(
	tokenizer: Tokenizer,
	queryText: string,
): string[] {
	const rawQueryTerms = tokenizer
		.tokenizeSequence(queryText, "search")
		.map((term) => term.toLowerCase());
	const normalizedContentTerms = deriveCoverageLexicalQueryOnlyContentTerms(
		queryText,
		rawQueryTerms,
	);
	if (normalizedContentTerms.length === 0) {
		return rawQueryTerms;
	}
	const merged = new Set<string>();
	for (const term of [...normalizedContentTerms, ...rawQueryTerms]) {
		if (term.length > 0) {
			merged.add(term);
		}
	}
	return [...merged];
}

function deriveCoverageLexicalQueryOnlyContentTerms(
	queryText: string,
	rawQueryTerms: readonly string[],
): string[] {
	const rawSet = new Set(rawQueryTerms.map((term) => term.toLowerCase()));
	const rawHanTerms = rawQueryTerms.filter((term) => /[\p{Script=Han}]/u.test(term));
	if (rawHanTerms.length >= 2) {
		return [];
	}
	const derived: string[] = [];
	for (const segment of extractHanSegments(queryText.normalize("NFKC"))) {
		const normalizedSegment = segment.trim().toLowerCase();
		if (normalizedSegment.length < 4) {
			continue;
		}
		const reducedTerms = normalizedSegment
			.replace(COVERAGE_LEXICAL_QUERY_ONLY_HAN_FUNCTION_WORD_REGEX, " ")
			.split(/\s+/u)
			.map((term) => term.trim())
			.filter((term) => term.length >= 2 && !rawSet.has(term));
		if (reducedTerms.length < 2) {
			continue;
		}
		for (const term of reducedTerms) {
			rawSet.add(term);
			derived.push(term);
		}
	}
	return derived;
}

type CoverageLexicalDocRankableResult = {
	docId: number;
	queryTerms: string[];
	matchedTerms: string[];
	score?: number;
	coverageLexicalSignal: CoverageLexicalFamilySignal;
	admissionSignal: ReturnType<typeof buildCoverageLexicalPassageAdmissionSignal>;
};

type CoverageLexicalEngineQueryCache = {
	fuzzyProportion: number;
	docCacheById: Map<number, CoverageLexicalEngineQueryDocCacheEntry>;
	sharedBodyEvidenceTraceById: Map<number, CoverageLexicalBodyEvidenceTrace>;
	bodyTokensByDocId: Map<number, readonly string[]>;
};

type CoverageLexicalEngineQueryDocCacheEntry = {
	bodyEvidenceTrace: CoverageLexicalBodyEvidenceTrace | null;
	admissionSignal: ReturnType<typeof buildCoverageLexicalPassageAdmissionSignal>;
	baseSignal: CoverageLexicalFamilySignal;
	coarseResult: CoverageLexicalDocRankableResult | null;
	hydrated: boolean;
};

type CoverageLexicalBenchmarkPhaseName =
	| "planning"
	| "recall"
	| "bodyEvidence"
	| "admission"
	| "coarseSignal"
	| "coarseSort"
	| "localWindow"
	| "finalRank";

type CoverageLexicalBenchmarkPhaseTimingAccumulator = {
	totalMs: number;
	maxMs: number;
	count: number;
	unitCount: number;
};

type CoverageLexicalBenchmarkPhaseTimingState = {
	queryCount: number;
	queryTotalMs: number;
	phases: Map<
		CoverageLexicalBenchmarkPhaseName,
		CoverageLexicalBenchmarkPhaseTimingAccumulator
	>;
	recallSubphases: Map<
		CoverageLexicalRecallBenchmarkSubphaseName,
		CoverageLexicalBenchmarkPhaseTimingAccumulator
	>;
	laneEvaluateSubphases: Map<
		CoverageLexicalLaneEvaluateBenchmarkSubphaseName,
		CoverageLexicalBenchmarkPhaseTimingAccumulator
	>;
};

type CoverageLexicalBenchmarkOffloadDocDebug = {
	docId: number;
	path: string | null;
	cheapCoarseRank: number | null;
	finalRank: number | null;
	hydratedAtCoarse: boolean;
	selectedForLocalWindow: boolean;
	hasResidentBodyTokens: boolean;
	bodyMatchCount: number;
	phraseMatchCount: number;
	hasBodyPrefixWitness: boolean;
	bodyCharMatchCount: number;
	unresolvedBodyEvidence: CoverageLexicalCandidateState["unresolvedBodyEvidence"];
};

type CoverageLexicalBenchmarkOffloadSearchDebug = {
	queryText: string;
	offloadEnabled: boolean;
	stagedHydration: boolean;
	candidateCount: number;
	cheapCoarseTopDocIds: number[];
	coarseHydrationDocIds: number[];
	localWindowDocIds: number[];
	finalTopDocIds: number[];
	docs: CoverageLexicalBenchmarkOffloadDocDebug[];
};

const DEFAULT_LOCAL_WINDOW_RERANK_BUDGET = 24;
const METADATA_ASSIST_IDENTITY_WEIGHT = 0.5;
const METADATA_ASSIST_SIGNAL_WEIGHT = 0.9;

function shouldCaptureCoverageLexicalBenchmarkOffloadDiagnostics(): boolean {
	const raw = process.env.COVERAGE_LEXICAL_BENCH_DIAGNOSTICS?.trim();
	if (!raw) {
		return false;
	}
	return raw
		.split(/[\s,]+/u)
		.map((part) => part.trim().toLowerCase())
		.some((part) => part === "all" || part === "offload");
}

function createCoverageLexicalEngineQueryCache(
	fuzzyProportion: number,
): CoverageLexicalEngineQueryCache {
	return {
		fuzzyProportion,
		docCacheById: new Map(),
		sharedBodyEvidenceTraceById: new Map(),
		bodyTokensByDocId: new Map(),
	};
}

function createCoverageLexicalBenchmarkPhaseTimingState(): CoverageLexicalBenchmarkPhaseTimingState {
	return {
		queryCount: 0,
		queryTotalMs: 0,
		phases: new Map(),
		recallSubphases: new Map(),
		laneEvaluateSubphases: new Map(),
	};
}

@singleton()
export class CoverageLexicalFileSearchEngine implements FileSearchEngine {
	readonly backend = "coverage-lexical" as const;
	readonly supportsSerialization = true;

	private readonly tokenizer = getInstance(Tokenizer);
	private readonly documents = new Map<string, CoverageLexicalDocument>();
	private readonly documentById: Array<CoverageLexicalDocument | undefined> = [];
	private readonly documentIdByPath = new Map<string, number>();
	private readonly documentPathById: Array<string | undefined> = [];
	private documentBodyTokenLexicon: string[] = [];
	private documentBodyTokenCount = 0;
	private readonly documentBodyTokenIdByTerm = new Map<string, number>();
	private documentBodyTokenIdTape = new Uint8Array(0);
	private readonly documentBodyTokenRangeById: Array<CoverageLexicalTokenRange | undefined> = [];
	private readonly documentBodyHanSegmentsById: Array<
		readonly string[] | undefined
	> = [];
	private readonly documentTagValuesById: Array<readonly string[] | undefined> = [];
	private fileSnapshotStore: FileSnapshotStore | null | undefined;
	private readonly offloadedBodyTokenHotCacheByDocId = new Map<
		number,
		readonly string[]
	>();
	private coverageLexicalBodyTokenColdStore:
		| CoverageLexicalBodyTokenColdStoreApi
		| null
		| undefined;
	private readonly pendingBodyTokenColdUpsertsByPath = new Map<
		string,
		CoverageLexicalBodyTokenColdDocumentWrite
	>();
	private readonly pendingBodyTokenColdDeletes = new Set<string>();
	private bodyTokenColdStoreWriteQueue: Promise<void> = Promise.resolve();
	private nextDocumentId = 0;
	private readonly bodyPostings = new CoverageLexicalSharedTokenIdPostingMap(
		(term) => this.documentBodyTokenIdByTerm.get(term),
		(term) => this.getOrCreateDocumentBodyTokenId(term),
		(tokenId) => this.getDocumentBodyTokenById(tokenId),
	);
	private readonly metadataAliasCharPostings = new Map<string, number[]>();
	private readonly metadataAliasPhrasePostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly metadataAliasPostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly metadataBasenameCharPostings = new Map<string, number[]>();
	private readonly metadataBasenamePhrasePostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly metadataBasenamePostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly metadataFolderCharPostings = new Map<string, number[]>();
	private readonly metadataFolderPhrasePostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly metadataFolderPostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly metadataHeadingCharPostings = new Map<string, number[]>();
	private readonly metadataHeadingPhrasePostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly metadataHeadingPostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly metadataTagCharPostings = new Map<string, number[]>();
	private readonly metadataTagFullPostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly metadataTagPhrasePostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly metadataTagPostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly lexicon = new Set<string>();
	private sortedLexiconCache: string[] = [];
	private sortedLexiconDirty = false;

	get sortedLexicon(): readonly string[] {
		return this.getSortedLexicon();
	}

	private benchmarkPhaseTiming: CoverageLexicalBenchmarkPhaseTimingState | null =
		null;
	private lastBenchmarkOffloadSearchDebug:
		| CoverageLexicalBenchmarkOffloadSearchDebug
		| null = null;

	async reIndexAll(
		data: IndexedDocument[] | SerializedFileSearchIndex,
	): Promise<boolean> {
		if (!Array.isArray(data)) {
			try {
				if (!isSerializedCoverageLexicalBinarySnapshot(data)) {
					logger.warn(
						"coverage-lexical currently supports live documents or its own binary snapshot only",
					);
					this.clearIndex();
					return false;
				}
				this.clearIndex();
				this.restoreBinarySnapshot(data);
				return true;
			} catch (error) {
				logger.error(error);
				this.clearIndex();
				return false;
			}
		}

		this.clearIndex();
		await this.addDocuments(data);
		return true;
	}

	private markLexiconDirty(): void {
		this.sortedLexiconDirty = true;
		this.sortedLexiconCache = [];
	}

	private getSortedLexicon(): readonly string[] {
		if (this.sortedLexiconDirty || this.sortedLexiconCache.length === 0) {
			this.sortedLexiconCache = Array.from(this.lexicon).sort(
				compareCoverageLexicalTerms,
			);
			this.sortedLexiconDirty = false;
		}
		return this.sortedLexiconCache;
	}

	resetBenchmarkPhaseTiming(): void {
		this.benchmarkPhaseTiming = createCoverageLexicalBenchmarkPhaseTimingState();
	}

	getLastBenchmarkOffloadSearchDebug():
		| CoverageLexicalBenchmarkOffloadSearchDebug
		| null {
		return this.lastBenchmarkOffloadSearchDebug;
	}

	getBenchmarkPhaseTimingSummary():
		| {
				queryCount: number;
				queryTotalMs: number;
				totalMeasuredMs: number;
				phases: Array<{
					phase: CoverageLexicalBenchmarkPhaseName;
					totalMs: number;
					maxMs: number;
					count: number;
					unitCount: number;
					avgMsPerCall: number;
					avgMsPerUnit: number;
					shareOfMeasuredMs: number;
					shareOfQueryTime: number;
				}>;
				recallSubphases: Array<{
					phase: CoverageLexicalRecallBenchmarkSubphaseName;
					totalMs: number;
					maxMs: number;
					count: number;
					unitCount: number;
					avgMsPerCall: number;
					avgMsPerUnit: number;
					shareOfRecallMs: number;
					shareOfQueryTime: number;
				}>;
				laneEvaluateSubphases: Array<{
					phase: CoverageLexicalLaneEvaluateBenchmarkSubphaseName;
					totalMs: number;
					maxMs: number;
					count: number;
					unitCount: number;
					avgMsPerCall: number;
					avgMsPerUnit: number;
					shareOfLaneEvaluateMs: number;
					shareOfQueryTime: number;
				}>;
		  }
		| null {
		if (!this.benchmarkPhaseTiming) {
			return null;
		}
		const benchmarkPhaseTiming = this.benchmarkPhaseTiming;
		const totalMeasuredMs = Array.from(benchmarkPhaseTiming.phases.values()).reduce(
			(sum, phase) => sum + phase.totalMs,
			0,
		);
		const queryTotalMs = benchmarkPhaseTiming.queryTotalMs;
		const recallTotalMs = benchmarkPhaseTiming.phases.get("recall")?.totalMs ?? 0;
		const laneEvaluateTotalMs =
			benchmarkPhaseTiming.recallSubphases.get("laneEvaluate")?.totalMs ?? 0;
		return {
			queryCount: benchmarkPhaseTiming.queryCount,
			queryTotalMs,
			totalMeasuredMs,
			phases: Array.from(benchmarkPhaseTiming.phases.entries())
				.map(([phase, timing]) => ({
					phase,
					totalMs: timing.totalMs,
					maxMs: timing.maxMs,
					count: timing.count,
					unitCount: timing.unitCount,
					avgMsPerCall:
						timing.count > 0 ? timing.totalMs / timing.count : 0,
					avgMsPerUnit:
						timing.unitCount > 0 ? timing.totalMs / timing.unitCount : 0,
					shareOfMeasuredMs:
						totalMeasuredMs > 0 ? timing.totalMs / totalMeasuredMs : 0,
					shareOfQueryTime: queryTotalMs > 0 ? timing.totalMs / queryTotalMs : 0,
				}))
				.sort((left, right) => right.totalMs - left.totalMs),
			recallSubphases: Array.from(benchmarkPhaseTiming.recallSubphases.entries())
				.map(([phase, timing]) => ({
					phase,
					totalMs: timing.totalMs,
					maxMs: timing.maxMs,
					count: timing.count,
					unitCount: timing.unitCount,
					avgMsPerCall:
						timing.count > 0 ? timing.totalMs / timing.count : 0,
					avgMsPerUnit:
						timing.unitCount > 0 ? timing.totalMs / timing.unitCount : 0,
					shareOfRecallMs: recallTotalMs > 0 ? timing.totalMs / recallTotalMs : 0,
					shareOfQueryTime: queryTotalMs > 0 ? timing.totalMs / queryTotalMs : 0,
				}))
				.sort((left, right) => right.totalMs - left.totalMs),
			laneEvaluateSubphases: Array.from(
				benchmarkPhaseTiming.laneEvaluateSubphases.entries(),
			)
				.map(([phase, timing]) => ({
					phase,
					totalMs: timing.totalMs,
					maxMs: timing.maxMs,
					count: timing.count,
					unitCount: timing.unitCount,
					avgMsPerCall:
						timing.count > 0 ? timing.totalMs / timing.count : 0,
					avgMsPerUnit:
						timing.unitCount > 0 ? timing.totalMs / timing.unitCount : 0,
					shareOfLaneEvaluateMs:
						laneEvaluateTotalMs > 0 ? timing.totalMs / laneEvaluateTotalMs : 0,
					shareOfQueryTime: queryTotalMs > 0 ? timing.totalMs / queryTotalMs : 0,
				}))
				.sort((left, right) => right.totalMs - left.totalMs),
		};
	}

	clearIndex(): void {
		this.documents.clear();
		this.documentById.length = 0;
		this.documentIdByPath.clear();
		this.documentPathById.length = 0;
		this.documentBodyTokenLexicon = [];
		this.documentBodyTokenCount = 0;
		this.documentBodyTokenIdByTerm.clear();
		this.documentBodyTokenIdTape = new Uint8Array(0);
		this.documentBodyTokenRangeById.length = 0;
		this.documentBodyHanSegmentsById.length = 0;
		this.documentTagValuesById.length = 0;
		this.offloadedBodyTokenHotCacheByDocId.clear();
		this.pendingBodyTokenColdUpsertsByPath.clear();
		this.pendingBodyTokenColdDeletes.clear();
		this.coverageLexicalBodyTokenColdStore = undefined;
		this.fileSnapshotStore = undefined;
		this.nextDocumentId = 0;
		this.clearLivePostingMaps();
		this.metadataHeadingCharPostings.clear();
		this.metadataAliasPhrasePostings.clear();
		this.metadataBasenamePhrasePostings.clear();
		this.metadataFolderPhrasePostings.clear();
		this.metadataHeadingPhrasePostings.clear();
		this.metadataTagPhrasePostings.clear();
		this.lexicon.clear();
		this.sortedLexiconCache = [];
		this.sortedLexiconDirty = false;
	}

	private getOrCreateDocumentBodyTokenId(token: string): number {
		const existing = this.documentBodyTokenIdByTerm.get(token);
		if (existing !== undefined) {
			return existing;
		}
		const tokenId = this.documentBodyTokenCount;
		this.documentBodyTokenCount += 1;
		if (this.documentBodyTokenLexicon.length > 0 || tokenId === 0) {
			this.documentBodyTokenLexicon[tokenId] = token;
		}
		this.documentBodyTokenIdByTerm.set(token, tokenId);
		return tokenId;
	}

	private getDocumentTextFields(docId: number): CoverageLexicalDocumentTextFields {
		const document = this.documentById[docId];
		if (!document) {
			return {
				basenameText: "",
				folderText: "",
				aliasesText: "",
				tagsText: "",
				headingsText: "",
			};
		}
		return {
			basenameText: document.basenameText,
			folderText: document.folderText,
			aliasesText: document.aliasesText,
			tagsText: document.tagsText,
			headingsText: document.headingsText,
		};
	}

	private getDocumentGeneration(docId: number): number | undefined {
		return this.documentById[docId]?.generation;
	}

	private getDocumentMetadataFieldText(
		docId: number,
		field: CoverageLexicalMetadataField,
	): string {
		const document = this.documentById[docId];
		if (!document) {
			return "";
		}
		switch (field) {
			case "basename":
				return document.basenameText;
			case "aliases":
				return document.aliasesText;
			case "folder":
				return document.folderText;
			case "headings":
				return document.headingsText;
			case "tags":
				return document.tagsText;
			default:
				return "";
		}
	}

	private getDocumentBodyTokenById(tokenId: number): string | undefined {
		if (tokenId < 0 || tokenId >= this.documentBodyTokenCount) {
			return undefined;
		}
		return this.ensureDocumentBodyTokenLexiconLoaded()[tokenId];
	}

	private getResidentDocumentBodyTokenLexiconValues(): string[] {
		return [...this.documentBodyTokenLexicon];
	}

	private getDocumentBodyTokenLexiconSnapshotValues(): string[] {
		return this.buildDocumentBodyTokenLexiconSnapshot();
	}

	private ensureDocumentBodyTokenLexiconLoaded(): string[] {
		if (this.documentBodyTokenLexicon.length === this.documentBodyTokenCount) {
			return this.documentBodyTokenLexicon;
		}
		this.documentBodyTokenLexicon = this.buildDocumentBodyTokenLexiconSnapshot();
		return this.documentBodyTokenLexicon;
	}

	private buildDocumentBodyTokenLexiconSnapshot(): string[] {
		if (this.documentBodyTokenCount === 0) {
			return [];
		}
		if (this.documentBodyTokenLexicon.length === this.documentBodyTokenCount) {
			return [...this.documentBodyTokenLexicon];
		}
		const lexicon = new Array<string>(this.documentBodyTokenCount);
		for (const [token, tokenId] of this.documentBodyTokenIdByTerm.entries()) {
			lexicon[tokenId] = token;
		}
		return lexicon;
	}

	private getDocumentBodyTokenIds(docId: number): readonly number[] | undefined {
		return readCoverageLexicalNumericTokenRange(
			this.documentBodyTokenIdTape,
			this.documentBodyTokenRangeById[docId],
		);
	}

	private hasResidentDocumentBodyTokens(docId: number): boolean {
		return this.documentBodyTokenRangeById[docId] !== undefined;
	}

	private getHotCachedOffloadedBodyTokens(
		docId: number,
	): readonly string[] | undefined {
		const cached = this.offloadedBodyTokenHotCacheByDocId.get(docId);
		if (!cached) {
			return undefined;
		}
		this.offloadedBodyTokenHotCacheByDocId.delete(docId);
		this.offloadedBodyTokenHotCacheByDocId.set(docId, cached);
		return cached;
	}

	private rememberHotCachedOffloadedBodyTokens(
		docId: number,
		tokens: readonly string[],
	): void {
		this.offloadedBodyTokenHotCacheByDocId.delete(docId);
		this.offloadedBodyTokenHotCacheByDocId.set(docId, tokens);
		while (
			this.offloadedBodyTokenHotCacheByDocId.size >
			COVERAGE_LEXICAL_OFFLOADED_BODY_TOKEN_HOT_CACHE_LIMIT
		) {
			const oldestKey =
				this.offloadedBodyTokenHotCacheByDocId.keys().next().value;
			if (oldestKey === undefined) {
				break;
			}
			this.offloadedBodyTokenHotCacheByDocId.delete(oldestKey);
		}
	}

	private clearHotCachedOffloadedBodyTokens(docId: number): void {
		this.offloadedBodyTokenHotCacheByDocId.delete(docId);
	}


	private getDocumentBodyTokens(
		docId: number,
		cache?: Map<number, readonly string[]>,
		options: {
			allowColdLoad?: boolean;
		} = {},
	): readonly string[] | undefined {
		const cached = cache?.get(docId);
		if (cached !== undefined) {
			return cached;
		}
		const tokenIds = this.getDocumentBodyTokenIds(docId);
		if (!tokenIds) {
			const hotCached = this.getHotCachedOffloadedBodyTokens(docId);
			if (hotCached) {
				cache?.set(docId, hotCached);
				return hotCached;
			}
			return undefined;
		}
		const tokens = Array.from(tokenIds, (tokenId) => {
			const token = this.getDocumentBodyTokenById(tokenId);
			if (token === undefined) {
				throw new Error(
					`Missing coverage lexical body token for id ${tokenId}`,
				);
			}
			return token;
		});
		cache?.set(docId, tokens);
		return tokens;
	}

	private async prefetchMissingQueryBodyTokens(
		docIds: Iterable<number>,
		queryCache: CoverageLexicalEngineQueryCache,
	): Promise<void> {
		const missingDocIds: number[] = [];
		const missingPaths: string[] = [];
		for (const docId of docIds) {
			if (
				queryCache.bodyTokensByDocId.has(docId) ||
				this.hasResidentDocumentBodyTokens(docId)
			) {
				continue;
			}
			const offloadedTokens = this.getDocumentBodyTokens(
				docId,
				queryCache.bodyTokensByDocId,
			);
			if (offloadedTokens) {
				continue;
			}
			const path = this.documentPathById[docId];
			if (!path) {
				continue;
			}
			missingDocIds.push(docId);
			missingPaths.push(path);
		}
		if (missingPaths.length === 0) {
			return;
		}
		const coldStore = this.getBodyTokenColdStore();
		if (coldStore) {
			const documentsByPath = await coldStore.readDocuments(missingPaths);
			for (let index = 0; index < missingDocIds.length; index += 1) {
				const decoded = documentsByPath.get(missingPaths[index]);
				if (!decoded) {
					continue;
				}
				queryCache.bodyTokensByDocId.set(
					missingDocIds[index],
					decoded.bodyTokens,
				);
				this.rememberHotCachedOffloadedBodyTokens(
					missingDocIds[index],
					decoded.bodyTokens,
				);
			}
		}
		const unresolvedDocIds: number[] = [];
		const unresolvedPaths: string[] = [];
		for (let index = 0; index < missingDocIds.length; index += 1) {
			if (queryCache.bodyTokensByDocId.has(missingDocIds[index])) {
				continue;
			}
			unresolvedDocIds.push(missingDocIds[index]);
			unresolvedPaths.push(missingPaths[index]);
		}
		if (unresolvedPaths.length === 0) {
			return;
		}
		const fileSnapshotStore = this.getFileSnapshotStore();
		if (!fileSnapshotStore) {
			return;
		}
		const indexedRequests = unresolvedDocIds.flatMap((docId, index) => {
			const generation = this.getDocumentGeneration(docId);
			return generation === undefined
				? []
				: [{ path: unresolvedPaths[index], generation }];
		});
		const currentFallbackPaths = unresolvedDocIds.flatMap((docId, index) =>
			this.getDocumentGeneration(docId) === undefined
				? [unresolvedPaths[index]]
				: [],
		);
		const [indexedTextsByPath, currentTextsByPath] = await Promise.all([
			indexedRequests.length > 0
				? fileSnapshotStore.readIndexedTexts(indexedRequests)
				: Promise.resolve(new Map<string, string>()),
			currentFallbackPaths.length > 0
				? fileSnapshotStore.readCurrentTexts(currentFallbackPaths)
				: Promise.resolve(new Map<string, string>()),
		]);
		for (let index = 0; index < unresolvedDocIds.length; index += 1) {
			const generation = this.getDocumentGeneration(unresolvedDocIds[index]);
			const bodyText =
				generation === undefined
					? currentTextsByPath.get(unresolvedPaths[index])
					: indexedTextsByPath.get(unresolvedPaths[index]);
			if (bodyText === undefined) {
				continue;
			}
			const tokens = tokenizeCoverageLexicalDocumentText(this.tokenizer, bodyText);
			queryCache.bodyTokensByDocId.set(unresolvedDocIds[index], tokens);
			this.rememberHotCachedOffloadedBodyTokens(unresolvedDocIds[index], tokens);
		}
	}

	private shouldExperimentallyOffloadResidentBodyTokens(): boolean {
		if (!isCoverageLexicalExperimentalBodyTokenOffloadEnabled()) {
			return false;
		}
		return this.getBodyTokenColdStore() !== null;
	}

	private collectLikelyRecallBodyTokenDocIds(
		queryTerms: readonly string[],
	): readonly number[] {
		const candidatePostings: Array<number[] | Uint32Array> = [];
		for (const term of new Set(queryTerms)) {
			const postings = this.bodyPostings.get(term);
			if (!postings || postings.length === 0) {
				continue;
			}
			candidatePostings.push(postings);
		}
		candidatePostings.sort((left, right) => left.length - right.length);
		const docIds: number[] = [];
		const seen = new Set<number>();
		for (const postings of candidatePostings) {
			for (const docId of postings) {
				if (seen.has(docId)) {
					continue;
				}
				seen.add(docId);
				docIds.push(docId);
				if (
					docIds.length >= COVERAGE_LEXICAL_RECALL_BODY_TOKEN_PREFETCH_DOC_BUDGET
				) {
					return docIds;
				}
			}
		}
		return docIds;
	}

	private async prefetchLikelyRecallBodyTokens(
		queryTerms: readonly string[],
		queryCache: CoverageLexicalEngineQueryCache,
	): Promise<void> {
		if (!this.shouldExperimentallyOffloadResidentBodyTokens()) {
			return;
		}
		await this.prefetchMissingQueryBodyTokens(
			this.collectLikelyRecallBodyTokenDocIds(queryTerms),
			queryCache,
		);
	}

	private offloadResidentDocumentBodyTokens(): void {
		if (!this.shouldExperimentallyOffloadResidentBodyTokens()) {
			return;
		}
		if (this.documentBodyTokenIdTape.length === 0) {
			return;
		}
		if (this.getBodyTokenColdStore() === null) {
			return;
		}
		this.documentBodyTokenIdTape = new Uint8Array(0);
		this.documentBodyTokenRangeById.length = 0;
		this.documentBodyTokenLexicon = [];
	}


	private mapDocumentBodyTokensToIds(tokens: readonly string[]): number[] {
		return tokens.map((token) => this.getOrCreateDocumentBodyTokenId(token));
	}

	private setDocumentBodyTokens(
		docId: number,
		tokens: readonly string[],
	): void {
		this.rebuildDocumentBodyTokenTape(
			new Map([[docId, this.mapDocumentBodyTokensToIds(tokens)]]),
		);
	}

	private clearDocumentBodyTokens(docId: number): void {
		this.rebuildDocumentBodyTokenTape(new Map([[docId, undefined]]));
	}

	private compactDocumentBodyTokenLexicon(): void {
		if (this.documentBodyTokenCount === 0) {
			this.documentBodyTokenLexicon = [];
			this.documentBodyTokenCount = 0;
			this.documentBodyTokenIdByTerm.clear();
			this.documentBodyTokenIdTape = new Uint8Array(0);
			return;
		}
		const usedTokenIds = new Set<number>();
		for (let docId = 0; docId < this.documentBodyTokenRangeById.length; docId += 1) {
			const tokenIds = this.documentById[docId]
				? this.getDocumentBodyTokenIds(docId)
				: undefined;
			if (!tokenIds) {
				continue;
			}
			for (const tokenId of tokenIds) {
				usedTokenIds.add(tokenId);
			}
		}
		for (const [tokenId] of this.bodyPostings.getTokenIdEntries()) {
			usedTokenIds.add(tokenId);
		}
		if (usedTokenIds.size === 0) {
			this.documentBodyTokenLexicon = [];
			this.documentBodyTokenCount = 0;
			this.documentBodyTokenIdByTerm.clear();
			this.documentBodyTokenIdTape = new Uint8Array(0);
			this.documentBodyTokenRangeById.length = 0;
			this.bodyPostings.clear();
			return;
		}
		if (usedTokenIds.size === this.documentBodyTokenCount) {
			return;
		}
		const hadResidentLexicon =
			this.documentBodyTokenLexicon.length === this.documentBodyTokenCount;
		const nextLexicon: string[] = [];
		const nextIdByTerm = new Map<string, number>();
		const tokenIdRemap = new Map<number, number>();
		const tokensById = [...this.documentBodyTokenIdByTerm.entries()].sort(
			(left, right) => left[1] - right[1],
		);
		for (const [token, tokenId] of tokensById) {
			if (!usedTokenIds.has(tokenId)) {
				continue;
			}
			const nextTokenId = nextLexicon.length;
			nextLexicon.push(token);
			nextIdByTerm.set(token, nextTokenId);
			tokenIdRemap.set(tokenId, nextTokenId);
		}
		const remappedTokenIdsByDocId = new Map<number, readonly number[]>();
		for (let docId = 0; docId < this.documentBodyTokenRangeById.length; docId += 1) {
			const tokenIds = this.documentById[docId]
				? this.getDocumentBodyTokenIds(docId)
				: undefined;
			if (!tokenIds) {
				continue;
			}
			remappedTokenIdsByDocId.set(
				docId,
				tokenIds.map((tokenId) => {
					const nextTokenId = tokenIdRemap.get(tokenId);
					if (nextTokenId === undefined) {
						throw new Error(
							"Missing compacted coverage lexical body token id for " + tokenId,
						);
					}
					return nextTokenId;
				}),
			);
		}
		this.bodyPostings.remapTokenIds(tokenIdRemap, nextLexicon.length);
		this.documentBodyTokenLexicon = hadResidentLexicon ? nextLexicon : [];
		this.documentBodyTokenCount = nextLexicon.length;
		this.documentBodyTokenIdByTerm.clear();
		for (const [token, tokenId] of nextIdByTerm.entries()) {
			this.documentBodyTokenIdByTerm.set(token, tokenId);
		}
		this.rebuildDocumentBodyTokenTape(remappedTokenIdsByDocId);
	}

	private rebuildDocumentBodyTokenTape(
		overrides: ReadonlyMap<number, readonly number[] | undefined> = new Map(),
	): void {
		const currentTape = this.documentBodyTokenIdTape;
		const currentRanges = this.documentBodyTokenRangeById;
		let maxDocId = Math.max(this.documentById.length, currentRanges.length);
		for (const docId of overrides.keys()) {
			maxDocId = Math.max(maxDocId, docId + 1);
		}
		const nextTape: number[] = [];
		const nextRanges: Array<CoverageLexicalTokenRange | undefined> = new Array(
			maxDocId,
		);
		for (let docId = 0; docId < maxDocId; docId += 1) {
			const tokens = overrides.has(docId)
				? overrides.get(docId)
				: this.documentById[docId]
					? readCoverageLexicalNumericTokenRange(currentTape, currentRanges[docId])
					: undefined;
			if (!tokens || tokens.length === 0) {
				nextRanges[docId] = undefined;
				continue;
			}
			const encodedTokens = encodeCoverageLexicalNumericTokenTape(tokens);
			const start = nextTape.length;
			nextTape.push(...encodedTokens);
			nextRanges[docId] = {
				start,
				end: nextTape.length,
			};
		}
		this.documentBodyTokenIdTape = Uint8Array.from(nextTape);
		this.documentBodyTokenRangeById.length = 0;
		this.documentBodyTokenRangeById.push(...nextRanges);
	}
	async addDocuments(documents: IndexedDocument[]): Promise<void> {
		for (const document of documents) {
			this.indexDocument(document);
		}
		this.offloadResidentDocumentBodyTokens();
		await this.flushPendingBodyTokenColdStoreWrites();
	}

	deleteDocuments(paths: string[]): void {
		for (const path of paths) {
			this.removeDocument(path);
		}
		void this.flushPendingBodyTokenColdStoreWrites().catch((error) =>
			logger.warn("coverage lexical cold-store delete flush failed:", error),
		);
	}

	async searchFiles(request: FileSearchRequest): Promise<MatchedFile[]> {
		const queryStartedAt = this.benchmarkPhaseTiming ? performance.now() : 0;
		this.lastBenchmarkOffloadSearchDebug = null;
		try {
			const queryTerms = buildCoverageLexicalSearchQueryTerms(
				this.tokenizer,
				request.queryText,
			);
			const charQuery = buildCoverageLexicalCharQuery(request.queryText);
			if (
				this.documents.size === 0 ||
				(queryTerms.length === 0 &&
					charQuery.terms.length === 0 &&
					charQuery.rawSegments.length === 0)
			) {
				return [];
			}

			const planningStartedAt = this.benchmarkPhaseTiming ? performance.now() : 0;
			const familyProbes = this.buildFamilyProbes(queryTerms);
			const plan = buildCoverageLexicalPlan(
				request.queryText,
				queryTerms,
				familyProbes,
			);
			const pairSignatures = buildCoverageLexicalPairSignatures(plan.families);
			const phraseSignatures = [
				...buildCoverageLexicalPhraseSignatures(plan.families),
				...buildCoverageLexicalStructuredMetadataSignatures(
					request.queryText,
					plan.families,
				),
			];
			if (this.benchmarkPhaseTiming) {
				this.recordBenchmarkPhaseTiming(
					"planning",
					performance.now() - planningStartedAt,
				);
			}

			const queryCache = createCoverageLexicalEngineQueryCache(
				innerSetting.search.fuzzyProportion,
			);
			const recallBenchmarkHooks = {
				recordSubphaseTiming: (
					_subphase: CoverageLexicalRecallBenchmarkSubphaseName,
					_elapsedMs: number,
					_unitCount: number = 1,
				) => {
					if (!this.benchmarkPhaseTiming) {
						return;
					}
				},
				bodyEvidenceWindowFuzzyProportion: queryCache.fuzzyProportion,
				storeBodyEvidenceTrace: (docId: number, trace: CoverageLexicalBodyEvidenceTrace) =>
					queryCache.sharedBodyEvidenceTraceById.set(docId, trace),
				...(this.benchmarkPhaseTiming
					? {
							recordSubphaseTiming: (
								subphase: CoverageLexicalRecallBenchmarkSubphaseName,
								elapsedMs: number,
								unitCount: number = 1,
							) =>
								this.recordBenchmarkRecallSubphaseTiming(
									subphase,
									elapsedMs,
									unitCount,
								),
							recordLaneEvaluateSubphaseTiming: (
								subphase: CoverageLexicalLaneEvaluateBenchmarkSubphaseName,
								elapsedMs: number,
								unitCount: number = 1,
							) =>
								this.recordBenchmarkLaneEvaluateSubphaseTiming(
									subphase,
									elapsedMs,
									unitCount,
								),
					  }
					: {}),
			};
			const recallStartedAt = this.benchmarkPhaseTiming ? performance.now() : 0;
			const candidates = collectCoverageLexicalCandidateStatesByDocId(
				{
					bodyPostings: this.bodyPostings,
					documentBodyHanSegmentsById: this.documentBodyHanSegmentsById,
					metadataAliasCharPostings: this.metadataAliasCharPostings,
					metadataAliasPhrasePostings: this.metadataAliasPhrasePostings,
					metadataAliasPostings: this.metadataAliasPostings,
					metadataBasenameCharPostings: this.metadataBasenameCharPostings,
					metadataBasenamePhrasePostings: this.metadataBasenamePhrasePostings,
					metadataBasenamePostings: this.metadataBasenamePostings,
					metadataFolderCharPostings: this.metadataFolderCharPostings,
					metadataFolderPhrasePostings: this.metadataFolderPhrasePostings,
					metadataFolderPostings: this.metadataFolderPostings,
					metadataHeadingPhrasePostings: this.metadataHeadingPhrasePostings,
					metadataHeadingPostings: this.metadataHeadingPostings,
					metadataTagCharPostings: this.metadataTagCharPostings,
					metadataTagFullPostings: this.metadataTagFullPostings,
					metadataTagPhrasePostings: this.metadataTagPhrasePostings,
					metadataTagPostings: this.metadataTagPostings,
					sortedLexicon:
					request.isPrefixMatch || request.isFuzzy
						? this.getSortedLexicon()
						: [],
					documentIdByPath: this.documentIdByPath,
					documentPathById: this.documentPathById,
					getDocumentBodyTokens: (
						docId: number,
						options?: {
							allowColdLoad?: boolean;
						},
					) =>
						this.getDocumentBodyTokens(docId, queryCache.bodyTokensByDocId, {
							allowColdLoad: options?.allowColdLoad ?? false,
						}),
					allowPassageSignalInRecall:
						!this.shouldExperimentallyOffloadResidentBodyTokens(),
					getDocumentMetadataFieldText: (
						docId: number,
						field: CoverageLexicalMetadataField,
					) => this.getDocumentMetadataFieldText(docId, field),
					documentTagValuesById: this.documentTagValuesById,
				},
				plan,
				phraseSignatures,
				request,
				charQuery,
				recallBenchmarkHooks,
			);
			if (this.benchmarkPhaseTiming) {
				this.recordBenchmarkPhaseTiming(
					"recall",
					performance.now() - recallStartedAt,
					candidates.size,
				);
			}
			if (shouldLogCoverageLexicalHanDebug(request.queryText, charQuery)) {
				logger.debug("[coverage-lexical][han-debug] query", {
					queryText: request.queryText,
					queryTerms,
					hanSegments: charQuery.hanSegments,
					charTerms: charQuery.terms,
					queryKind: plan.explain.queryKind,
					candidateCount: candidates.size,
				});
			}
			if (candidates.size === 0) {
				return [];
			}
			const shouldStageOffloadedBodyTokenHydration =
				this.shouldExperimentallyOffloadResidentBodyTokens();
			let cheapCoarseRanked: CoverageLexicalDocRankableResult[] = [];
			let coarseHydrationDocIds: ReadonlySet<number> = new Set<number>();
			let coarseResults: CoverageLexicalDocRankableResult[];
			if (shouldStageOffloadedBodyTokenHydration) {
				const cheapCoarseResults = Array.from(candidates.entries())
					.map(([docId, state]) =>
						this.createRankableResult(
							docId,
							queryTerms,
							plan,
							state,
							false,
							phraseSignatures,
							pairSignatures,
							charQuery,
							queryCache,
							"cheap",
						),
					)
					.filter(
						(result): result is CoverageLexicalDocRankableResult =>
							result !== null,
					);
				cheapCoarseRanked = this.sortCoarseResults(
					cheapCoarseResults,
					plan,
				);
				coarseHydrationDocIds = this.computeCoarseHydrationDocIds(
					cheapCoarseRanked,
					candidates,
					plan,
					request.maxItemResults,
				);
				await this.prefetchMissingQueryBodyTokens(
					coarseHydrationDocIds,
					queryCache,
				);
				coarseResults = Array.from(candidates.entries())
					.map(([docId, state]) =>
						this.createRankableResult(
							docId,
							queryTerms,
							plan,
							state,
							false,
							phraseSignatures,
							pairSignatures,
							charQuery,
							queryCache,
							coarseHydrationDocIds.has(docId) ? "full" : "cheap",
						),
					)
					.filter(
						(result): result is CoverageLexicalDocRankableResult =>
							result !== null,
					);
			} else {
				await this.prefetchMissingQueryBodyTokens(candidates.keys(), queryCache);
				coarseResults = Array.from(candidates.entries())
					.map(([docId, state]) =>
						this.createRankableResult(
							docId,
							queryTerms,
							plan,
							state,
							false,
							phraseSignatures,
							pairSignatures,
							charQuery,
							queryCache,
							"full",
						),
					)
					.filter(
						(result): result is CoverageLexicalDocRankableResult =>
							result !== null,
					);
			}
			const coarseResultByDocId = new Map(
				coarseResults.map((result) => [result.docId, result] as const),
			);
			const coarseSortStartedAt = this.benchmarkPhaseTiming ? performance.now() : 0;
			const coarseRanked = this.sortCoarseResults(coarseResults, plan);
			if (this.benchmarkPhaseTiming) {
				this.recordBenchmarkPhaseTiming(
					"coarseSort",
					performance.now() - coarseSortStartedAt,
					coarseRanked.length,
				);
			}
			const localWindowDocIds = computeLocalWindowRerankDocIds(
				coarseRanked,
				plan,
				request.maxItemResults,
			);
			if (shouldStageOffloadedBodyTokenHydration) {
				await this.prefetchMissingQueryBodyTokens(localWindowDocIds, queryCache);
			}
			const rerankedResults: CoverageLexicalDocRankableResult[] = [];
			for (const [docId, state] of candidates.entries()) {
				if (!localWindowDocIds.has(docId)) {
					const coarseResult = coarseResultByDocId.get(docId);
					if (coarseResult) {
						rerankedResults.push(coarseResult);
					}
					continue;
				}
				const rerankedResult = this.createRankableResult(
					docId,
					queryTerms,
					plan,
					state,
					true,
						phraseSignatures,
						pairSignatures,
						charQuery,
						queryCache,
						"full",
					);
				if (rerankedResult) {
					rerankedResults.push(rerankedResult);
				}
			}
			const finalRankStartedAt = this.benchmarkPhaseTiming ? performance.now() : 0;
			const ranked = rankCoverageLexicalDocResults(rerankedResults, plan);
			const displayPruned = pruneWeakCoverageLexicalDisplayResults(
				ranked,
				resolveCoverageLexicalDisplayPruneConfig(),
			);
			const finalResults = displayPruned.slice(0, request.maxItemResults);
			if (shouldCaptureCoverageLexicalBenchmarkOffloadDiagnostics()) {
				this.lastBenchmarkOffloadSearchDebug =
					buildCoverageLexicalBenchmarkOffloadSearchDebug({
						queryText: request.queryText,
						offloadEnabled: isCoverageLexicalExperimentalBodyTokenOffloadEnabled(),
						stagedHydration: shouldStageOffloadedBodyTokenHydration,
						candidates,
						cheapCoarseRanked,
						coarseHydrationDocIds,
						localWindowDocIds,
						finalRanked: ranked,
						documentPathById: this.documentPathById,
						hasResidentDocumentBodyTokens: (docId) =>
							this.hasResidentDocumentBodyTokens(docId),
					});
			}
			if (this.benchmarkPhaseTiming) {
				this.recordBenchmarkPhaseTiming(
					"finalRank",
					performance.now() - finalRankStartedAt,
					rerankedResults.length,
				);
			}
			return finalResults.map((result) =>
				projectDocRankableResult(result, this.documentPathById),
			);
		} finally {
			if (this.benchmarkPhaseTiming) {
				this.benchmarkPhaseTiming.queryCount += 1;
				this.benchmarkPhaseTiming.queryTotalMs += performance.now() - queryStartedAt;
			}
		}
	}

	async getDirectSubItems(
		queryText: string,
		path: string,
		maxSubItemCount: number,
	): Promise<FileSubItem[] | null> {
		if (!this.documents.has(path)) {
			return null;
		}
		const snapshotText = await this.getDirectSubitemsSnapshotText(path);
		if (snapshotText === null) {
			return null;
		}
		return buildDirectSubitemsExactFileSubItems({
			queryText,
			snapshotText,
			options: {
				maxChars: 220,
				mergeGap: 32,
				contextLeft: 24,
				contextRight: 40,
				boundaryLookaround: 24,
			},
		}).slice(0, maxSubItemCount);
	}

	getIndexedDocumentCount(): number {
		return this.documents.size;
	}

	serialize(): SerializedFileSearchIndex | null {
		return {
			__backend: "coverage-lexical",
			__version: 2,
			__encoding: "binary-snapshot-v2",
			data: encodeCoverageLexicalSnapshotV1(this.buildBinarySnapshotState()),
		};
	}

	estimateIndexBytes(): number | null {
		return this.buildIndexSizeBreakdown().estimatedBytes.total;
	}

	getIndexBreakdown(): Record<string, unknown> | null {
		const sizeBreakdown = this.buildIndexSizeBreakdown();
		return {
			documentCount: this.documents.size,
			documentIdentityCount: this.documentIdByPath.size,
			nextDocumentId: this.nextDocumentId,
			bodyTermCount: this.bodyPostings.size,
			metadataAliasCharTermCount: this.metadataAliasCharPostings.size,
			metadataAliasPhraseTermCount: this.metadataAliasPhrasePostings.size,
			metadataAliasTermCount: this.metadataAliasPostings.size,
			metadataBasenameCharTermCount: this.metadataBasenameCharPostings.size,
			metadataBasenamePhraseTermCount: this.metadataBasenamePhrasePostings.size,
			metadataBasenameTermCount: this.metadataBasenamePostings.size,
			metadataFolderCharTermCount: this.metadataFolderCharPostings.size,
			metadataFolderPhraseTermCount: this.metadataFolderPhrasePostings.size,
			metadataFolderTermCount: this.metadataFolderPostings.size,
			metadataHeadingCharTermCount: 0,
			metadataHeadingPhraseTermCount: this.metadataHeadingPhrasePostings.size,
			metadataHeadingTermCount: this.metadataHeadingPostings.size,
			metadataTermCount: countPostingMapKeyUnion(
				this.getMetadataExactPostingMaps(),
			),
			metadataTagCharTermCount: this.metadataTagCharPostings.size,
			metadataTagFullTermCount: this.metadataTagFullPostings.size,
			metadataTagPhraseTermCount: this.metadataTagPhrasePostings.size,
			metadataTagTermCount: this.metadataTagPostings.size,
			lexiconSize: this.lexicon.size,
			estimatedBytes: sizeBreakdown.estimatedBytes,
		};
	}

	private buildIndexSizeBreakdown(): {
		estimatedBytes: Record<string, unknown> & { total: number };
	} {
		const accumulator = createIndexSizeAccumulator();
		const documents = estimateDocumentStoreBytes(
			this.documents,
			accumulator,
		);
		const documentIdentity = estimateDocumentIdentityBytes(
			this.documentIdByPath,
			this.documentPathById,
			this.documentById,
			this.getResidentDocumentBodyTokenLexiconValues(),
			this.documentBodyTokenIdTape,
			this.documentBodyTokenRangeById,
			this.documentBodyHanSegmentsById,
			this.documentTagValuesById,
			this.nextDocumentId,
			accumulator,
		);
		const postings = Object.fromEntries(
			COVERAGE_LEXICAL_LIVE_POSTING_DESCRIPTORS.map((descriptor) => {
				const postingMap = this.getLivePostingMap(descriptor.key);
				return [
					descriptor.breakdownKey ?? descriptor.key,
					isCoverageLexicalSharedPackedPostingMap(postingMap)
						? estimateSharedPackedPostingMapBytes(
								postingMap,
								accumulator,
								(descriptor.source ?? ("postings." + descriptor.key + ".term")),
							)
						: estimateOwnedNumericPostingMapBytes(
								postingMap,
								accumulator,
								(descriptor.source ?? ("postings." + descriptor.key + ".term")),
								descriptor.ownership,
							),
				] as const;
			}),
		);
		const lexicon = estimateStringArrayBytes(
			this.sortedLexicon,
			accumulator,
			"lexicon.term",
		);
		const total =
			accumulator.stringPoolBytes +
			documents.total +
			documentIdentity.total +
			sumNamedByteBreakdowns(postings) +
			lexicon.total;
		const stringPoolBySource = buildStringPoolAttributionBreakdown(
			accumulator,
		);
		return {
			estimatedBytes: {
				total,
				stringPool: {
					bytes: accumulator.stringPoolBytes,
					uniqueStrings: accumulator.seenStrings.size,
					bySource: stringPoolBySource.bySource,
					byGroup: stringPoolBySource.byGroup,
				},
				documents,
				documentIdentity,
				postings: toNamedByteBreakdown(postings),
				lexicon,
			},
		};
	}

	private indexDocument(document: IndexedDocument): void {
		this.removeDocument(document.path, false);
		const docId = this.ensureDocumentId(document.path);
		this.clearHotCachedOffloadedBodyTokens(docId);
		const documentTextFields = createCoverageLexicalDocumentTextFields(document);
		const storedDocument = createCoverageLexicalDocument(
			docId,
			documentTextFields,
			document.generation,
		);
		const bodyText = document.content ?? "";
		const bodyHanSegments = extractHanSegments(bodyText);
		const derivedState = buildCoverageLexicalDerivedDocumentIndexState(
			this.tokenizer,
			documentTextFields,
			{ bodyText },
		);

		this.documents.set(document.path, storedDocument);
		this.documentById[docId] = storedDocument;
		this.setDocumentBodyTokens(docId, derivedState.bodyTokenSequence);
		this.documentBodyHanSegmentsById[docId] = bodyHanSegments;
		this.documentTagValuesById[docId] = derivedState.tagValues;
		this.stageBodyTokenColdUpsert({
			path: document.path,
			generation: document.generation,
			bodyTokens: derivedState.bodyTokenSequence,
		});
		if (this.shouldExperimentallyOffloadResidentBodyTokens()) {
			this.rememberHotCachedOffloadedBodyTokens(
				docId,
				derivedState.bodyTokenSequence,
			);
		}
		this.applyDerivedPostingTerms(docId, derivedState, "add");
		this.markLexiconDirty();
	}

	private removeDocument(path: string, releaseDocumentIdentity = true): void {
		const existing = this.documents.get(path);
		if (!existing) {
			if (releaseDocumentIdentity) {
				this.releaseDocumentIdentity(path);
			}
			return;
		}

		const docId = existing.docId;
		const derivedState = buildCoverageLexicalDerivedDocumentIndexState(
			this.tokenizer,
			this.getDocumentTextFields(docId),
			{
				existingBodyTokenSequence: [],
				existingTagValues: this.documentTagValuesById[docId],
			},
		);
		this.removeBodyPostingsForDoc(docId);
		this.applyDerivedPostingTerms(docId, derivedState, "remove");
		this.documents.delete(path);
		this.documentById[docId] = undefined;
		this.clearHotCachedOffloadedBodyTokens(docId);
		this.clearDocumentBodyTokens(docId);
		this.compactDocumentBodyTokenLexicon();
		this.documentBodyHanSegmentsById[docId] = undefined;
		this.documentTagValuesById[docId] = undefined;
		this.stageBodyTokenColdDelete(path);
		if (releaseDocumentIdentity) {
			this.releaseDocumentIdentity(path);
		}
		this.rebuildLexicon();
	}

	private ensureDocumentId(path: string): number {
		const existingId = this.documentIdByPath.get(path);
		if (existingId !== undefined) {
			return existingId;
		}
		const docId = this.nextDocumentId;
		this.nextDocumentId += 1;
		this.documentIdByPath.set(path, docId);
		this.documentPathById[docId] = path;
		return docId;
	}

	private releaseDocumentIdentity(path: string): void {
		const existingId = this.documentIdByPath.get(path);
		if (existingId === undefined) {
			return;
		}
		this.documentIdByPath.delete(path);
		this.documentPathById[existingId] = undefined;
	}

	private rebuildLexicon(): void {
		const nextLexicon = new Set<string>();
		for (const descriptor of COVERAGE_LEXICAL_LIVE_POSTING_DESCRIPTORS) {
			if (descriptor.contributesToLexicon !== true) {
				continue;
			}
			for (const term of this.getLivePostingMap(descriptor.key).keys()) {
				nextLexicon.add(term);
			}
		}
		this.lexicon.clear();
		for (const term of nextLexicon) {
			this.lexicon.add(term);
		}
		this.markLexiconDirty();
	}

	private removeBodyPostingsForDoc(docId: number): void {
		const overrides = new Map<number, Uint32Array | undefined>();
		for (const [tokenId, docs] of this.bodyPostings.getTokenIdEntries()) {
			if (docs.indexOf(docId) === -1) {
				continue;
			}
			overrides.set(tokenId, removeDocIdFromSortedPosting(docs, docId));
		}
		this.bodyPostings.updateManyByTokenId(
			overrides,
			this.documentBodyTokenCount,
		);
	}

	private getMetadataExactPostingMaps(): readonly ReadonlyMap<string, readonly number[] | Uint32Array>[] {
		return [
			this.metadataBasenamePostings,
			this.metadataAliasPostings,
			this.metadataFolderPostings,
			this.metadataHeadingPostings,
			this.metadataTagPostings,
		];
	}

	private getBodyTokenColdStore(): CoverageLexicalBodyTokenColdStoreApi | null {
		if (this.coverageLexicalBodyTokenColdStore !== undefined) {
			return this.coverageLexicalBodyTokenColdStore;
		}
		if (!container.isRegistered(COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN, false)) {
			this.coverageLexicalBodyTokenColdStore = null;
			return null;
		}
		try {
			this.coverageLexicalBodyTokenColdStore = container.resolve(
				COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN,
			) as CoverageLexicalBodyTokenColdStoreApi;
		} catch {
			this.coverageLexicalBodyTokenColdStore = null;
		}
		return this.coverageLexicalBodyTokenColdStore;
	}

	private stageBodyTokenColdUpsert(
		document: CoverageLexicalBodyTokenColdDocumentWrite,
	): void {
		this.pendingBodyTokenColdDeletes.delete(document.path);
		this.pendingBodyTokenColdUpsertsByPath.set(document.path, document);
	}

	private stageBodyTokenColdDelete(path: string): void {
		this.pendingBodyTokenColdUpsertsByPath.delete(path);
		this.pendingBodyTokenColdDeletes.add(path);
	}

	private async flushPendingBodyTokenColdStoreWrites(): Promise<void> {
		const deletes = [...this.pendingBodyTokenColdDeletes];
		const upserts = [...this.pendingBodyTokenColdUpsertsByPath.values()];
		this.pendingBodyTokenColdDeletes.clear();
		this.pendingBodyTokenColdUpsertsByPath.clear();
		if (deletes.length === 0 && upserts.length === 0) {
			return await this.bodyTokenColdStoreWriteQueue.catch(() => undefined);
		}
		const queuedWrite = this.bodyTokenColdStoreWriteQueue
			.catch(() => undefined)
			.then(async () => {
				const store = this.getBodyTokenColdStore();
				if (!store) {
					return;
				}
				if (deletes.length > 0) {
					await store.deleteDocuments(deletes);
				}
				if (upserts.length > 0) {
					await store.upsertDocuments(upserts);
				}
			});
		this.bodyTokenColdStoreWriteQueue = queuedWrite;
		await queuedWrite;
	}

	private getFileSnapshotStore(): FileSnapshotStore | null {
		if (this.fileSnapshotStore !== undefined) {
			return this.fileSnapshotStore;
		}
		if (!container.isRegistered(FileSnapshotStore, true)) {
			this.fileSnapshotStore = null;
			return null;
		}
		this.fileSnapshotStore = getInstance(FileSnapshotStore);
		return this.fileSnapshotStore;
	}

	private async getDirectSubitemsSnapshotText(path: string): Promise<string | null> {
		const fileSnapshotStore = this.getFileSnapshotStore();
		if (!fileSnapshotStore) {
			return null;
		}
		const generation = this.documents.get(path)?.generation;
		if (generation !== undefined) {
			return (
				await fileSnapshotStore.readIndexedTexts([{ path, generation }])
			).get(path) ?? null;
		}
		return (await fileSnapshotStore.readCurrentTexts([path])).get(path) ?? null;
	}

	private buildBinarySnapshotState(): CoverageLexicalSnapshotState {
		const bodyTokenLexicon = this.getDocumentBodyTokenLexiconSnapshotValues();
		const livePostingState = this.cloneLivePostingState({
			bodyPostings: cloneSharedTokenIdPostingMapForSnapshot(
				this.bodyPostings,
				bodyTokenLexicon,
				"packed",
			),
		});
		return {
			nextDocumentId: this.nextDocumentId,
			sortedLexicon: [...this.getSortedLexicon()],
			bodyTokenLexicon,
			documents: this.documentById.flatMap((document) =>
				document
					? [
							{
								docId: document.docId,
								path: this.documentPathById[document.docId] ?? "",
								generation: document.generation,
								...this.getDocumentTextFields(document.docId),
								bodyTokenIds: [
									...(this.getDocumentBodyTokenIds(document.docId) ?? []),
								],
								bodyHanSegments: [
									...(this.documentBodyHanSegmentsById[document.docId] ?? []),
								],
								tagValues: [
									...(this.documentTagValuesById[document.docId] ?? []),
								],
							},
					  ]
					: [],
			),
			...livePostingState,
			bodyCharPostings: new Map(),
			bodyHanSegmentPostings: new Map(),
			metadataAliasHanSegmentPostings: new Map(),
			metadataAliasPhrasePostings: new Map(),
			metadataBasenameHanSegmentPostings: new Map(),
			metadataBasenamePhrasePostings: new Map(),
			metadataFolderHanSegmentPostings: new Map(),
			metadataFolderPhrasePostings: new Map(),
			metadataHeadingCharPostings: new Map(),
			metadataHeadingHanSegmentPostings: new Map(),
			metadataHeadingPhrasePostings: new Map(),
			metadataPostings: new Map(),
			metadataTagPhrasePostings: new Map(),
		};
	}

	private restoreBinarySnapshot(
		snapshot: SerializedCoverageLexicalBinarySnapshot,
	): void {
		const state = decodeCoverageLexicalSnapshotV1(snapshot.data);
		this.nextDocumentId = state.nextDocumentId;
		this.lexicon.clear();
		this.sortedLexiconCache = [...state.sortedLexicon];
		this.sortedLexiconDirty = false;
		for (const term of this.sortedLexiconCache) {
			this.lexicon.add(term);
		}
		this.documentBodyTokenCount = state.bodyTokenLexicon.length;
		this.documentBodyTokenLexicon = [];
		this.documentBodyTokenIdByTerm.clear();
		for (let tokenId = 0; tokenId < this.documentBodyTokenCount; tokenId += 1) {
			this.documentBodyTokenIdByTerm.set(
				state.bodyTokenLexicon[tokenId],
				tokenId,
			);
		}
		const bodyTokenIdsById = new Map<number, readonly number[]>();
		for (const document of state.documents) {
			const storedDocument: CoverageLexicalDocument = {
				docId: document.docId,
				generation: document.generation,
				basenameText: document.basenameText,
				folderText: document.folderText,
				aliasesText: document.aliasesText,
				tagsText: document.tagsText,
				headingsText: document.headingsText,
			};
			this.documents.set(document.path, storedDocument);
			this.documentById[document.docId] = storedDocument;
			this.documentIdByPath.set(document.path, document.docId);
			this.documentPathById[document.docId] = document.path;
			bodyTokenIdsById.set(document.docId, [...document.bodyTokenIds]);
			this.documentBodyHanSegmentsById[document.docId] = [
				...document.bodyHanSegments,
			];
			this.documentTagValuesById[document.docId] = [...document.tagValues];
		}
		this.rebuildDocumentBodyTokenTape(bodyTokenIdsById);
		this.restoreLivePostingState(state);
		this.metadataHeadingCharPostings.clear();
		this.offloadResidentDocumentBodyTokens();
	}

	private clearLivePostingMaps(): void {
		for (const descriptor of COVERAGE_LEXICAL_LIVE_POSTING_DESCRIPTORS) {
			this.getLivePostingMap(descriptor.key).clear();
		}
	}

	private getLivePostingMap(
		key: CoverageLexicalLivePostingKey,
	): CoverageLexicalMutableNumericPostingMap {
		switch (key) {
			case "bodyPostings":
				return this.bodyPostings;
			case "metadataAliasCharPostings":
				return this.metadataAliasCharPostings;
			case "metadataAliasPostings":
				return this.metadataAliasPostings;
			case "metadataBasenameCharPostings":
				return this.metadataBasenameCharPostings;
			case "metadataBasenamePostings":
				return this.metadataBasenamePostings;
			case "metadataFolderCharPostings":
				return this.metadataFolderCharPostings;
			case "metadataFolderPostings":
				return this.metadataFolderPostings;
			case "metadataHeadingPostings":
				return this.metadataHeadingPostings;
			case "metadataTagCharPostings":
				return this.metadataTagCharPostings;
			case "metadataTagFullPostings":
				return this.metadataTagFullPostings;
			case "metadataTagPostings":
				return this.metadataTagPostings;
		}
		throw new Error(`Unsupported coverage lexical live posting key: ${key}`);
	}

	private applyDerivedPostingTerms(
		docId: number,
		derivedState: CoverageLexicalDerivedDocumentIndexState,
		mode: "add" | "remove",
	): void {
		for (const binding of COVERAGE_LEXICAL_DERIVED_POSTING_BINDINGS) {
			const rawTerms = derivedState[binding.termsKey] as
				| readonly string[]
				| ReadonlySet<string>;
			const terms = binding.uniqueTerms ? new Set(rawTerms) : rawTerms;
			const descriptor = COVERAGE_LEXICAL_LIVE_POSTING_DESCRIPTOR_BY_KEY.get(
				binding.postingKey,
			);
			if (!descriptor) {
				continue;
			}
			if (binding.postingKey === "bodyPostings") {
				this.mutateBodyPostingTerms(
					docId,
					terms as readonly string[] | ReadonlySet<string>,
					mode,
				);
				if (mode === "add" && descriptor.contributesToLexicon === true) {
					for (const term of terms) {
						this.lexicon.add(term);
					}
				}
				continue;
			}
			for (const term of terms) {
				this.mutateLivePosting(descriptor.key, term, docId, mode);
				if (mode === "add" && descriptor.contributesToLexicon === true) {
					this.lexicon.add(term);
				}
			}
		}
	}

	private mutateBodyPostingTerms(
		docId: number,
		terms: readonly string[] | ReadonlySet<string>,
		mode: "add" | "remove",
	): void {
		const overrides = new Map<string, Uint32Array | undefined>();
		for (const term of terms) {
			const docs = this.bodyPostings.get(term) as Uint32Array | undefined;
			if (mode === "add") {
				if (!docs) {
					overrides.set(term, Uint32Array.of(docId));
					continue;
				}
				if (docs.indexOf(docId) !== -1) {
					continue;
				}
				overrides.set(term, insertDocIdIntoSortedPosting(docs, docId));
				continue;
			}
			if (!docs) {
				continue;
			}
			const nextDocs = removeDocIdFromSortedPosting(docs, docId);
			if (nextDocs === docs) {
				continue;
			}
			overrides.set(term, nextDocs);
		}
		this.bodyPostings.updateMany(overrides);
	}

	private mutateLivePosting(
		key: CoverageLexicalLivePostingKey,
		term: string,
		docId: number,
		mode: "add" | "remove",
	): void {
		const descriptor = COVERAGE_LEXICAL_LIVE_POSTING_DESCRIPTOR_BY_KEY.get(key);
		if (!descriptor) {
			return;
		}
		if (mode === "add") {
			addOwnedNumericPosting(
				this.getLivePostingMap(descriptor.key),
				term,
				docId,
				descriptor.ownership,
			);
			return;
		}
		removeOwnedNumericPosting(
			this.getLivePostingMap(descriptor.key),
			term,
			docId,
			descriptor.ownership,
		);
	}

	private cloneLivePostingState(
		overrides?: Partial<
			Pick<CoverageLexicalSnapshotState, CoverageLexicalLivePostingKey>
		>,
	): Pick<
		CoverageLexicalSnapshotState,
		CoverageLexicalLivePostingKey
	> {
		return Object.fromEntries(
			COVERAGE_LEXICAL_LIVE_POSTING_DESCRIPTORS.map((descriptor) => [
				descriptor.key,
				overrides?.[descriptor.key] ??
					cloneOwnedNumericPostingMap(
						this.getLivePostingMap(descriptor.key),
						descriptor.ownership,
					),
			]),
		) as unknown as Pick<CoverageLexicalSnapshotState, CoverageLexicalLivePostingKey>;
	}

	private restoreLivePostingState(state: CoverageLexicalSnapshotState): void {
		for (const descriptor of COVERAGE_LEXICAL_LIVE_POSTING_DESCRIPTORS) {
			restoreOwnedNumericPostingMap(
				this.getLivePostingMap(descriptor.key),
				state[descriptor.key],
				descriptor.ownership,
			);
		}
	}

	private buildFamilyProbes(queryTerms: readonly string[]): CoverageLexicalFamilyProbe[] {
		const documentCount = this.documentById.reduce(
			(total, document) => total + (document ? 1 : 0),
			0,
		);
		return queryTerms.map((term) => {
			const bodyExactDocCount = getPostingEntryCount(this.bodyPostings.get(term));
			const metadataExactDocCount = getUnionPostingEntryCount([
				this.metadataBasenamePostings.get(term),
				this.metadataAliasPostings.get(term),
				this.metadataFolderPostings.get(term),
				this.metadataHeadingPostings.get(term),
				this.metadataTagPostings.get(term),
			]);
			const combinedExactDocCount = getUnionPostingEntryCount([
				this.bodyPostings.get(term),
				this.metadataBasenamePostings.get(term),
				this.metadataAliasPostings.get(term),
				this.metadataFolderPostings.get(term),
				this.metadataHeadingPostings.get(term),
				this.metadataTagPostings.get(term),
			]);
			const scriptClass = classifyCoverageLexicalFamilyScriptClass(term);
			const lengthWeight = computeCoverageLexicalFamilyLengthWeight(
				term,
				scriptClass,
			);
			const rarityWeight = computeCoverageLexicalFamilyRarityWeight(
				documentCount,
				combinedExactDocCount,
			);
			const weakTokenPenalty = computeCoverageLexicalWeakTokenPenalty(
				term,
				scriptClass,
			);
			const familyWeight = clampCoverageLexicalWeight(
				lengthWeight * rarityWeight * weakTokenPenalty,
				0.18,
				1.35,
			);
			return {
				bodyExactDocCount,
				metadataExactDocCount,
				basenameExactDocCount: getPostingEntryCount(
					this.metadataBasenamePostings.get(term),
				),
				folderExactDocCount: getPostingEntryCount(
					this.metadataFolderPostings.get(term),
				),
				headingExactDocCount: getPostingEntryCount(
					this.metadataHeadingPostings.get(term),
				),
				aliasExactDocCount: getPostingEntryCount(
					this.metadataAliasPostings.get(term),
				),
				combinedExactDocCount,
				scriptClass,
				lengthWeight,
				rarityWeight,
				weakTokenPenalty,
				familyWeight,
				familyTier: classifyCoverageLexicalFamilyTier(term, familyWeight),
			};
		});
	}

	private recordBenchmarkPhaseTiming(
		phase: CoverageLexicalBenchmarkPhaseName,
		elapsedMs: number,
		unitCount: number = 1,
	): void {
		if (!this.benchmarkPhaseTiming || !Number.isFinite(elapsedMs)) {
			return;
		}
		const existing = this.benchmarkPhaseTiming.phases.get(phase);
		if (existing) {
			existing.totalMs += elapsedMs;
			existing.maxMs = Math.max(existing.maxMs, elapsedMs);
			existing.count += 1;
			existing.unitCount += unitCount;
			return;
		}
		this.benchmarkPhaseTiming.phases.set(phase, {
			totalMs: elapsedMs,
			maxMs: elapsedMs,
			count: 1,
			unitCount,
		});
	}

	private recordBenchmarkRecallSubphaseTiming(
		phase: CoverageLexicalRecallBenchmarkSubphaseName,
		elapsedMs: number,
		unitCount: number = 1,
	): void {
		if (!this.benchmarkPhaseTiming || !Number.isFinite(elapsedMs)) {
			return;
		}
		const existing = this.benchmarkPhaseTiming.recallSubphases.get(phase);
		if (existing) {
			existing.totalMs += elapsedMs;
			existing.maxMs = Math.max(existing.maxMs, elapsedMs);
			existing.count += 1;
			existing.unitCount += unitCount;
			return;
		}
		this.benchmarkPhaseTiming.recallSubphases.set(phase, {
			totalMs: elapsedMs,
			maxMs: elapsedMs,
			count: 1,
			unitCount,
		});
	}

	private recordBenchmarkLaneEvaluateSubphaseTiming(
		phase: CoverageLexicalLaneEvaluateBenchmarkSubphaseName,
		elapsedMs: number,
		unitCount: number = 1,
	): void {
		if (!this.benchmarkPhaseTiming || !Number.isFinite(elapsedMs)) {
			return;
		}
		const existing = this.benchmarkPhaseTiming.laneEvaluateSubphases.get(phase);
		if (existing) {
			existing.totalMs += elapsedMs;
			existing.maxMs = Math.max(existing.maxMs, elapsedMs);
			existing.count += 1;
			existing.unitCount += unitCount;
			return;
		}
		this.benchmarkPhaseTiming.laneEvaluateSubphases.set(phase, {
			totalMs: elapsedMs,
			maxMs: elapsedMs,
			count: 1,
			unitCount,
		});
	}

	private createRankableResult(
		docId: number,
		queryTerms: readonly string[],
		plan: CoverageLexicalPlan,
		state: CoverageLexicalCandidateState,
		includeLocalWindow: boolean,
		phraseSignatures: readonly CoverageLexicalPhraseSignature[],
		pairSignatures: readonly CoverageLexicalPairSignature[],
		charQuery: CoverageLexicalCharQuery,
		queryCache: CoverageLexicalEngineQueryCache,
		hydrationMode: "cheap" | "full" = "full",
	): CoverageLexicalDocRankableResult | null {
		const cached = this.getOrCreateRankableDocCacheEntry(
			docId,
			queryTerms,
			plan,
			state,
			phraseSignatures,
			charQuery,
			queryCache,
			hydrationMode,
		);
		if (!cached?.coarseResult) {
			return null;
		}
		if (!includeLocalWindow) {
			return cached.coarseResult;
		}
		if (!cached.hydrated || !cached.bodyEvidenceTrace) {
			return null;
		}
		const bodyTokenSequence = this.getDocumentBodyTokens(
			docId,
			queryCache.bodyTokensByDocId,
		);
		if (!bodyTokenSequence) {
			return null;
		}
		const localWindowStartedAt = this.benchmarkPhaseTiming ? performance.now() : 0;
		const localEvidence = buildCoverageLexicalWindowFusionSignal(
			bodyTokenSequence,
			plan.families,
			pairSignatures,
			computePerFileLocalWindowLimit(plan, bodyTokenSequence.length),
			cached.bodyEvidenceTrace,
		);
		if (this.benchmarkPhaseTiming) {
			this.recordBenchmarkPhaseTiming(
				"localWindow",
				performance.now() - localWindowStartedAt,
				1,
			);
		}
		const signal = withCoverageLexicalLocalEvidence(
			cached.baseSignal,
			localEvidence,
		);
		return {
			...cached.coarseResult,
			matchedTerms: signal.matchedTerms,
			score: computeFallbackScore(signal),
			coverageLexicalSignal: signal,
		};
	}

	private getOrCreateRankableDocCacheEntry(
		docId: number,
		queryTerms: readonly string[],
		plan: CoverageLexicalPlan,
		state: CoverageLexicalCandidateState,
		phraseSignatures: readonly CoverageLexicalPhraseSignature[],
		charQuery: CoverageLexicalCharQuery,
		queryCache: CoverageLexicalEngineQueryCache,
		hydrationMode: "cheap" | "full" = "full",
	): CoverageLexicalEngineQueryDocCacheEntry | null {
		const existing = queryCache.docCacheById.get(docId);
		if (existing && (hydrationMode === "cheap" || existing.hydrated)) {
			return existing;
		}
		const cached =
			existing ??
			this.createCheapRankableDocCacheEntry(
				docId,
				queryTerms,
				plan,
				state,
				phraseSignatures,
				charQuery,
			);
		if (!existing) {
			queryCache.docCacheById.set(docId, cached);
		}
		if (hydrationMode === "cheap") {
			return cached;
		}
		const bodyTokenSequence = this.getDocumentBodyTokens(
			docId,
			queryCache.bodyTokensByDocId,
		);
		if (!bodyTokenSequence) {
			return cached;
		}
		const resolvedState = resolveHydratedCoverageLexicalCandidateState(
			state,
			bodyTokenSequence,
			phraseSignatures,
		);
		const sharedBodyEvidenceTrace =
			queryCache.sharedBodyEvidenceTraceById.get(docId) ?? null;
		let bodyEvidenceTrace = sharedBodyEvidenceTrace;
		if (!bodyEvidenceTrace) {
			const bodyEvidenceStartedAt = this.benchmarkPhaseTiming ? performance.now() : 0;
			bodyEvidenceTrace = buildCoverageLexicalBodyEvidenceTrace(
				bodyTokenSequence,
				plan.families,
				queryCache.fuzzyProportion,
			);
			if (this.benchmarkPhaseTiming) {
				this.recordBenchmarkPhaseTiming(
					"bodyEvidence",
					performance.now() - bodyEvidenceStartedAt,
					1,
				);
			}
			queryCache.sharedBodyEvidenceTraceById.set(docId, bodyEvidenceTrace);
		}
		const admissionStartedAt = this.benchmarkPhaseTiming ? performance.now() : 0;
		const admissionSignal = buildCoverageLexicalPassageAdmissionSignal(
			bodyTokenSequence,
			plan.families,
			resolvedState,
			phraseSignatures,
			bodyEvidenceTrace,
		);
		if (this.benchmarkPhaseTiming) {
			this.recordBenchmarkPhaseTiming(
				"admission",
				performance.now() - admissionStartedAt,
				1,
			);
		}
		const tagValues = this.documentTagValuesById[docId] ?? [];
		const tagFallback = evaluateCoverageLexicalTagFallback(
			tagValues,
			charQuery,
		);
		const baseSignal = buildCoverageSignalBase(
			plan,
			resolvedState,
			phraseSignatures,
			charQuery,
			tagFallback,
		);
		const created = {
			bodyEvidenceTrace,
			admissionSignal,
			baseSignal,
			coarseResult: cached.coarseResult
				? {
						...cached.coarseResult,
						matchedTerms: baseSignal.matchedTerms,
						score: computeFallbackScore(baseSignal),
						coverageLexicalSignal: baseSignal,
						admissionSignal,
				  }
				: null,
			hydrated: true,
		};
		queryCache.docCacheById.set(docId, created);
		return created;
	}

	private createCheapRankableDocCacheEntry(
		docId: number,
		queryTerms: readonly string[],
		plan: CoverageLexicalPlan,
		state: CoverageLexicalCandidateState,
		phraseSignatures: readonly CoverageLexicalPhraseSignature[],
		charQuery: CoverageLexicalCharQuery,
	): CoverageLexicalEngineQueryDocCacheEntry {
		const coarseSignalStartedAt = this.benchmarkPhaseTiming ? performance.now() : 0;
		const tagValues = this.documentTagValuesById[docId] ?? [];
		const tagFallback = evaluateCoverageLexicalTagFallback(
			tagValues,
			charQuery,
		);
		const baseSignal = buildCoverageSignalBase(
			plan,
			state,
			phraseSignatures,
			charQuery,
			tagFallback,
		);
		const admissionSignal = buildCoverageLexicalPassageAdmissionSignal(
			[],
			plan.families,
			state,
			phraseSignatures,
		);
		const coarseResult = hasAnyCoverageLexicalSignal(baseSignal)
			? {
					docId,
					queryTerms: [...queryTerms],
					matchedTerms: baseSignal.matchedTerms,
					score: computeFallbackScore(baseSignal),
					coverageLexicalSignal: baseSignal,
					admissionSignal,
			  }
			: null;
		if (this.benchmarkPhaseTiming) {
			this.recordBenchmarkPhaseTiming(
				"coarseSignal",
				performance.now() - coarseSignalStartedAt,
				1,
			);
		}
		return {
			bodyEvidenceTrace: null,
			admissionSignal,
			baseSignal,
			coarseResult,
			hydrated: false,
		};
	}

	private sortCoarseResults(
		results: readonly CoverageLexicalDocRankableResult[],
		plan: CoverageLexicalPlan,
	): CoverageLexicalDocRankableResult[] {
		return [...results].sort((left, right) => {
			const signalDecision = compareCoverageLexicalResultSignals(
				left.coverageLexicalSignal,
				right.coverageLexicalSignal,
				plan,
			);
			if (signalDecision !== 0) {
				return signalDecision;
			}
			const admissionDecision = compareCoverageLexicalPassageAdmissionSignals(
				left.admissionSignal,
				right.admissionSignal,
			);
			if (admissionDecision !== 0) {
				return admissionDecision;
			}
			return (right.score ?? 0) - (left.score ?? 0) || left.docId - right.docId;
		});
	}

	private computeCoarseHydrationDocIds(
		coarseRanked: readonly CoverageLexicalDocRankableResult[],
		candidates: ReadonlyMap<number, CoverageLexicalCandidateState>,
		plan: CoverageLexicalPlan,
		maxItemResults: number,
	): ReadonlySet<number> {
		const prioritizedRanked = reprioritizeCoverageLexicalExpensiveUpgradeCandidates(
			coarseRanked,
			candidates,
			plan,
		);
		const rankedCount = prioritizedRanked.length;
		if (rankedCount === 0) {
			return new Set<number>();
		}
		const budget = this.computeCoarseHydrationBudget(
			plan,
			maxItemResults,
			rankedCount,
		);
		if (rankedCount <= budget) {
			return new Set(prioritizedRanked.map((result) => result.docId));
		}
		const hydratedDocIds = new Set<number>();
		for (let index = 0; index < budget; index += 1) {
			hydratedDocIds.add(prioritizedRanked[index].docId);
		}
		const cutoff = prioritizedRanked[Math.max(0, budget - 1)];
		const cutoffLowerBound = getCoverageLexicalCoarseHydrationLowerBound(cutoff);
		const extensionLimit = Math.min(
			rankedCount,
			budget + COVERAGE_LEXICAL_OFFLOAD_HYDRATION_TIE_LOOKAHEAD,
		);
		for (let index = budget; index < extensionLimit; index += 1) {
			const candidate = prioritizedRanked[index];
			const state = candidates.get(candidate.docId);
			if (!state) {
				continue;
			}
			const tiesWithCutoff =
				compareCoverageLexicalResultSignals(
					candidate.coverageLexicalSignal,
					cutoff.coverageLexicalSignal,
					plan,
				) === 0 &&
				compareCoverageLexicalPassageAdmissionSignals(
					candidate.admissionSignal,
					cutoff.admissionSignal,
				) === 0;
			const potentialUpperBound = computeCoverageLexicalCoarseHydrationPotentialUpperBound(
				candidate,
				state,
			);
			if (tiesWithCutoff || potentialUpperBound >= cutoffLowerBound) {
				hydratedDocIds.add(candidate.docId);
			}
		}
		if (hydratedDocIds.size >= rankedCount) {
			return hydratedDocIds;
		}
		const unresolvedTailLimit = Math.min(
			rankedCount,
			extensionLimit + COVERAGE_LEXICAL_OFFLOAD_UNRESOLVED_HYDRATION_LOOKAHEAD,
		);
		const unresolvedTailBudget = Math.min(
			COVERAGE_LEXICAL_OFFLOAD_UNRESOLVED_HYDRATION_BUDGET,
			Math.max(0, rankedCount - hydratedDocIds.size),
		);
		if (unresolvedTailBudget <= 0) {
			return hydratedDocIds;
		}
		const unresolvedTailCandidates: Array<{
			docId: number;
			index: number;
			potentialUpperBound: number;
			unresolvedFamilyCount: number;
			unresolvedWeightUpperBound: number;
		}> = [];
		for (let index = extensionLimit; index < unresolvedTailLimit; index += 1) {
			const candidate = prioritizedRanked[index];
			if (hydratedDocIds.has(candidate.docId)) {
				continue;
			}
			const state = candidates.get(candidate.docId);
			if (!state || !hasUnresolvedCoverageLexicalBodyUpgradePotential(state)) {
				continue;
			}
			const potentialUpperBound = computeCoverageLexicalCoarseHydrationPotentialUpperBound(
				candidate,
				state,
			);
			if (potentialUpperBound < cutoffLowerBound) {
				continue;
			}
			unresolvedTailCandidates.push({
				docId: candidate.docId,
				index,
				potentialUpperBound,
				unresolvedFamilyCount:
					state.unresolvedBodyEvidence.unresolvedFamilyCount,
				unresolvedWeightUpperBound:
					state.unresolvedBodyEvidence.unresolvedWeightUpperBound,
			});
		}
		unresolvedTailCandidates.sort((left, right) => {
			const potentialDecision =
				right.potentialUpperBound - left.potentialUpperBound;
			if (potentialDecision !== 0) {
				return potentialDecision;
			}
			const weightDecision =
				right.unresolvedWeightUpperBound - left.unresolvedWeightUpperBound;
			if (weightDecision !== 0) {
				return weightDecision;
			}
			const familyDecision =
				right.unresolvedFamilyCount - left.unresolvedFamilyCount;
			if (familyDecision !== 0) {
				return familyDecision;
			}
			return left.index - right.index;
		});
		for (
			let index = 0;
			index < unresolvedTailCandidates.length &&
			index < unresolvedTailBudget;
			index += 1
		) {
			hydratedDocIds.add(unresolvedTailCandidates[index].docId);
		}
		return hydratedDocIds;
	}

	private computeCoarseHydrationBudget(
		plan: CoverageLexicalPlan,
		maxItemResults: number,
		candidateCount: number,
	): number {
		const requested = Math.max(1, maxItemResults);
		const hints = getCoverageLexicalResourceHints(plan);
		const minBudget = Math.round(
			24 +
				Math.min(
					32,
					hints.localWitnessBudget * 14 + hints.memoryBudget * 16,
				) +
				Math.min(14, hints.hybridBudget * 8) +
				Math.min(12, hints.bridgeBudget * 8),
		);
		const multiplier = Math.max(
			4,
			Math.round(
				4 +
					hints.bodyBudget * 2.5 +
					hints.hybridBudget * 2 +
					hints.memoryBudget * 2.5 +
					hints.bridgeBudget * 1.5,
			),
		);
		const cap = Math.round(
			64 +
				Math.min(
					56,
					hints.localWitnessBudget * 24 + hints.memoryBudget * 28,
				) +
				Math.min(24, hints.hybridBudget * 16) +
				Math.min(24, hints.bridgeBudget * 16),
		);
		return Math.min(
			candidateCount,
			Math.min(cap, Math.max(minBudget, requested * multiplier)),
		);
	}

}

function classifyCoverageLexicalFamilyScriptClass(
	term: string,
): CoverageLexicalFamilyScriptClass {
	const hanCharCount = countCoverageLexicalHanChars(term);
	const latinCharCount = countCoverageLexicalLatinChars(term);
	if (hanCharCount > 0 && latinCharCount > 0) {
		return "mixed";
	}
	if (hanCharCount > 0) {
		return "han";
	}
	if (latinCharCount > 0) {
		return "latin";
	}
	return "other";
}

function computeCoverageLexicalFamilyLengthWeight(
	term: string,
	scriptClass: CoverageLexicalFamilyScriptClass,
): number {
	const hanLenMass =
		1 - Math.exp(-0.9 * Math.max(countCoverageLexicalHanChars(term) - 1, 0));
	const latinLenMass =
		1 - Math.exp(-0.28 * Math.max(countCoverageLexicalLatinChars(term) - 2, 0));
	const lengthMass =
		scriptClass === "han"
			? hanLenMass
			: scriptClass === "latin"
				? latinLenMass
				: Math.max(hanLenMass, latinLenMass);
	return 0.35 + 0.65 * lengthMass;
}

function computeCoverageLexicalFamilyRarityWeight(
	documentCount: number,
	combinedExactDocCount: number,
): number {
	return clampCoverageLexicalWeight(
		0.85 +
			0.25 *
				Math.log2(
					(Math.max(1, documentCount) + 8) / (combinedExactDocCount + 8),
				),
		0.8,
		1.25,
	);
}

function computeCoverageLexicalWeakTokenPenalty(
	term: string,
	scriptClass: CoverageLexicalFamilyScriptClass,
): number {
	const hanCharCount = countCoverageLexicalHanChars(term);
	const latinCharCount = countCoverageLexicalLatinChars(term);
	if (scriptClass === "han" && hanCharCount === 1) {
		return 0.35;
	}
	if (scriptClass === "latin" && latinCharCount <= 2) {
		return 0.55;
	}
	if (/^(?:[_./\\-]+|v?\d+(?:[._-]\d+)+)$/u.test(term)) {
		return 0.45;
	}
	return 1;
}

function classifyCoverageLexicalFamilyTier(
	term: string,
	familyWeight: number,
): CoverageLexicalFamilyTier {
	if (countCoverageLexicalHanChars(term) === 1 && term.length === 1) {
		return "weak";
	}
	if (familyWeight >= 0.72) {
		return "decisive";
	}
	if (familyWeight >= 0.45) {
		return "support";
	}
	return "weak";
}

function countCoverageLexicalHanChars(term: string): number {
	return term.match(/\p{Script=Han}/gu)?.length ?? 0;
}

function countCoverageLexicalLatinChars(term: string): number {
	return term.match(/\p{Script=Latin}/gu)?.length ?? 0;
}

function clampCoverageLexicalWeight(
	value: number,
	min: number,
	max: number,
): number {
	return Math.min(max, Math.max(min, value));
}

function hasUnresolvedCoverageLexicalBodyUpgradePotential(
	state: CoverageLexicalCandidateState,
): boolean {
	const unresolved = state.unresolvedBodyEvidence;
	return (
		unresolved.needsPassageSignal ||
		unresolved.hasUnverifiedPhraseWitness ||
		unresolved.hasUnresolvedPrefixSurface ||
		unresolved.hasUnresolvedBodyCharVerification ||
		unresolved.unresolvedFamilyCount > 0 ||
		unresolved.unresolvedWeightUpperBound > 0
	);
}

function getCoverageLexicalCoarseHydrationLowerBound(
	result: CoverageLexicalDocRankableResult,
): number {
	return Math.max(
		result.coverageLexicalSignal.evidenceMassSummary?.displayRawMass ??
			result.score ??
			0,
		computeCoverageLexicalCoarseHydrationProfileLowerBound(
			result.coverageLexicalSignal,
		),
	);
}

function computeCoverageLexicalCoarseHydrationPotentialUpperBound(
	result: CoverageLexicalDocRankableResult,
	state: CoverageLexicalCandidateState,
): number {
	const unresolved = state.unresolvedBodyEvidence;
	let potentialUpperBound = getCoverageLexicalCoarseHydrationLowerBound(result);
	potentialUpperBound += unresolved.unresolvedWeightUpperBound;
	if (unresolved.needsPassageSignal) {
		potentialUpperBound +=
			COVERAGE_LEXICAL_COARSE_HYDRATION_PASSAGE_UPPER_BOUND;
	}
	if (
		unresolved.hasUnverifiedPhraseWitness ||
		state.phraseMatches.length > 0
	) {
		potentialUpperBound +=
			COVERAGE_LEXICAL_COARSE_HYDRATION_PHRASE_UPPER_BOUND;
	}
	if (
		unresolved.hasUnresolvedPrefixSurface ||
		state.bodyPrefixWitness !== null
	) {
		potentialUpperBound +=
			COVERAGE_LEXICAL_COARSE_HYDRATION_PREFIX_UPPER_BOUND;
	}
	if (
		unresolved.hasUnresolvedBodyCharVerification ||
		state.bodyCharMatchIndices.length > 0
	) {
		potentialUpperBound +=
			COVERAGE_LEXICAL_COARSE_HYDRATION_CHAR_UPPER_BOUND;
	}
	potentialUpperBound += computeCoverageLexicalCoarseHydrationProfilePotentialUpperBound(
		result.coverageLexicalSignal,
		unresolved,
	);
	return potentialUpperBound;
}

function computeCoverageLexicalCoarseHydrationProfileLowerBound(
	signal: CoverageLexicalFamilySignal,
): number {
	const profile = signal.coverageProfile;
	if (profile.requiredFamilyWeight > 0) {
		return profile.requiredCoveredFamilyWeight / profile.requiredFamilyWeight;
	}
	if (profile.meaningfulFamilyWeight > 0) {
		return (
			profile.meaningfulCoveredFamilyWeight / profile.meaningfulFamilyWeight
		);
	}
	return 0;
}

function computeCoverageLexicalCoarseHydrationProfilePotentialUpperBound(
	signal: CoverageLexicalFamilySignal,
	unresolved: CoverageLexicalCandidateState["unresolvedBodyEvidence"],
): number {
	if (unresolved.unresolvedFamilyCount <= 0) {
		return 0;
	}
	const profile = signal.coverageProfile;
	const missingRequiredFamilyCount = Math.max(
		0,
		profile.requiredFamilyCount - profile.requiredCoveredFamilyCount,
	);
	const missingSupportFamilyCount = Math.max(
		0,
		profile.supportFamilyCount - profile.supportCoveredFamilyCount,
	);
	const recoverableRequiredFamilyCount = Math.min(
		unresolved.unresolvedFamilyCount,
		missingRequiredFamilyCount,
	);
	const recoverableSupportFamilyCount = Math.min(
		Math.max(0, unresolved.unresolvedFamilyCount - recoverableRequiredFamilyCount),
		missingSupportFamilyCount,
	);
	let potentialUpperBound =
		recoverableRequiredFamilyCount *
			COVERAGE_LEXICAL_COARSE_HYDRATION_REQUIRED_FAMILY_UPPER_BOUND +
		recoverableSupportFamilyCount *
			COVERAGE_LEXICAL_COARSE_HYDRATION_SUPPORT_FAMILY_UPPER_BOUND;
	if (
		profile.crossScriptRequired &&
		!profile.crossScriptSatisfied &&
		unresolved.unresolvedFamilyCount > 0
	) {
		potentialUpperBound +=
			COVERAGE_LEXICAL_COARSE_HYDRATION_CROSS_SCRIPT_UPPER_BOUND;
	}
	return potentialUpperBound;
}

function buildCoverageLexicalBenchmarkOffloadSearchDebug(options: {
	queryText: string;
	offloadEnabled: boolean;
	stagedHydration: boolean;
	candidates: ReadonlyMap<number, CoverageLexicalCandidateState>;
	cheapCoarseRanked: readonly CoverageLexicalDocRankableResult[];
	coarseHydrationDocIds: ReadonlySet<number>;
	localWindowDocIds: ReadonlySet<number>;
	finalRanked: readonly CoverageLexicalDocRankableResult[];
	documentPathById: readonly (string | undefined)[];
	hasResidentDocumentBodyTokens: (docId: number) => boolean;
}): CoverageLexicalBenchmarkOffloadSearchDebug {
	const cheapCoarseRankByDocId = new Map<number, number>();
	for (let index = 0; index < options.cheapCoarseRanked.length; index += 1) {
		cheapCoarseRankByDocId.set(options.cheapCoarseRanked[index].docId, index + 1);
	}
	const finalRankByDocId = new Map<number, number>();
	for (let index = 0; index < options.finalRanked.length; index += 1) {
		finalRankByDocId.set(options.finalRanked[index].docId, index + 1);
	}
	const selectedDocIds = new Set<number>();
	for (const result of options.cheapCoarseRanked.slice(0, 12)) {
		selectedDocIds.add(result.docId);
	}
	for (const docId of options.coarseHydrationDocIds) {
		selectedDocIds.add(docId);
	}
	for (const docId of options.localWindowDocIds) {
		selectedDocIds.add(docId);
	}
	for (const [docId, state] of options.candidates.entries()) {
		if (hasUnresolvedCoverageLexicalBodyUpgradePotential(state)) {
			selectedDocIds.add(docId);
		}
	}
	const docs = Array.from(selectedDocIds)
		.map((docId) => {
			const state = options.candidates.get(docId);
			if (!state) {
				return null;
			}
			return {
				docId,
				path: options.documentPathById[docId] ?? null,
				cheapCoarseRank: cheapCoarseRankByDocId.get(docId) ?? null,
				finalRank: finalRankByDocId.get(docId) ?? null,
				hydratedAtCoarse: options.coarseHydrationDocIds.has(docId),
				selectedForLocalWindow: options.localWindowDocIds.has(docId),
				hasResidentBodyTokens: options.hasResidentDocumentBodyTokens(docId),
				bodyMatchCount: state.bodyMatches.length,
				phraseMatchCount: state.phraseMatches.length,
				hasBodyPrefixWitness: state.bodyPrefixWitness !== null,
				bodyCharMatchCount: state.bodyCharMatchIndices.length,
				unresolvedBodyEvidence: {
					...state.unresolvedBodyEvidence,
				},
			};
		})
		.filter(
			(doc): doc is CoverageLexicalBenchmarkOffloadDocDebug => doc !== null,
		)
		.sort(
			(left, right) =>
				(left.cheapCoarseRank ?? Number.MAX_SAFE_INTEGER) -
					(right.cheapCoarseRank ?? Number.MAX_SAFE_INTEGER) ||
				left.docId - right.docId,
		);
	return {
		queryText: options.queryText,
		offloadEnabled: options.offloadEnabled,
		stagedHydration: options.stagedHydration,
		candidateCount: options.candidates.size,
		cheapCoarseTopDocIds: options.cheapCoarseRanked
			.slice(0, 10)
			.map((result) => result.docId),
		coarseHydrationDocIds: [...options.coarseHydrationDocIds],
		localWindowDocIds: [...options.localWindowDocIds],
		finalTopDocIds: options.finalRanked.slice(0, 10).map((result) => result.docId),
		docs,
	};
}

function buildCoverageSignalBase(
	plan: CoverageLexicalPlan,
	state: CoverageLexicalCandidateState,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	charQuery: CoverageLexicalCharQuery,
	tagFallback: ReturnType<typeof evaluateCoverageLexicalTagFallback>,
): CoverageLexicalFamilySignal {
	const families = plan.families;
	const probes = plan.probes ?? [];
	const coreBody = createEmptyAreaSignal();
	const softBody = createEmptyAreaSignal();
	const metadataAnchor = createEmptyAreaSignal();
	const metadataPrefixAssist = createEmptyAreaSignal();
	const metadataIdentity = createEmptyMetadataIdentitySignal();
	const bodyChar = createEmptyCharSignal();
	const metadataChar = createEmptyCharSignal();
	const coverageProfile = createEmptyCoverageLexicalCoverageProfile();
	const evidenceMassSummary = createEmptyCoverageLexicalEvidenceMassSummary();
	evidenceMassSummary.displayIdealMass =
		computeCoverageLexicalEvidenceIdealDisplayMass(probes, families);
	let bodyPrefixWitness: CoverageLexicalPrefixWitness | null = null;
	let metadataPrefixWitness: CoverageLexicalPrefixWitness | null = null;
	let tailCoreWeight = 0;
	let tailSoftWeight = 0;
	const matchedTerms: string[] = [];
	const matchedTermSet = new Set<string>();
	const requiredFamilyIndices = new Set<number>([
		...plan.hardAnchorFamilies.map((family) => family.index),
		...plan.decisiveBodyFamilies.map((family) => family.index),
		...plan.supportBodyFamilies.map((family) => family.index),
	]);

	for (const family of families) {
		const familyIndex = family.index;
		const probe = probes[familyIndex];
		const familyWeight = getCoverageLexicalProbeFamilyWeight(probe);
		const familyTier = getCoverageLexicalProbeFamilyTier(probe);
		const familyScriptClass = getCoverageLexicalProbeScriptClass(
			probe,
			family.normalizedTerm,
		);
		const countsAsMeaningfulFamily = familyTier !== "weak";
		const countsAsRequiredFamily = requiredFamilyIndices.has(familyIndex);
		const bodyCode = state.bodyMatches[familyIndex] ?? 0;
		const metadataCode = state.metadataMatches[familyIndex] ?? 0;
		const aliasAssistCode =
			state.metadataAssistFieldMatches.aliases[familyIndex] ?? 0;
		const basenameAssistCode =
			state.metadataAssistFieldMatches.basename[familyIndex] ?? 0;
		const folderAssistCode =
			state.metadataAssistFieldMatches.folder[familyIndex] ?? 0;
		const headingsAssistCode =
			state.metadataAssistFieldMatches.headings[familyIndex] ?? 0;
		const tagsAssistCode =
			state.metadataAssistFieldMatches.tags[familyIndex] ?? 0;
		const assistCode = Math.max(
			aliasAssistCode,
			basenameAssistCode,
			folderAssistCode,
			headingsAssistCode,
			tagsAssistCode,
		);
		if (family.role !== "noise") {
			accumulateCoverageLexicalCoverageProfileTotals(
				coverageProfile,
				familyTier,
				familyScriptClass,
				familyWeight,
				countsAsMeaningfulFamily,
				countsAsRequiredFamily,
			);
		}
		if (
			family.role === "noise" ||
			(bodyCode === 0 && metadataCode === 0 && assistCode === 0)
		) {
			continue;
		}

		const aliasCode = state.metadataFieldMatches.aliases[familyIndex] ?? 0;
		const basenameCode = state.metadataFieldMatches.basename[familyIndex] ?? 0;
		const folderCode = state.metadataFieldMatches.folder[familyIndex] ?? 0;
		const headingsCode = state.metadataFieldMatches.headings[familyIndex] ?? 0;
		const tagsCode = state.metadataFieldMatches.tags[familyIndex] ?? 0;
		const weight = computeFamilyTailWeight(familyIndex);
		const hasFamilyCoverage = bodyCode > 0 || metadataCode > 0 || assistCode > 0;

		if (!matchedTermSet.has(family.normalizedTerm)) {
			matchedTermSet.add(family.normalizedTerm);
			matchedTerms.push(family.normalizedTerm);
		}

		const bestMetadataEvidence = selectBestCoverageLexicalMetadataEvidence({
			metadataCode,
			aliasCode,
			basenameCode,
			folderCode,
			headingsCode,
			tagsCode,
			aliasAssistCode,
			basenameAssistCode,
			folderAssistCode,
			headingsAssistCode,
			tagsAssistCode,
		});
		if (hasFamilyCoverage) {
			accumulateCoverageLexicalCoverageProfileCovered(
				coverageProfile,
				familyTier,
				familyScriptClass,
				familyWeight,
				countsAsMeaningfulFamily,
				countsAsRequiredFamily,
			);
		}
		accumulateCoverageLexicalFamilyEvidenceMass(
			evidenceMassSummary,
			familyTier,
			familyWeight,
			bodyCode,
			bestMetadataEvidence,
		);

		if (family.role === "body") {
			if (bodyCode > 0 && family.strength === "core") {
				applyMatchCode(coreBody, bodyCode, weight);
				tailCoreWeight += weight;
				continue;
			}
			if (bodyCode > 0) {
				applyMatchCode(softBody, bodyCode, weight);
				tailSoftWeight += weight;
				continue;
			}
			if (metadataCode > 0) {
				const boostedWeight =
					weight *
					computeMetadataFieldBoostFromCodes(
						metadataCode,
						basenameCode,
						aliasCode,
						folderCode,
						headingsCode,
						tagsCode,
					);
				applyMatchCode(softBody, metadataCode, boostedWeight);
				tailSoftWeight += boostedWeight;
				applyIdentityMatchFromCodes(
					metadataIdentity,
					aliasCode,
					basenameCode,
					headingsCode,
					folderCode,
					tagsCode,
					weight,
				);
				continue;
			}
			if (assistCode > 0) {
				applyMatchCode(
					metadataPrefixAssist,
					assistCode,
					weight *
						METADATA_ASSIST_SIGNAL_WEIGHT *
						computeMetadataFieldBoostFromCodes(
							assistCode,
							basenameAssistCode,
							aliasAssistCode,
							folderAssistCode,
							headingsAssistCode,
							tagsAssistCode,
						),
				);
				applyIdentityMatchFromCodes(
					metadataIdentity,
					aliasAssistCode,
					basenameAssistCode,
					headingsAssistCode,
					folderAssistCode,
					tagsAssistCode,
					weight * METADATA_ASSIST_IDENTITY_WEIGHT,
				);
			}
			continue;
		}

		if (family.role === "anchor") {
			if (metadataCode > 0) {
				applyMatchCode(
					metadataAnchor,
					metadataCode,
					weight *
						computeMetadataFieldBoostFromCodes(
							metadataCode,
							basenameCode,
							aliasCode,
							folderCode,
							headingsCode,
							tagsCode,
						),
				);
				applyIdentityMatchFromCodes(
					metadataIdentity,
					aliasCode,
					basenameCode,
					headingsCode,
					folderCode,
					tagsCode,
					weight,
				);
				continue;
			}
			if (bodyCode > 0) {
				applyMatchCode(softBody, bodyCode, weight);
				tailSoftWeight += weight;
			}
		}
		if (bodyCode === 0 && metadataCode === 0 && assistCode > 0) {
			applyMatchCode(
				metadataPrefixAssist,
				assistCode,
				weight *
					METADATA_ASSIST_SIGNAL_WEIGHT *
					computeMetadataFieldBoostFromCodes(
						assistCode,
						basenameAssistCode,
						aliasAssistCode,
						folderAssistCode,
						headingsAssistCode,
						tagsAssistCode,
					),
			);
			applyIdentityMatchFromCodes(
				metadataIdentity,
				aliasAssistCode,
				basenameAssistCode,
				headingsAssistCode,
				folderAssistCode,
				tagsAssistCode,
				weight * METADATA_ASSIST_IDENTITY_WEIGHT,
			);
		}
	}

	bodyPrefixWitness = state.bodyPrefixWitness;
	metadataPrefixWitness = state.metadataPrefixWitness;

	for (const phraseIndex of state.phraseMatches) {
		const signature = phraseSignatures[phraseIndex];
		if (!signature?.preferredFields?.length) {
			continue;
		}
		metadataIdentity.phraseCoverageCount += 1;
		metadataIdentity.phraseWeight += signature.tailWeight;
	}

	bodyChar.matchCount = state.bodyCharMatchIndices.length;
	bodyChar.matchRatio = computeCharMatchRatio(
		state.bodyCharMatchIndices.length,
		charQuery.terms.length,
	);
	applySegmentCoverageSignal(bodyChar, state.bodyCharMatchFlags, charQuery);
	metadataChar.matchCount = state.metadataCharMatchIndices.length;
	metadataChar.matchRatio = computeCharMatchRatio(
		state.metadataCharMatchIndices.length,
		charQuery.terms.length,
	);
	applySegmentCoverageSignal(
		metadataChar,
		state.metadataCharMatchFlags,
		charQuery,
	);
	for (const term of tagFallback.exactTerms) {
		if (!matchedTermSet.has(term)) {
			matchedTermSet.add(term);
			matchedTerms.push(term);
		}
	}
	finalizeCoverageLexicalCoverageProfile(coverageProfile);
	return finalizeCoverageLexicalEvidenceMassSummary({
		coverageProfile,
		evidenceMassSummary,
		coreBody,
		softBody,
		metadataAnchor,
		metadataPrefixAssist,
		metadataIdentity,
		bodyPrefixWitness,
		metadataPrefixWitness,
		bodyChar,
		metadataChar,
		tagSignal: {
			exactMatchCount: tagFallback.exactMatchCount,
			charMatchCount: tagFallback.charMatchCount,
			charMatchRatio: tagFallback.charMatchRatio,
		},
		tailCoreWeight,
		tailSoftWeight,
		phraseBridgeCount: state.phraseMatches.length,
		phraseBridgeWeight: state.phraseMatches.reduce(
			(total, index) => total + (phraseSignatures[index]?.tailWeight ?? 0),
			0,
		),
		localEvidence: createEmptyCoverageLexicalWindowFusionSignal(),
		matchedTerms,
	});
}

function withCoverageLexicalLocalEvidence(
	baseSignal: CoverageLexicalFamilySignal,
	localEvidence: CoverageLexicalFamilySignal["localEvidence"],
): CoverageLexicalFamilySignal {
	return finalizeCoverageLexicalEvidenceMassSummary({
		...baseSignal,
		localEvidence,
	});
}

function hasAnyCoverageLexicalSignal(
	signal: CoverageLexicalFamilySignal,
): boolean {
	return !(
		signal.coreBody.coverageCount === 0 &&
		signal.softBody.coverageCount === 0 &&
		signal.metadataAnchor.coverageCount === 0 &&
		signal.metadataIdentity.phraseCoverageCount === 0 &&
		signal.metadataIdentity.overall.coverageCount === 0 &&
		signal.bodyChar.matchCount === 0 &&
		signal.metadataChar.matchCount === 0 &&
		signal.tagSignal.exactMatchCount === 0 &&
		signal.tagSignal.charMatchCount === 0
	);
}

function createEmptyAreaSignal(): CoverageLexicalAreaSignal {
	return {
		coverageCount: 0,
		exactWeight: 0,
		prefixWeight: 0,
		fuzzyWeight: 0,
	};
}

function createEmptyCoverageLexicalCoverageProfile(): CoverageLexicalCoverageProfile {
	return {
		meaningfulFamilyCount: 0,
		meaningfulCoveredFamilyCount: 0,
		meaningfulFamilyWeight: 0,
		meaningfulCoveredFamilyWeight: 0,
		requiredFamilyCount: 0,
		requiredCoveredFamilyCount: 0,
		requiredFamilyWeight: 0,
		requiredCoveredFamilyWeight: 0,
		decisiveFamilyCount: 0,
		decisiveCoveredFamilyCount: 0,
		decisiveFamilyWeight: 0,
		decisiveCoveredFamilyWeight: 0,
		supportFamilyCount: 0,
		supportCoveredFamilyCount: 0,
		supportFamilyWeight: 0,
		supportCoveredFamilyWeight: 0,
		requiredHanFamilyCount: 0,
		requiredHanCoveredFamilyCount: 0,
		requiredLatinFamilyCount: 0,
		requiredLatinCoveredFamilyCount: 0,
		crossScriptRequired: false,
		crossScriptSatisfied: false,
	};
}

function createEmptyCharSignal(): {
	matchCount: number;
	matchRatio: number;
	exactSegmentCount: number;
	fullSegmentCount: number;
	bestSegmentCoverageCount: number;
	bestSegmentCoverageRatio: number;
} {
	return {
		matchCount: 0,
		matchRatio: 0,
		exactSegmentCount: 0,
		fullSegmentCount: 0,
		bestSegmentCoverageCount: 0,
		bestSegmentCoverageRatio: 0,
	};
}

function createEmptyMetadataIdentitySignal(): CoverageLexicalMetadataIdentitySignal {
	return {
		phraseCoverageCount: 0,
		phraseWeight: 0,
		overall: createEmptyAreaSignal(),
		alias: createEmptyAreaSignal(),
		basename: createEmptyAreaSignal(),
		heading: createEmptyAreaSignal(),
		path: createEmptyAreaSignal(),
		tag: createEmptyAreaSignal(),
	};
}

function getCoverageLexicalProbeFamilyWeight(
	probe: CoverageLexicalFamilyProbe | undefined,
): number {
	return probe?.familyWeight ?? 1;
}

function getCoverageLexicalProbeFamilyTier(
	probe: CoverageLexicalFamilyProbe | undefined,
): CoverageLexicalFamilyTier {
	return probe?.familyTier ?? "support";
}

function getCoverageLexicalProbeScriptClass(
	probe: CoverageLexicalFamilyProbe | undefined,
	term: string,
): CoverageLexicalFamilyScriptClass {
	return probe?.scriptClass ?? classifyCoverageLexicalFamilyScriptClass(term);
}

function accumulateCoverageLexicalCoverageProfileTotals(
	profile: CoverageLexicalCoverageProfile,
	familyTier: CoverageLexicalFamilyTier,
	scriptClass: CoverageLexicalFamilyScriptClass,
	familyWeight: number,
	countsAsMeaningfulFamily: boolean,
	countsAsRequiredFamily: boolean,
): void {
	if (countsAsMeaningfulFamily) {
		profile.meaningfulFamilyCount += 1;
		profile.meaningfulFamilyWeight += familyWeight;
	}
	if (countsAsRequiredFamily) {
		profile.requiredFamilyCount += 1;
		profile.requiredFamilyWeight += familyWeight;
		if (scriptClass === "han") {
			profile.requiredHanFamilyCount += 1;
		}
		if (scriptClass === "latin") {
			profile.requiredLatinFamilyCount += 1;
		}
	}
	if (familyTier === "decisive") {
		profile.decisiveFamilyCount += 1;
		profile.decisiveFamilyWeight += familyWeight;
		return;
	}
	if (familyTier === "support") {
		profile.supportFamilyCount += 1;
		profile.supportFamilyWeight += familyWeight;
	}
}

function accumulateCoverageLexicalCoverageProfileCovered(
	profile: CoverageLexicalCoverageProfile,
	familyTier: CoverageLexicalFamilyTier,
	scriptClass: CoverageLexicalFamilyScriptClass,
	familyWeight: number,
	countsAsMeaningfulFamily: boolean,
	countsAsRequiredFamily: boolean,
): void {
	if (countsAsMeaningfulFamily) {
		profile.meaningfulCoveredFamilyCount += 1;
		profile.meaningfulCoveredFamilyWeight += familyWeight;
	}
	if (countsAsRequiredFamily) {
		profile.requiredCoveredFamilyCount += 1;
		profile.requiredCoveredFamilyWeight += familyWeight;
		if (scriptClass === "han") {
			profile.requiredHanCoveredFamilyCount += 1;
		}
		if (scriptClass === "latin") {
			profile.requiredLatinCoveredFamilyCount += 1;
		}
	}
	if (familyTier === "decisive") {
		profile.decisiveCoveredFamilyCount += 1;
		profile.decisiveCoveredFamilyWeight += familyWeight;
		return;
	}
	if (familyTier === "support") {
		profile.supportCoveredFamilyCount += 1;
		profile.supportCoveredFamilyWeight += familyWeight;
	}
}

function finalizeCoverageLexicalCoverageProfile(
	profile: CoverageLexicalCoverageProfile,
): void {
	profile.crossScriptRequired =
		profile.requiredHanFamilyCount > 0 && profile.requiredLatinFamilyCount > 0;
	profile.crossScriptSatisfied =
		!profile.crossScriptRequired ||
		(
			profile.requiredHanCoveredFamilyCount > 0 &&
			profile.requiredLatinCoveredFamilyCount > 0
		);
}

function selectBestCoverageLexicalMetadataEvidence(input: {
	metadataCode: number;
	aliasCode: number;
	basenameCode: number;
	folderCode: number;
	headingsCode: number;
	tagsCode: number;
	aliasAssistCode: number;
	basenameAssistCode: number;
	folderAssistCode: number;
	headingsAssistCode: number;
	tagsAssistCode: number;
}):
	| {
			code: number;
			field: CoverageLexicalMetadataField | null;
			fieldConfidence: number;
	  }
	| null {
	const candidates: Array<{
		code: number;
		field: CoverageLexicalMetadataField | null;
		fieldConfidence: number;
	}> = [];
	const pushCandidate = (
		code: number,
		field: CoverageLexicalMetadataField,
	): void => {
		if (code <= 0) {
			return;
		}
		candidates.push({
			code,
			field,
			fieldConfidence: COVERAGE_LEXICAL_IDENTITY_FIELD_CONFIDENCE[field],
		});
	};
	pushCandidate(input.basenameCode, "basename");
	pushCandidate(input.aliasCode, "aliases");
	pushCandidate(input.headingsCode, "headings");
	pushCandidate(input.folderCode, "folder");
	pushCandidate(input.tagsCode, "tags");
	pushCandidate(input.basenameAssistCode, "basename");
	pushCandidate(input.aliasAssistCode, "aliases");
	pushCandidate(input.headingsAssistCode, "headings");
	pushCandidate(input.folderAssistCode, "folder");
	pushCandidate(input.tagsAssistCode, "tags");
	if (input.metadataCode > 0) {
		candidates.push({
			code: input.metadataCode,
			field: null,
			fieldConfidence: 0.76,
		});
	}
	if (candidates.length === 0) {
		return null;
	}
	candidates.sort(
		(left, right) =>
			right.code - left.code ||
			right.fieldConfidence - left.fieldConfidence,
	);
	return candidates[0];
}

function accumulateCoverageLexicalFamilyEvidenceMass(
	summary: CoverageLexicalEvidenceMassSummary,
	familyTier: CoverageLexicalFamilyTier,
	familyWeight: number,
	bodyCode: number,
	metadataEvidence:
		| {
				code: number;
				field: CoverageLexicalMetadataField | null;
				fieldConfidence: number;
		  }
		| null,
): void {
	if (familyTier === "weak") {
		return;
	}
	const bodyKind = getCoverageLexicalFamilyMatchKindFromCode(bodyCode);
	const metadataKind = getCoverageLexicalFamilyMatchKindFromCode(
		metadataEvidence?.code ?? 0,
	);
	const bodyRank = getCoverageLexicalEvidencePreferenceRank(bodyKind, "body");
	const metadataRank = getCoverageLexicalEvidencePreferenceRank(
		metadataKind,
		"identity",
	);
	const useMetadata =
		metadataRank > bodyRank ||
		(metadataRank === bodyRank &&
			(metadataEvidence?.fieldConfidence ?? 0) > 1);
	if (!bodyKind && !metadataKind) {
		return;
	}
	if (familyTier === "decisive") {
		summary.decisiveCoveredMass += familyWeight;
	} else {
		summary.supportCoveredMass += familyWeight;
	}
	if (useMetadata && metadataKind) {
		accumulateCoverageLexicalEvidenceBucket(
			summary,
			familyTier,
			"identity",
			metadataKind,
			familyWeight,
			metadataEvidence?.fieldConfidence ?? 0.76,
		);
		return;
	}
	if (bodyKind) {
		accumulateCoverageLexicalEvidenceBucket(
			summary,
			familyTier,
			"body",
			bodyKind,
			familyWeight,
			1,
		);
	}
}

function getCoverageLexicalFamilyMatchKindFromCode(
	code: number,
): Exclude<CoverageFamilyMatchKind, null> | null {
	if (code === 3) {
		return "exact";
	}
	if (code === 2) {
		return "prefix";
	}
	if (code === 1) {
		return "fuzzy";
	}
	return null;
}

function getCoverageLexicalEvidencePreferenceRank(
	kind: Exclude<CoverageFamilyMatchKind, null> | null,
	channel: "identity" | "body",
): number {
	if (!kind) {
		return 0;
	}
	if (kind === "exact") {
		return channel === "identity" ? 6 : 5;
	}
	if (kind === "prefix") {
		return channel === "identity" ? 4 : 3;
	}
	return channel === "identity" ? 2 : 1;
}

function accumulateCoverageLexicalEvidenceBucket(
	summary: CoverageLexicalEvidenceMassSummary,
	familyTier: CoverageLexicalFamilyTier,
	channel: "identity" | "body",
	kind: Exclude<CoverageFamilyMatchKind, null>,
	familyWeight: number,
	fieldConfidence: number,
): void {
	const weightedMass = familyWeight * fieldConfidence;
	if (familyTier === "decisive") {
		if (kind === "exact") {
			if (channel === "identity") {
				summary.decisiveExactIdentityMass += weightedMass;
			} else {
				summary.decisiveExactBodyMass += weightedMass;
			}
			return;
		}
		if (kind === "prefix") {
			if (channel === "identity") {
				summary.decisivePrefixIdentityMass += weightedMass;
			} else {
				summary.decisivePrefixBodyMass += weightedMass;
			}
			return;
		}
		if (channel === "identity") {
			summary.decisiveFuzzyIdentityMass += weightedMass;
		} else {
			summary.decisiveFuzzyBodyMass += weightedMass;
		}
		return;
	}
	if (kind === "exact") {
		if (channel === "identity") {
			summary.supportExactIdentityMass += weightedMass;
		} else {
			summary.supportExactBodyMass += weightedMass;
		}
		return;
	}
	if (kind === "prefix") {
		if (channel === "identity") {
			summary.supportPrefixIdentityMass += weightedMass;
		} else {
			summary.supportPrefixBodyMass += weightedMass;
		}
		return;
	}
	if (channel === "identity") {
		summary.supportFuzzyIdentityMass += weightedMass;
	} else {
		summary.supportFuzzyBodyMass += weightedMass;
	}
}

function finalizeCoverageLexicalEvidenceMassSummary(
	signal: CoverageLexicalFamilySignal,
): CoverageLexicalFamilySignal {
	const summary = {
		...(signal.evidenceMassSummary ??
			createEmptyCoverageLexicalEvidenceMassSummary()),
	};
	summary.witnessMass = computeCoverageLexicalWitnessMass(signal);
	summary.weakBridgeMass = computeCoverageLexicalWeakBridgeMass(signal);
	summary.displayRawMass = computeCoverageLexicalEvidenceDisplayRawMass(summary);
	summary.displayNormalizedMass = computeCoverageLexicalEvidenceDisplayNormalizedMass(
		summary,
	);
	return {
		...signal,
		evidenceMassSummary: summary,
	};
}

function computeCoverageLexicalWitnessMass(
	signal: CoverageLexicalFamilySignal,
): number {
	return (
		signal.metadataIdentity.phraseWeight * 0.65 +
		signal.phraseBridgeWeight * 0.7 +
		signal.localEvidence.primary.exactCoreWeight * 0.6 +
		signal.localEvidence.corroboratedExactCoreWeight * 0.75 +
		signal.localEvidence.primary.orderedPairCount * 0.4 +
		signal.localEvidence.primary.orderRatio * 0.25
	);
}

function computeCoverageLexicalWeakBridgeMass(
	signal: CoverageLexicalFamilySignal,
): number {
	return (
		signal.metadataChar.bestSegmentCoverageRatio * 0.35 +
		signal.metadataChar.matchRatio * 0.15 +
		signal.bodyChar.bestSegmentCoverageRatio * 0.25 +
		signal.bodyChar.matchRatio * 0.12 +
		signal.tagSignal.charMatchRatio * 0.12 +
		signal.tagSignal.exactMatchCount * 0.16
	);
}

function computeCoverageLexicalEvidenceDisplayRawMass(
	summary: CoverageLexicalEvidenceMassSummary,
): number {
	return (
		summary.decisiveExactIdentityMass +
		summary.decisiveExactBodyMass +
		0.85 * summary.decisivePrefixIdentityMass +
		0.82 * summary.decisivePrefixBodyMass +
		0.55 * summary.decisiveFuzzyIdentityMass +
		0.5 * summary.decisiveFuzzyBodyMass +
		summary.supportExactIdentityMass +
		summary.supportExactBodyMass +
		0.8 * summary.supportPrefixIdentityMass +
		0.76 * summary.supportPrefixBodyMass +
		0.45 * summary.supportFuzzyIdentityMass +
		0.4 * summary.supportFuzzyBodyMass +
		0.35 * summary.witnessMass +
		0.18 * summary.weakBridgeMass
	);
}

function computeCoverageLexicalEvidenceDisplayNormalizedMass(
	summary: CoverageLexicalEvidenceMassSummary,
): number {
	if (summary.displayRawMass <= 0) {
		return 0;
	}
	if (summary.displayIdealMass <= 0) {
		return summary.displayRawMass;
	}
	return clampCoverageLexicalWeight(
		summary.displayRawMass / summary.displayIdealMass,
		0,
		1,
	);
}

function computeCoverageLexicalEvidenceIdealDisplayMass(
	probes: readonly (CoverageLexicalFamilyProbe | undefined)[],
	families: readonly CoverageLexicalFamily[],
): number {
	let idealMass = 0;
	for (const family of families) {
		if (family.role === "noise") {
			continue;
		}
		idealMass += getCoverageLexicalProbeFamilyWeight(probes[family.index]);
	}
	return Math.max(1, idealMass);
}

function applyMatch(
	area: CoverageLexicalAreaSignal,
	kind: Exclude<CoverageFamilyMatchKind, null>,
	weight: number,
): void {
	area.coverageCount += 1;
	if (kind === "exact") {
		area.exactWeight += weight;
		return;
	}
	if (kind === "prefix") {
		area.prefixWeight += weight;
		return;
	}
	area.fuzzyWeight += weight;
}

function applyMatchCode(
	area: CoverageLexicalAreaSignal,
	code: number,
	weight: number,
): void {
	if (code === 0) {
		return;
	}
	area.coverageCount += 1;
	if (code === 3) {
		area.exactWeight += weight;
		return;
	}
	if (code === 2) {
		area.prefixWeight += weight;
		return;
	}
	area.fuzzyWeight += weight;
}

function applyIdentityMatchFromCodes(
	identity: CoverageLexicalMetadataIdentitySignal,
	aliasCode: number,
	basenameCode: number,
	headingsCode: number,
	folderCode: number,
	tagsCode: number,
	baseWeight: number,
): void {
	const bestCode = Math.max(
		aliasCode,
		basenameCode,
		headingsCode,
		folderCode,
		tagsCode,
	);
	if (bestCode === 0) {
		return;
	}
	applyMatchCode(identity.overall, bestCode, baseWeight);
	applyMatchCode(identity.alias, aliasCode, baseWeight);
	applyMatchCode(identity.basename, basenameCode, baseWeight);
	applyMatchCode(identity.heading, headingsCode, baseWeight);
	applyMatchCode(identity.path, folderCode, baseWeight);
	applyMatchCode(identity.tag, tagsCode, baseWeight);
}

function computeMetadataFieldBoostFromCodes(
	metadataCode: number,
	basenameCode: number,
	aliasCode: number,
	folderCode: number,
	headingsCode: number,
	tagsCode: number,
): number {
	let bestBoost = 1;
	if (basenameCode === metadataCode) {
		bestBoost = Math.max(bestBoost, getMetadataFieldWeight("basename"));
	}
	if (aliasCode === metadataCode) {
		bestBoost = Math.max(bestBoost, getMetadataFieldWeight("aliases"));
	}
	if (folderCode === metadataCode) {
		bestBoost = Math.max(bestBoost, getMetadataFieldWeight("folder"));
	}
	if (headingsCode === metadataCode) {
		bestBoost = Math.max(bestBoost, getMetadataFieldWeight("headings"));
	}
	if (tagsCode === metadataCode) {
		bestBoost = Math.max(bestBoost, getMetadataFieldWeight("tags"));
	}
	return bestBoost;
}

function getMetadataFieldWeight(field: CoverageLexicalMetadataField): number {
	switch (field) {
		case "basename":
			return 4;
		case "aliases":
			return 3;
		case "headings":
			return 3;
		case "folder":
			return 2;
		case "tags":
			return 2;
		default:
			return 1;
	}
}

function getRecordedMatchKind(
	matches: readonly number[],
	familyIndex: number,
): Exclude<CoverageFamilyMatchKind, null> | null {
	const code = matches[familyIndex] ?? 0;
	if (code === 3) {
		return "exact";
	}
	if (code === 2) {
		return "prefix";
	}
	if (code === 1) {
		return "fuzzy";
	}
	return null;
}

const DEFAULT_MAX_SUBITEM_COUNT = 60;

function computeFamilyTailWeight(index: number): number {
	const position = index + 1;
	return position * position;
}

function computeFallbackScore(signal: CoverageLexicalFamilySignal): number {
	const weightedDisplayMass =
		signal.evidenceMassSummary?.displayNormalizedMass ??
		signal.evidenceMassSummary?.displayRawMass ??
		0;
	if (weightedDisplayMass > 0) {
		return weightedDisplayMass;
	}
	return (
		signal.coreBody.coverageCount * 100 +
		signal.coreBody.exactWeight * 3 +
		signal.coreBody.prefixWeight * 2 +
		signal.metadataPrefixAssist.coverageCount * 28 +
		signal.metadataPrefixAssist.prefixWeight * 4 +
		signal.softBody.coverageCount * 20 +
		signal.metadataIdentity.phraseCoverageCount * 12 +
		signal.metadataIdentity.overall.coverageCount * 10 +
		signal.metadataIdentity.alias.exactWeight * 2 +
		signal.metadataIdentity.basename.exactWeight * 2 +
		signal.metadataAnchor.coverageCount * 10 +
		signal.metadataAnchor.exactWeight +
		signal.bodyChar.fullSegmentCount * 10 +
		signal.metadataChar.fullSegmentCount * 6 +
		signal.bodyChar.bestSegmentCoverageRatio * 4 +
		signal.metadataChar.bestSegmentCoverageRatio * 2 +
		signal.tagSignal.exactMatchCount * 8 +
		signal.tagSignal.charMatchCount * 2 +
		signal.metadataChar.matchCount * 1.5 +
		signal.bodyChar.matchCount +
		signal.localEvidence.primary.coreCoverageCount * 2 +
		signal.tailCoreWeight * 0.01 +
		signal.tailSoftWeight * 0.001
	);
}

function computeCharMatchRatio(matchCount: number, totalTerms: number): number {
	if (matchCount <= 0 || totalTerms <= 0) {
		return 0;
	}
	return matchCount / totalTerms;
}

function applySegmentCoverageSignal(
	target: {
		fullSegmentCount: number;
		bestSegmentCoverageCount: number;
		bestSegmentCoverageRatio: number;
	},
	matchedFlags: readonly number[],
	charQuery: CoverageLexicalCharQuery,
): void {
	for (const segment of charQuery.hanSegments) {
		const termIndices = charQuery.segmentTermIndices.get(segment) ?? [];
		if (termIndices.length === 0) {
			continue;
		}
		let matchedCount = 0;
		for (const termIndex of termIndices) {
			if (matchedFlags[termIndex] === 1) {
				matchedCount += 1;
			}
		}
		if (matchedCount === termIndices.length) {
			target.fullSegmentCount += 1;
		}
		target.bestSegmentCoverageCount = Math.max(
			target.bestSegmentCoverageCount,
			matchedCount,
		);
		target.bestSegmentCoverageRatio = Math.max(
			target.bestSegmentCoverageRatio,
			matchedCount / termIndices.length,
		);
	}
}

function shouldLogCoverageLexicalHanDebug(
	queryText: string,
	charQuery: CoverageLexicalCharQuery,
): boolean {
	return charQuery.hanSegments.length > 0 && queryText.trim().length <= 24;
}


function computeLocalWindowRerankDocIds(
	coarseRanked: readonly CoverageLexicalDocRankableResult[],
	plan: CoverageLexicalPlan,
	maxItemResults: number,
): Set<number> {
	const prioritizedRanked = reprioritizeCoverageLexicalExpensiveUpgradeCandidates(
		coarseRanked,
		null,
		plan,
	);
	if (prioritizedRanked.length <= maxItemResults) {
		return new Set(prioritizedRanked.map((result) => result.docId));
	}
	let budget = Math.min(
		prioritizedRanked.length,
		Math.max(DEFAULT_LOCAL_WINDOW_RERANK_BUDGET, maxItemResults * 3),
	);
	while (budget < prioritizedRanked.length) {
		const left = prioritizedRanked[budget - 1];
		const right = prioritizedRanked[budget];
		const signalDecision = compareCoverageLexicalResultSignals(
			left.coverageLexicalSignal,
			right.coverageLexicalSignal,
			plan,
		);
		const admissionDecision = compareCoverageLexicalPassageAdmissionSignals(
			left.admissionSignal,
			right.admissionSignal,
		);
		if (signalDecision !== 0 || admissionDecision !== 0) {
			break;
		}
		budget += 1;
	}
	return new Set(prioritizedRanked.slice(0, budget).map((result) => result.docId));
}

function reprioritizeCoverageLexicalExpensiveUpgradeCandidates(
	results: readonly CoverageLexicalDocRankableResult[],
	candidates: ReadonlyMap<number, CoverageLexicalCandidateState> | null,
	plan: CoverageLexicalPlan,
): readonly CoverageLexicalDocRankableResult[] {
	const prioritized: CoverageLexicalDocRankableResult[] = [];
	const deferred: CoverageLexicalDocRankableResult[] = [];
	for (const result of results) {
		const state = candidates?.get(result.docId);
		if (shouldSoftGateCoverageLexicalExpensiveUpgrade(result, state, plan)) {
			deferred.push(result);
			continue;
		}
		prioritized.push(result);
	}
	if (deferred.length === 0) {
		return results;
	}
	return [...prioritized, ...deferred];
}

export function shouldSoftGateCoverageLexicalExpensiveUpgrade(
	result: CoverageLexicalDocRankableResult,
	state: CoverageLexicalCandidateState | null | undefined,
	plan: CoverageLexicalPlan,
	ratio = resolveCoverageLexicalSoftEarlyGateRatio(),
): boolean {
	if (!isCoverageLexicalSoftEarlyGateEnabled()) {
		return false;
	}
	const hints = getCoverageLexicalResourceHints(plan);
	if (
		plan.queryKind === "memory_relaxed" ||
		hints.memoryBudget >= Math.max(0.7, hints.localWitnessBudget)
	) {
		return false;
	}
	const profile = result.coverageLexicalSignal.coverageProfile;
	const requiredFamilyCount =
		profile.requiredFamilyCount > 0
			? profile.requiredFamilyCount
			: profile.meaningfulFamilyCount;
	const requiredCoveredFamilyCount =
		profile.requiredFamilyCount > 0
			? profile.requiredCoveredFamilyCount
			: profile.meaningfulCoveredFamilyCount;
	if (requiredFamilyCount < 2 || requiredCoveredFamilyCount > 1) {
		return false;
	}
	const coverageRatio = computeCoverageLexicalCoarseHydrationProfileLowerBound(
		result.coverageLexicalSignal,
	);
	if (coverageRatio >= ratio) {
		return false;
	}
	if (hasCoverageLexicalExpensiveUpgradeRescue(result, state)) {
		return false;
	}
	return true;
}

function hasCoverageLexicalExpensiveUpgradeRescue(
	result: CoverageLexicalDocRankableResult,
	state: CoverageLexicalCandidateState | null | undefined,
): boolean {
	if (
		result.coverageLexicalSignal.coreBody.exactWeight > 0 ||
		result.coverageLexicalSignal.metadataIdentity.phraseCoverageCount > 0 ||
		result.coverageLexicalSignal.phraseBridgeCount > 0 ||
		result.admissionSignal.exactWeight > 0 ||
		result.admissionSignal.phraseMatchCount > 0 ||
		result.admissionSignal.compactnessScore >= 0.18
	) {
		return true;
	}
	if (!state) {
		return false;
	}
	return (
		state.unresolvedBodyEvidence.needsPassageSignal ||
		state.unresolvedBodyEvidence.hasUnverifiedPhraseWitness
	);
}

function computePerFileLocalWindowLimit(
	plan: CoverageLexicalPlan,
	bodyTokenCount: number,
): number {
	const hints = getCoverageLexicalResourceHints(plan);
	if (
		hints.memoryBudget >= 0.7 ||
		hints.localWitnessBudget >= 0.8 ||
		hints.bodyBudget >= 0.95 ||
		plan.bodyFamilyCount >= 4 ||
		bodyTokenCount >= 96
	) {
		return 3;
	}
	return 2;
}

function getCoverageLexicalResourceHints(
	plan: CoverageLexicalPlan,
): CoverageLexicalResourceHints {
	return (
		plan.resourceHints ?? {
			metadataBudget: 0,
			hybridBudget: 0,
			bodyBudget: 0,
			memoryBudget: 0,
			bridgeBudget: 0,
			localWitnessBudget: 0,
		}
	);
}

function rankCoverageLexicalDocResults(
	results: readonly CoverageLexicalDocRankableResult[],
	plan: CoverageLexicalPlan,
): CoverageLexicalDocRankableResult[] {
	if (results.length <= 1) {
		return [...results];
	}
	return [...results].sort((left, right) => {
		const signalDecision = compareCoverageLexicalResultSignals(
			left.coverageLexicalSignal,
			right.coverageLexicalSignal,
			plan,
		);
		if (signalDecision !== 0) {
			return signalDecision;
		}
		return (right.score ?? 0) - (left.score ?? 0) || left.docId - right.docId;
	});
}

export function pruneWeakCoverageLexicalDisplayResults(
	results: readonly CoverageLexicalDocRankableResult[],
	config: CoverageLexicalDisplayPruneConfig,
): CoverageLexicalDocRankableResult[] {
	if (!config.enabled || results.length <= 1) {
		return [...results];
	}
	const topCoverage = computeCoverageLexicalDisplayCoverage(
		results[0].coverageLexicalSignal,
		config,
	);
	if (topCoverage <= 0) {
		return [...results];
	}
	const protectedPrefixCount = Math.min(10, results.length);
	const kept: CoverageLexicalDocRankableResult[] = results.slice(
		0,
		protectedPrefixCount,
	);
	for (let index = protectedPrefixCount; index < results.length; index += 1) {
		const result = results[index];
		const candidateCoverage = computeCoverageLexicalDisplayCoverage(
			result.coverageLexicalSignal,
			config,
		);
		if (candidateCoverage > topCoverage * config.top5PlusRatio) {
			kept.push(result);
		}
	}
	return kept;
}

function computeCoverageLexicalDisplayCoverage(
	signal: CoverageLexicalFamilySignal,
	config: CoverageLexicalDisplayPruneConfig,
): number {
	const weightedDisplayMass =
		signal.evidenceMassSummary?.displayNormalizedMass ??
		signal.evidenceMassSummary?.displayRawMass ??
		0;
	const profileCoverage = computeCoverageLexicalDisplayProfileCoverage(signal);
	if (weightedDisplayMass > 0) {
		if (profileCoverage <= 0) {
			return weightedDisplayMass;
		}
		return (weightedDisplayMass + profileCoverage) / 2;
	}
	return (
		signal.coreBody.coverageCount +
		signal.softBody.coverageCount +
		signal.metadataAnchor.coverageCount +
		signal.metadataIdentity.overall.coverageCount +
		signal.metadataIdentity.phraseCoverageCount +
		signal.bodyChar.matchCount * config.bodyCharWeight +
		signal.metadataChar.matchCount * config.metadataCharWeight +
		signal.tagSignal.exactMatchCount * config.tagExactWeight +
		signal.tagSignal.charMatchCount * config.tagCharWeight +
		profileCoverage
	);
}

function computeCoverageLexicalDisplayProfileCoverage(
	signal: CoverageLexicalFamilySignal,
): number {
	const profile = signal.coverageProfile;
	let baseCoverage = 0;
	if (profile.requiredFamilyWeight > 0) {
		baseCoverage =
			profile.requiredCoveredFamilyWeight / profile.requiredFamilyWeight;
	} else if (profile.meaningfulFamilyWeight > 0) {
		baseCoverage =
			profile.meaningfulCoveredFamilyWeight / profile.meaningfulFamilyWeight;
	} else if (profile.requiredFamilyCount > 0) {
		baseCoverage =
			profile.requiredCoveredFamilyCount / profile.requiredFamilyCount;
	} else if (profile.meaningfulFamilyCount > 0) {
		baseCoverage =
			profile.meaningfulCoveredFamilyCount / profile.meaningfulFamilyCount;
	}
	if (baseCoverage <= 0) {
		return 0;
	}
	if (profile.crossScriptRequired && !profile.crossScriptSatisfied) {
		baseCoverage *= 0.5;
	}
	return Math.min(1, Math.max(0, baseCoverage));
}

function isCoverageLexicalSoftEarlyGateEnabled(): boolean {
	return readCoverageLexicalBooleanEnv(
		"COVERAGE_LEXICAL_SOFT_EARLY_GATE_ENABLED",
		true,
	);
}

function resolveCoverageLexicalSoftEarlyGateRatio(): number {
	return readCoverageLexicalNumberEnv(
		"COVERAGE_LEXICAL_SOFT_EARLY_GATE_RATIO",
		COVERAGE_LEXICAL_SOFT_EARLY_GATE_RATIO,
	);
}

function resolveCoverageLexicalDisplayPruneConfig(): CoverageLexicalDisplayPruneConfig {
	const fallbackEnabled = getInstance(OuterSetting).hideWeaklyRelevantFiles;
	return {
		enabled: readCoverageLexicalBooleanEnv(
			"COVERAGE_LEXICAL_DISPLAY_PRUNE_ENABLED",
			fallbackEnabled,
		),
		top2To4Ratio: readCoverageLexicalNumberEnv(
			"COVERAGE_LEXICAL_DISPLAY_PRUNE_TOP2_TO4_RATIO",
			0.8,
		),
		top5PlusRatio: readCoverageLexicalNumberEnv(
			"COVERAGE_LEXICAL_DISPLAY_PRUNE_TOP5_PLUS_RATIO",
			0.8,
		),
		bodyCharWeight: readCoverageLexicalNumberEnv(
			"COVERAGE_LEXICAL_DISPLAY_PRUNE_BODY_CHAR_WEIGHT",
			0.5,
		),
		metadataCharWeight: readCoverageLexicalNumberEnv(
			"COVERAGE_LEXICAL_DISPLAY_PRUNE_METADATA_CHAR_WEIGHT",
			0.5,
		),
		tagExactWeight: readCoverageLexicalNumberEnv(
			"COVERAGE_LEXICAL_DISPLAY_PRUNE_TAG_EXACT_WEIGHT",
			0.75,
		),
		tagCharWeight: readCoverageLexicalNumberEnv(
			"COVERAGE_LEXICAL_DISPLAY_PRUNE_TAG_CHAR_WEIGHT",
			0.5,
		),
	};
}

function readCoverageLexicalBooleanEnv(
	name: string,
	fallback: boolean,
): boolean {
	const raw = process.env[name]?.trim().toLowerCase();
	if (!raw) {
		return fallback;
	}
	if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
		return true;
	}
	if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
		return false;
	}
	return fallback;
}

function readCoverageLexicalNumberEnv(name: string, fallback: number): number {
	const raw = process.env[name]?.trim();
	if (!raw) {
		return fallback;
	}
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function projectDocRankableResult(
	result: CoverageLexicalDocRankableResult,
	documentPathById: readonly (string | undefined)[],
): MatchedFile {
	const path = documentPathById[result.docId];
	if (!path) {
		throw new Error(
			`coverage-lexical invariant violated: missing path for docId ${result.docId}`,
		);
	}
	const basename = FileUtil.getBasename(path);
	const folderPath = FileUtil.getFolderPath(path);
	const highlightTerms =
		result.queryTerms.length > 0 ? result.queryTerms : result.matchedTerms;
	return {
		path,
		queryTerms: result.queryTerms,
		matchedTerms: result.matchedTerms,
		score: result.score,
		basenameHighlightRanges: buildMetadataHighlightRanges(
			basename,
			highlightTerms,
		),
		folderHighlightRanges: buildMetadataHighlightRanges(
			folderPath,
			highlightTerms,
		),
		nativeSubItemsReady: false,
		directSubItems: [],
	};
}

function buildMetadataHighlightRanges(
	text: string,
	terms: readonly string[],
): Array<{ start: number; end: number }> {
	if (!text || terms.length === 0) {
		return [];
	}
	const lowerText = text.toLocaleLowerCase();
	const ranges: Array<{ start: number; end: number }> = [];
	for (const rawTerm of terms) {
		const term = rawTerm.trim();
		if (!term) {
			continue;
		}
		const lowerTerm = term.toLocaleLowerCase();
		let cursor = 0;
		while (cursor < lowerText.length) {
			const matchIndex = lowerText.indexOf(lowerTerm, cursor);
			if (matchIndex === -1) {
				break;
			}
			ranges.push({
				start: matchIndex,
				end: matchIndex + lowerTerm.length,
			});
			cursor = matchIndex + Math.max(1, lowerTerm.length);
		}
	}
	return mergeHighlightRanges(ranges);
}

function mergeHighlightRanges(
	ranges: ReadonlyArray<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
	if (ranges.length <= 1) {
		return [...ranges];
	}
	const ordered = [...ranges].sort((left, right) => left.start - right.start);
	const merged = [{ start: ordered[0].start, end: ordered[0].end }];
	for (let index = 1; index < ordered.length; index += 1) {
		const current = ordered[index];
		const previous = merged[merged.length - 1];
		if (current.start <= previous.end) {
			previous.end = Math.max(previous.end, current.end);
			continue;
		}
		merged.push({ start: current.start, end: current.end });
	}
	return merged;
}

type IndexSizeAccumulator = {
	seenStrings: Set<string>;
	stringPoolBytes: number;
	stringPoolBytesBySource: Map<string, number>;
	stringPoolStringCountBySource: Map<string, number>;
};

const INDEX_COLLECTION_HEADER_BYTES = 4;
const INDEX_REFERENCE_BYTES = 4;
const INDEX_MAP_ENTRY_BYTES = 8;
const INDEX_NUMBER_BYTES = 8;
const INDEX_UINT32_BYTES = 4;
const INDEX_UINT8_BYTES = 1;
const INDEX_POSTING_DOC_ID_BYTES = 4;
const INDEX_JS_ARRAY_HEADER_BYTES = 24;
const INDEX_TYPED_ARRAY_VIEW_BYTES = 16;
const INDEX_ARRAY_BUFFER_HEADER_BYTES = 16;
const INDEX_TYPED_ARRAY_ALIGNMENT_BYTES = 8;
const UTF8_ENCODER = new TextEncoder();

function createIndexSizeAccumulator(): IndexSizeAccumulator {
	return {
		seenStrings: new Set(),
		stringPoolBytes: 0,
		stringPoolBytesBySource: new Map(),
		stringPoolStringCountBySource: new Map(),
	};
}

function accountStringBytes(
	accumulator: IndexSizeAccumulator,
	value: string,
	source: string,
): void {
	if (accumulator.seenStrings.has(value)) {
		return;
	}
	accumulator.seenStrings.add(value);
	const bytes = UTF8_ENCODER.encode(value).byteLength;
	accumulator.stringPoolBytes += bytes;
	accumulator.stringPoolBytesBySource.set(
		source,
		(accumulator.stringPoolBytesBySource.get(source) ?? 0) + bytes,
	);
	accumulator.stringPoolStringCountBySource.set(
		source,
		(accumulator.stringPoolStringCountBySource.get(source) ?? 0) + 1,
	);
}

function estimateStringArrayBytes(
	values: readonly string[],
	accumulator: IndexSizeAccumulator,
	source: string,
): {
	total: number;
	count: number;
	referenceBytes: number;
} {
	let count = 0;
	for (const value of values) {
		count += 1;
		accountStringBytes(accumulator, value, source);
	}
	return {
		total: INDEX_COLLECTION_HEADER_BYTES + count * INDEX_REFERENCE_BYTES,
		count,
		referenceBytes: count * INDEX_REFERENCE_BYTES,
	};
}

function estimateStringSetBytes(
	values: ReadonlySet<string>,
	accumulator: IndexSizeAccumulator,
	source: string,
): {
	total: number;
	count: number;
	referenceBytes: number;
} {
	return estimateStringArrayBytes(Array.from(values), accumulator, source);
}

function estimateOwnedNumericPostingMapBytes(
	postings: ReadonlyMap<string, readonly number[] | Uint32Array>,
	accumulator: IndexSizeAccumulator,
	source: string,
	ownership: CoverageLexicalPostingOwnership,
): {
	total: number;
	termCount: number;
	postingCount: number;
	mapEntryBytes: number;
	termReferenceBytes: number;
	postingNumberBytes: number;
	postingListBytes: number;
} {
	let termCount = 0;
	let postingCount = 0;
	let postingListBytes = 0;
	for (const [term, docIds] of postings.entries()) {
		termCount += 1;
		accountStringBytes(accumulator, term, source);
		postingCount += docIds.length;
		postingListBytes +=
			ownership === "packed"
				? estimatePackedUint32Bytes(docIds.length)
				: estimateNumericArrayBytes(docIds.length);
	}
	const mapEntryBytes = termCount * INDEX_MAP_ENTRY_BYTES;
	const termReferenceBytes = termCount * INDEX_REFERENCE_BYTES;
	const postingNumberBytes = postingCount * INDEX_POSTING_DOC_ID_BYTES;
	return {
		total:
			INDEX_COLLECTION_HEADER_BYTES +
			mapEntryBytes +
			termReferenceBytes +
			postingListBytes,
		termCount,
		postingCount,
		mapEntryBytes,
		termReferenceBytes,
		postingNumberBytes,
		postingListBytes,
	};
}

function estimateSharedPackedPostingMapBytes(
	postings: CoverageLexicalSharedPackedPostingMap,
	accumulator: IndexSizeAccumulator,
	source: string,
): {
	total: number;
	termCount: number;
	postingCount: number;
	slotCount: number;
	mapEntryBytes: number;
	termReferenceBytes: number;
	slotTermReferenceBytes: number;
	slotStartBytes: number;
	slotLengthBytes: number;
	postingNumberBytes: number;
	postingTapeBytes: number;
} {
	const termCount = postings.size;
	const postingCount = postings.postingCount;
	const slotCount = postings.slotCount;
	const slotStartBytes = estimatePackedUint32Bytes(slotCount);
	const slotLengthBytes = estimatePackedUint32Bytes(slotCount);
	const postingNumberBytes = postingCount * INDEX_POSTING_DOC_ID_BYTES;
	const postingTapeBytes = estimatePackedUint32Bytes(postingCount);
	let mapEntryBytes = 0;
	let termReferenceBytes = 0;
	let slotTermReferenceBytes = 0;
	if (postings instanceof CoverageLexicalSharedStringPostingMap) {
		for (const term of postings.keys()) {
			accountStringBytes(accumulator, term, source);
		}
		mapEntryBytes = termCount * INDEX_MAP_ENTRY_BYTES;
		termReferenceBytes = termCount * INDEX_REFERENCE_BYTES;
		slotTermReferenceBytes = slotCount * INDEX_REFERENCE_BYTES;
	}
	return {
		total:
			INDEX_COLLECTION_HEADER_BYTES +
			mapEntryBytes +
			termReferenceBytes +
			slotTermReferenceBytes +
			slotStartBytes +
			slotLengthBytes +
			postingTapeBytes,
		termCount,
		postingCount,
		slotCount,
		mapEntryBytes,
		termReferenceBytes,
		slotTermReferenceBytes,
		slotStartBytes,
		slotLengthBytes,
		postingNumberBytes,
		postingTapeBytes,
	};
}

function alignEstimateBytes(value: number, alignment: number): number {
	if (alignment <= 1) {
		return value;
	}
	const remainder = value % alignment;
	return remainder === 0 ? value : value + (alignment - remainder);
}

function estimateNumericArrayBytes(length: number): number {
	return INDEX_JS_ARRAY_HEADER_BYTES + length * INDEX_NUMBER_BYTES;
}

function estimatePackedUint8Bytes(length: number): number {
	const payloadBytes = alignEstimateBytes(
		length * INDEX_UINT8_BYTES,
		INDEX_TYPED_ARRAY_ALIGNMENT_BYTES,
	);
	return INDEX_TYPED_ARRAY_VIEW_BYTES + INDEX_ARRAY_BUFFER_HEADER_BYTES + payloadBytes;
}

function estimatePackedUint32Bytes(length: number): number {
	const payloadBytes = alignEstimateBytes(
		length * INDEX_UINT32_BYTES,
		INDEX_TYPED_ARRAY_ALIGNMENT_BYTES,
	);
	return INDEX_TYPED_ARRAY_VIEW_BYTES + INDEX_ARRAY_BUFFER_HEADER_BYTES + payloadBytes;
}

function estimateDocumentStoreBytes(
	documents: ReadonlyMap<string, CoverageLexicalDocument>,
	accumulator: IndexSizeAccumulator,
): Record<string, unknown> & { total: number } {
	const sections = {
		docIds: { count: 0, referenceBytes: 0 },
		paths: { count: 0, referenceBytes: 0 },
		basenameText: { count: 0, referenceBytes: 0 },
		folderText: { count: 0, referenceBytes: 0 },
		aliasesText: { count: 0, referenceBytes: 0 },
		tagsText: { count: 0, referenceBytes: 0 },
		headingsText: { count: 0, referenceBytes: 0 },
	};
	for (const [path, document] of documents.entries()) {
		sections.docIds.count += 1;
		sections.docIds.referenceBytes += INDEX_NUMBER_BYTES;

		accountStringBytes(accumulator, path, "documents.path");
		sections.paths.count += 1;
		sections.paths.referenceBytes += INDEX_REFERENCE_BYTES;

		accountStringBytes(accumulator, document.basenameText, "documents.basenameText");
		sections.basenameText.count += 1;
		sections.basenameText.referenceBytes += INDEX_REFERENCE_BYTES;

		accountStringBytes(accumulator, document.folderText, "documents.folderText");
		sections.folderText.count += 1;
		sections.folderText.referenceBytes += INDEX_REFERENCE_BYTES;

		accountStringBytes(accumulator, document.aliasesText, "documents.aliasesText");
		sections.aliasesText.count += 1;
		sections.aliasesText.referenceBytes += INDEX_REFERENCE_BYTES;

		accountStringBytes(accumulator, document.tagsText, "documents.tagsText");
		sections.tagsText.count += 1;
		sections.tagsText.referenceBytes += INDEX_REFERENCE_BYTES;

		accountStringBytes(accumulator, document.headingsText, "documents.headingsText");
		sections.headingsText.count += 1;
		sections.headingsText.referenceBytes += INDEX_REFERENCE_BYTES;
	}

	return {
		total:
			INDEX_COLLECTION_HEADER_BYTES +
			documents.size * INDEX_MAP_ENTRY_BYTES +
			sumSectionBytes(sections),
		mapEntryBytes: documents.size * INDEX_MAP_ENTRY_BYTES,
		...sections,
	};
}

function readCoverageLexicalTokenRange(
	tape: readonly string[],
	range: CoverageLexicalTokenRange | undefined,
): readonly string[] | undefined {
	if (!range) {
		return undefined;
	}
	return tape.slice(range.start, range.end);
}

function encodeCoverageLexicalNumericTokenTape(
	values: readonly number[],
): Uint8Array {
	const bytes: number[] = [];
	for (const value of values) {
		if (!Number.isInteger(value) || value < 0) {
			throw new Error(`Invalid coverage lexical body token id: ${value}`);
		}
		let remaining = value >>> 0;
		do {
			let nextByte = remaining & 0x7f;
			remaining >>>= 7;
			if (remaining !== 0) {
				nextByte |= 0x80;
			}
			bytes.push(nextByte);
		} while (remaining !== 0);
	}
	return Uint8Array.from(bytes);
}

function readCoverageLexicalNumericTokenRange(
	tape: Uint8Array,
	range: CoverageLexicalTokenRange | undefined,
): number[] | undefined {
	if (!range) {
		return undefined;
	}
	const values: number[] = [];
	let value = 0;
	let shift = 0;
	for (let index = range.start; index < range.end; index += 1) {
		const nextByte = tape[index];
		value |= (nextByte & 0x7f) << shift;
		if ((nextByte & 0x80) === 0) {
			values.push(value >>> 0);
			value = 0;
			shift = 0;
			continue;
		}
		shift += 7;
		if (shift > 28) {
			throw new Error("Coverage lexical body token tape varint overflow");
		}
	}
	if (shift !== 0) {
		throw new Error("Coverage lexical body token tape ended mid-varint");
	}
	return values;
}

function countCoverageLexicalEncodedTokenCount(tape: Uint8Array): number {
	let count = 0;
	for (const nextByte of tape) {
		if ((nextByte & 0x80) === 0) {
			count += 1;
		}
	}
	return count;
}

function estimateNumericTokenTapeSlotsBytes(
	tape: Uint8Array,
	rangesById: readonly (CoverageLexicalTokenRange | undefined)[],
): {
	total: number;
	slotCount: number;
	populatedCount: number;
	slotReferenceBytes: number;
	rangeNumberBytes: number;
	tokenCount: number;
	tokenNumberBytes: number;
	tapeArrayBytes: number;
	tapeOwnershipBytes: number;
} {
	const populatedCount = rangesById.filter((range) => range !== undefined).length;
	const tapeArrayBytes = INDEX_COLLECTION_HEADER_BYTES + tape.length * INDEX_UINT8_BYTES;
	const tapeOwnershipBytes = estimatePackedUint8Bytes(tape.length);
	const slotReferenceBytes = rangesById.length * INDEX_REFERENCE_BYTES;
	const rangeNumberBytes = populatedCount * INDEX_NUMBER_BYTES * 2;
	return {
		total:
			INDEX_COLLECTION_HEADER_BYTES +
			slotReferenceBytes +
			rangeNumberBytes +
			tapeOwnershipBytes,
		slotCount: rangesById.length,
		populatedCount,
		slotReferenceBytes,
		rangeNumberBytes,
		tokenCount: countCoverageLexicalEncodedTokenCount(tape),
		tokenNumberBytes: tape.length,
		tapeArrayBytes,
		tapeOwnershipBytes,
	};
}
function estimateSparseStringArraySlotsBytes(
	valuesById: readonly (readonly string[] | undefined)[],
	accumulator: IndexSizeAccumulator,
	source: string,
): {
	total: number;
	slotCount: number;
	populatedCount: number;
	slotReferenceBytes: number;
	arrayCount: number;
	arrayBytes: number;
	valueCount: number;
} {
	let populatedCount = 0;
	let valueCount = 0;
	let arrayBytes = 0;
	for (const values of valuesById) {
		if (!values) {
			continue;
		}
		populatedCount += 1;
		const estimate = estimateStringArrayBytes(values, accumulator, source);
		valueCount += estimate.count;
		arrayBytes += estimate.total;
	}
	const slotReferenceBytes = valuesById.length * INDEX_REFERENCE_BYTES;
	return {
		total: INDEX_COLLECTION_HEADER_BYTES + slotReferenceBytes + arrayBytes,
		slotCount: valuesById.length,
		populatedCount,
		slotReferenceBytes,
		arrayCount: populatedCount,
		arrayBytes,
		valueCount,
	};
}

function estimateDocumentIdentityBytes(
	documentIdByPath: ReadonlyMap<string, number>,
	documentPathById: readonly (string | undefined)[],
	documentById: readonly (CoverageLexicalDocument | undefined)[],
	documentBodyTokenLexicon: readonly string[],
	documentBodyTokenIdTape: Uint8Array,
	documentBodyTokenRangeById: readonly (CoverageLexicalTokenRange | undefined)[],
	documentBodyHanSegmentsById: readonly (readonly string[] | undefined)[],
	documentTagValuesById: readonly (readonly string[] | undefined)[],
	nextDocumentId: number,
	accumulator: IndexSizeAccumulator,
): Record<string, unknown> & { total: number } {
	const pathToId = {
		count: 0,
		mapEntryBytes: 0,
		pathReferenceBytes: 0,
		numberBytes: 0,
	};
	for (const [path] of documentIdByPath.entries()) {
		pathToId.count += 1;
		accountStringBytes(accumulator, path, "documentIdentity.pathToId.path");
		pathToId.mapEntryBytes += INDEX_MAP_ENTRY_BYTES;
		pathToId.pathReferenceBytes += INDEX_REFERENCE_BYTES;
		pathToId.numberBytes += INDEX_NUMBER_BYTES;
	}
	const pathToIdTotal =
		INDEX_COLLECTION_HEADER_BYTES +
		pathToId.mapEntryBytes +
		pathToId.pathReferenceBytes +
		pathToId.numberBytes;

	const idToPath = {
		slotCount: documentPathById.length,
		populatedCount: 0,
		referenceBytes: documentPathById.length * INDEX_REFERENCE_BYTES,
	};
	for (const path of documentPathById) {
		if (!path) {
			continue;
		}
		idToPath.populatedCount += 1;
		accountStringBytes(accumulator, path, "documentIdentity.idToPath.path");
	}
	const idToPathTotal = INDEX_COLLECTION_HEADER_BYTES + idToPath.referenceBytes;

	const docStoreById = {
		slotCount: documentById.length,
		populatedCount: documentById.filter(Boolean).length,
		referenceBytes: documentById.length * INDEX_REFERENCE_BYTES,
	};
	const docStoreByIdTotal =
		INDEX_COLLECTION_HEADER_BYTES + docStoreById.referenceBytes;
	const bodyTokenLexicon = estimateStringArrayBytes(
		documentBodyTokenLexicon,
		accumulator,
		"documentIdentity.bodyTokenLexicon",
	);
	const bodyTokensById = estimateNumericTokenTapeSlotsBytes(
		documentBodyTokenIdTape,
		documentBodyTokenRangeById,
	);
	const bodyHanSegmentsById = estimateSparseStringArraySlotsBytes(
		documentBodyHanSegmentsById,
		accumulator,
		"documentIdentity.bodyHanSegments",
	);
	const tagValuesById = estimateSparseStringArraySlotsBytes(
		documentTagValuesById,
		accumulator,
		"documentIdentity.tagValues",
	);

	const counter = {
		count: 1,
		value: nextDocumentId,
		numberBytes: INDEX_NUMBER_BYTES,
	};

	return {
		total:
			pathToIdTotal +
			idToPathTotal +
			docStoreByIdTotal +
			bodyTokenLexicon.total +
			bodyTokensById.total +
			bodyHanSegmentsById.total +
			tagValuesById.total +
			counter.numberBytes,
		pathToId: {
			...pathToId,
			total: pathToIdTotal,
		},
		idToPath: {
			...idToPath,
			total: idToPathTotal,
		},
		docStoreById: {
			...docStoreById,
			total: docStoreByIdTotal,
		},
		bodyTokenLexicon,
		bodyTokensById,
		bodyHanSegmentsById,
		tagValuesById,
		counter,
	};
}
function accumulateSection(
	target: { count: number; referenceBytes: number },
	source: { count: number; referenceBytes: number },
): void {
	target.count += source.count;
	target.referenceBytes += source.referenceBytes;
}

function sumSectionBytes(
	sections: Record<string, { referenceBytes: number }>,
): number {
	return Object.values(sections).reduce(
		(total, section) => total + section.referenceBytes,
		0,
	);
}

function sumNamedByteBreakdowns(
	breakdowns: Record<string, { total: number }>,
): number {
	return Object.values(breakdowns).reduce(
		(total, breakdown) => total + breakdown.total,
		0,
	);
}

function toNamedByteBreakdown<T extends Record<string, unknown>>(
	breakdowns: T,
): T {
	return breakdowns;
}

function buildStringPoolAttributionBreakdown(
	accumulator: IndexSizeAccumulator,
): {
	bySource: Record<string, { bytes: number; uniqueStrings: number }>;
	byGroup: Record<string, { bytes: number; uniqueStrings: number }>;
} {
	const bySourceEntries = Array.from(
		accumulator.stringPoolBytesBySource.entries(),
	)
		.map(([source, bytes]) => [
			source,
			{
				bytes,
				uniqueStrings:
					accumulator.stringPoolStringCountBySource.get(source) ?? 0,
			},
		] as const)
		.sort((left, right) => right[1].bytes - left[1].bytes);
	const bySource = Object.fromEntries(bySourceEntries);
	const summarizeSources = (sources: readonly string[]) => {
		let bytes = 0;
		let uniqueStrings = 0;
		for (const source of sources) {
			bytes += accumulator.stringPoolBytesBySource.get(source) ?? 0;
			uniqueStrings +=
				accumulator.stringPoolStringCountBySource.get(source) ?? 0;
		}
		return { bytes, uniqueStrings };
	};
	const groupedSources = {
		documentBodyTokenLexicon: ["documentIdentity.bodyTokenLexicon"],
		bodyExactTerms: ["postings.body.term"],
		metadataExactTerms: [
			"postings.metadataAlias.term",
			"postings.metadataBasename.term",
			"postings.metadataFolder.term",
			"postings.metadataHeading.term",
			"postings.metadataTag.term",
			"postings.metadataTagFull.term",
		],
		metadataPhraseTerms: [
			"postings.metadataAliasPhrase.term",
			"postings.metadataBasenamePhrase.term",
			"postings.metadataFolderPhrase.term",
			"postings.metadataHeadingPhrase.term",
			"postings.metadataTagPhrase.term",
		],
		bodyCharTerms: ["postings.bodyChar.term"],
		metadataCharTerms: [
			"postings.metadataAliasChar.term",
			"postings.metadataBasenameChar.term",
			"postings.metadataFolderChar.term",
			"postings.metadataHeadingChar.term",
			"postings.metadataTagChar.term",
		],
		documentText: [
			"documents.basenameText",
			"documents.folderText",
			"documents.aliasesText",
			"documents.tagsText",
			"documents.headingsText",
		],
		documentPaths: [
			"documents.path",
			"documentIdentity.pathToId.path",
			"documentIdentity.idToPath.path",
		],
		documentDerivedTokens: [
			"documentIdentity.bodyHanSegments",
			"documentIdentity.tagValues",
		],
		lexicon: ["lexicon.term"],
	} satisfies Record<string, readonly string[]>;
	const groupedSourceSet = new Set<string>(
		Object.values(groupedSources).flatMap((sources) => [...sources]),
	);
	const otherSources = Array.from(accumulator.stringPoolBytesBySource.keys()).filter(
		(source) => !groupedSourceSet.has(source),
	);
	const byGroup = {
		documentBodyTokenLexicon: summarizeSources(
			groupedSources.documentBodyTokenLexicon,
		),
		bodyExactTerms: summarizeSources(groupedSources.bodyExactTerms),
		metadataExactTerms: summarizeSources(groupedSources.metadataExactTerms),
		metadataPhraseTerms: summarizeSources(groupedSources.metadataPhraseTerms),
		bodyCharTerms: summarizeSources(groupedSources.bodyCharTerms),
		metadataCharTerms: summarizeSources(groupedSources.metadataCharTerms),
		documentText: summarizeSources(groupedSources.documentText),
		documentPaths: summarizeSources(groupedSources.documentPaths),
		documentDerivedTokens: summarizeSources(groupedSources.documentDerivedTokens),
		lexicon: summarizeSources(groupedSources.lexicon),
		otherSources: summarizeSources(otherSources),
	};
	return {
		bySource,
		byGroup,
	};
}

function getPostingEntryCount(
	postings: ReadonlySet<string> | readonly number[] | Uint32Array | undefined,
): number {
	if (!postings) {
		return 0;
	}
	return Array.isArray(postings) || postings instanceof Uint32Array
		? postings.length
		: (postings as ReadonlySet<string>).size;
}

function getUnionPostingEntryCount(
	postingsLists: readonly ((readonly number[] | Uint32Array) | undefined)[],
): number {
	const seen = new Set<number>();
	for (const postings of postingsLists) {
		if (!postings) {
			continue;
		}
		for (const docId of postings) {
			seen.add(docId);
		}
	}
	return seen.size;
}

function countPostingMapKeyUnion(
	postingMaps: readonly ReadonlyMap<string, readonly number[] | Uint32Array>[],
): number {
	const terms = new Set<string>();
	for (const postings of postingMaps) {
		for (const term of postings.keys()) {
			terms.add(term);
		}
	}
	return terms.size;
}

function addPosting(
	postings: Map<string, Set<string>>,
	term: string,
	path: string,
): void {
	let docs = postings.get(term);
	if (!docs) {
		docs = new Set();
		postings.set(term, docs);
	}
	docs.add(path);
}

function addOwnedNumericPosting(
	postings: CoverageLexicalMutableNumericPostingMap,
	term: string,
	docId: number,
	ownership: CoverageLexicalPostingOwnership,
): void {
	if (ownership === "packed") {
		// Single-layer packed postings minimize live-memory, but each incremental
		// update rewrites the whole term bucket. If Obsidian occasionally stutters
		// during indexing updates, this reallocation path is a likely cause.
		const docs = postings.get(term) as Uint32Array | undefined;
		if (!docs) {
			postings.set(term, Uint32Array.of(docId));
			return;
		}
		const next = new Uint32Array(docs.length + 1);
		next.set(docs);
		next[docs.length] = docId;
		postings.set(term, next);
		return;
	}
	let docs = postings.get(term) as number[] | undefined;
	if (!docs) {
		docs = [];
		postings.set(term, docs);
	}
	docs.push(docId);
}

function cloneOwnedNumericPostingMap(
	postings: ReadonlyMap<string, readonly number[] | Uint32Array>,
	ownership: "packed",
): Map<string, Uint32Array>;
function cloneOwnedNumericPostingMap(
	postings: ReadonlyMap<string, readonly number[] | Uint32Array>,
	ownership: "plain",
): Map<string, number[]>;
function cloneOwnedNumericPostingMap(
	postings: ReadonlyMap<string, readonly number[] | Uint32Array>,
	ownership: CoverageLexicalPostingOwnership,
): Map<string, number[] | Uint32Array>;
function cloneOwnedNumericPostingMap(
	postings: ReadonlyMap<string, readonly number[] | Uint32Array>,
	ownership: CoverageLexicalPostingOwnership,
): Map<string, number[] | Uint32Array> {
	return new Map(
		Array.from(postings.entries(), ([term, docIds]) => [
			term,
			ownership === "packed"
				? Uint32Array.from([...docIds].sort((left, right) => left - right))
				: [...docIds].sort((left, right) => left - right),
		]),
	);
}

function cloneSharedTokenIdPostingMapForSnapshot(
	postings: CoverageLexicalSharedTokenIdPostingMap,
	tokenLexicon: readonly string[],
	ownership: "packed",
): Map<string, Uint32Array>;
function cloneSharedTokenIdPostingMapForSnapshot(
	postings: CoverageLexicalSharedTokenIdPostingMap,
	tokenLexicon: readonly string[],
	ownership: "plain",
): Map<string, number[]>;
function cloneSharedTokenIdPostingMapForSnapshot(
	postings: CoverageLexicalSharedTokenIdPostingMap,
	tokenLexicon: readonly string[],
	ownership: CoverageLexicalPostingOwnership,
): Map<string, number[] | Uint32Array> {
	const cloned = new Map<string, number[] | Uint32Array>();
	for (const [tokenId, docIds] of postings.getTokenIdEntries()) {
		const term = tokenLexicon[tokenId];
		if (term === undefined) {
			continue;
		}
		cloned.set(
			term,
			ownership === "packed"
				? Uint32Array.from([...docIds].sort((left, right) => left - right))
				: [...docIds].sort((left, right) => left - right),
		);
	}
	return cloned;
}

function restoreOwnedNumericPostingMap(
	target: CoverageLexicalMutableNumericPostingMap,
	source: ReadonlyMap<string, readonly number[] | Uint32Array>,
	ownership: CoverageLexicalPostingOwnership,
): void {
	if (
		ownership === "packed" &&
		isCoverageLexicalSharedPackedPostingMap(target)
	) {
		target.clear();
		target.replaceAll(source);
		return;
	}
	target.clear();
	for (const [term, docIds] of source) {
		target.set(
			term,
			ownership === "packed" ? new Uint32Array(docIds) : [...docIds],
		);
	}
}

function sortedValues(values: ReadonlySet<string>): string[] {
	return Array.from(values).sort();
}

function removePosting(
	postings: Map<string, Set<string>>,
	term: string,
	path: string,
): void {
	const docs = postings.get(term);
	if (!docs) {
		return;
	}
	docs.delete(path);
	if (docs.size === 0) {
		postings.delete(term);
	}
}

function removeOwnedNumericPosting(
	postings: CoverageLexicalMutableNumericPostingMap,
	term: string,
	docId: number,
	ownership: CoverageLexicalPostingOwnership,
): void {
	const docs = postings.get(term);
	if (!docs) {
		return;
	}
	const index = docs.indexOf(docId);
	if (index === -1) {
		return;
	}
	if (ownership === "packed") {
		const next = removeDocIdFromSortedPosting(docs as Uint32Array, docId);
		if (!next) {
			postings.delete(term);
			return;
		}
		if (next !== docs) {
			postings.set(term, next);
		}
		return;
	}
	(docs as number[]).splice(index, 1);
	if (docs.length === 0) {
		postings.delete(term);
	}
}

function insertDocIdIntoSortedPosting(docs: Uint32Array, docId: number): Uint32Array {
	const next = new Uint32Array(docs.length + 1);
	let inserted = false;
	let readIndex = 0;
	for (let writeIndex = 0; writeIndex < next.length; writeIndex += 1) {
		if (!inserted && (readIndex >= docs.length || docId < docs[readIndex])) {
			next[writeIndex] = docId;
			inserted = true;
			continue;
		}
		next[writeIndex] = docs[readIndex];
		readIndex += 1;
	}
	return next;
}

function removeDocIdFromSortedPosting(
	docs: Uint32Array,
	docId: number,
): Uint32Array | undefined {
	const index = docs.indexOf(docId);
	if (index === -1) {
		return docs;
	}
	if (docs.length === 1) {
		return undefined;
	}
	const next = new Uint32Array(docs.length - 1);
	next.set(docs.subarray(0, index), 0);
	next.set(docs.subarray(index + 1), index);
	return next;
}

function isSerializedCoverageLexicalBinarySnapshot(
	data: SerializedFileSearchIndex,
): data is SerializedCoverageLexicalBinarySnapshot {
	return (
		typeof data === "object" &&
		data !== null &&
		(data as Record<string, unknown>).__backend === "coverage-lexical" &&
		((((data as Record<string, unknown>).__version === 1 &&
			(data as Record<string, unknown>).__encoding === "binary-snapshot-v1") ||
			((data as Record<string, unknown>).__version === 2 &&
				(data as Record<string, unknown>).__encoding === "binary-snapshot-v2"))) &&
		(data as Record<string, unknown>).data instanceof ArrayBuffer
	);
}
