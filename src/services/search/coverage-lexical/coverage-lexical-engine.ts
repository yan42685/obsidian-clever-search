import {
	closeSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	unlinkSync,
	writeFileSync,
} from "fs";
import { Vault } from "obsidian";
import { tmpdir } from "os";
import { join } from "path";
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
	buildCoverageLexicalPhraseSignatures,
	buildCoverageLexicalStructuredMetadataSignatures,
} from "./coverage-lexical-bridge";
import {
	buildCoverageLexicalCharQuery,
	extractHanBigrams,
	extractHanSegments,
	evaluateCoverageLexicalTagFallback,
	splitCoverageLexicalTagValues,
	type CoverageLexicalCharQuery,
} from "./coverage-lexical-cjk";
import {
	buildCoverageLexicalBodyEvidenceTrace,
	type CoverageLexicalBodyEvidenceTrace,
} from "./coverage-lexical-body-evidence";
import { buildCoverageLexicalPlan } from "./coverage-lexical-planner";
import {
	collectCoverageLexicalCandidateStatesByDocId,
	resolveHydratedCoverageLexicalCandidateState,
	type CoverageLexicalLaneEvaluateBenchmarkSubphaseName,
	type CoverageLexicalRecallBenchmarkSubphaseName,
} from "./coverage-lexical-recall";
import { buildCoverageLexicalPairSignatures } from "./coverage-lexical-signatures";
import {
	compareCoverageLexicalResultSignals,
} from "./coverage-lexical-ranker";
import {
	buildCoverageLexicalWindowFusionSignal,
	createEmptyCoverageLexicalWindowFusionSignal,
} from "./coverage-lexical-fusion";
import type {
	CoverageLexicalBodyTokenColdDocumentWrite,
	CoverageLexicalBodyTokenColdStoreApi,
} from "./coverage-lexical-body-token-cold-types";
import {
	COVERAGE_LEXICAL_BODY_TOKEN_COLD_STORE_TOKEN,
} from "./coverage-lexical-body-token-cold-types";
import {
	decodeCoverageLexicalSnapshotV1,
	encodeCoverageLexicalSnapshotV1,
	type CoverageLexicalSnapshotState,
} from "./coverage-lexical-snapshot";
import {
	COVERAGE_LEXICAL_LIVE_POSTING_DESCRIPTORS,
	COVERAGE_LEXICAL_LIVE_POSTING_DESCRIPTOR_BY_KEY,
	type CoverageLexicalLivePostingKey,
	type CoverageLexicalPostingOwnership,
} from "./coverage-lexical-posting-layout";
import {
	CoverageLexicalSharedStringPostingMap,
	CoverageLexicalSharedTokenIdPostingMap,
	isCoverageLexicalSharedPackedPostingMap,
	type CoverageLexicalSharedPackedPostingMap,
} from "./coverage-lexical-live-posting-store";
import { buildDirectSubitemsExactFileSubItems } from "./direct-subitems";
import type {
	CoverageFamilyMatchKind,
	CoverageLexicalAreaSignal,
	CoverageLexicalCandidateState,
	CoverageLexicalFamily,
	CoverageLexicalFamilyCountSummary,
	CoverageLexicalFamilyProbe,
	CoverageLexicalFamilySignal,
	CoverageLexicalMetadataIdentitySignal,
	CoverageLexicalMetadataField,
	CoverageLexicalPrefixWitness,
	CoverageLexicalPlan,
	CoverageLexicalPairSignature,
	CoverageLexicalPhraseSignature,
} from "./coverage-lexical-types";

const COVERAGE_LEXICAL_BODY_TOKEN_OFFLOAD_ENV =
	"COVERAGE_LEXICAL_EXPERIMENTAL_BODY_TOKEN_OFFLOAD";
const COVERAGE_LEXICAL_RECALL_BODY_TOKEN_PREFETCH_DOC_BUDGET = 96;
const COVERAGE_LEXICAL_OFFLOADED_BODY_TOKEN_HOT_CACHE_LIMIT = 24;
const COVERAGE_LEXICAL_OFFLOAD_HYDRATION_TIE_LOOKAHEAD = 24;
const COVERAGE_LEXICAL_OFFLOAD_UNRESOLVED_HYDRATION_LOOKAHEAD = 48;
const COVERAGE_LEXICAL_OFFLOAD_UNRESOLVED_HYDRATION_BUDGET = 12;
const COVERAGE_LEXICAL_OFFLOADED_BODY_TOKEN_COLD_DIR = join(
	tmpdir(),
	"clever-search",
	"coverage-lexical",
);

function isCoverageLexicalExperimentalBodyTokenOffloadEnabled(): boolean {
	const raw = process.env[COVERAGE_LEXICAL_BODY_TOKEN_OFFLOAD_ENV]?.trim();
	if (!raw) {
		return true;
	}
	return raw !== "0" && raw.toLowerCase() !== "false";
}

type CoverageLexicalDocument = {
	docId: number;
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
): CoverageLexicalDocument {
	return {
		docId,
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
	private static nextOffloadedBodyTokenArenaId = 0;

	private readonly tokenizer = getInstance(Tokenizer);
	private readonly documents = new Map<string, CoverageLexicalDocument>();
	private readonly documentById: Array<CoverageLexicalDocument | undefined> = [];
	private readonly documentIdByPath = new Map<string, number>();
	private readonly documentPathById: Array<string | undefined> = [];
	private readonly documentBodyTokenLexicon: string[] = [];
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
	private readonly offloadedBodyTokenArenaId =
		CoverageLexicalFileSearchEngine.nextOffloadedBodyTokenArenaId++;
	private offloadedBodyTokenColdSourceAvailable = true;
	private offloadedBodyTokenColdTapePath: string | null = null;
	private offloadedBodyTokenColdTapeFd: number | null = null;
	private readonly offloadedBodyTokenColdRangeById: Array<
		CoverageLexicalTokenRange | undefined
	> = [];
	private nextDocumentId = 0;
	private readonly bodyPostings = new CoverageLexicalSharedTokenIdPostingMap(
		(term) => this.documentBodyTokenIdByTerm.get(term),
		(term) => this.getOrCreateDocumentBodyTokenId(term),
		(tokenId) => this.getDocumentBodyTokenById(tokenId),
	);
	private readonly metadataAliasCharPostings = new Map<string, number[]>();
	private readonly metadataAliasPhrasePostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly metadataAliasPostings = new Map<string, Uint32Array>();
	private readonly metadataBasenameCharPostings = new Map<string, number[]>();
	private readonly metadataBasenamePhrasePostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly metadataBasenamePostings = new Map<string, Uint32Array>();
	private readonly metadataFolderCharPostings = new Map<string, number[]>();
	private readonly metadataFolderPhrasePostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly metadataFolderPostings = new Map<string, Uint32Array>();
	private readonly metadataHeadingCharPostings = new Map<string, number[]>();
	private readonly metadataHeadingPhrasePostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly metadataHeadingPostings = new Map<string, Uint32Array>();
	private readonly metadataTagCharPostings = new Map<string, number[]>();
	private readonly metadataTagFullPostings = new Map<string, Uint32Array>();
	private readonly metadataTagPhrasePostings =
		new CoverageLexicalSharedStringPostingMap();
	private readonly metadataTagPostings = new Map<string, Uint32Array>();
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
				await this.clearPersistedBodyTokenColdStore();
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

		await this.clearPersistedBodyTokenColdStore();
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
		this.documentBodyTokenLexicon.length = 0;
		this.documentBodyTokenIdByTerm.clear();
		this.documentBodyTokenIdTape = new Uint8Array(0);
		this.documentBodyTokenRangeById.length = 0;
		this.clearOffloadedColdBodyTokenSource();
		this.documentBodyHanSegmentsById.length = 0;
		this.documentTagValuesById.length = 0;
		this.offloadedBodyTokenHotCacheByDocId.clear();
		this.pendingBodyTokenColdUpsertsByPath.clear();
		this.pendingBodyTokenColdDeletes.clear();
		this.offloadedBodyTokenColdSourceAvailable = true;
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
		const tokenId = this.documentBodyTokenLexicon.length;
		this.documentBodyTokenLexicon.push(token);
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
		return this.documentBodyTokenLexicon[tokenId];
	}

	private getDocumentBodyTokenLexiconValues(): string[] {
		return [...this.documentBodyTokenLexicon];
	}

	private getDocumentBodyTokenIds(docId: number): readonly number[] | undefined {
		return readCoverageLexicalNumericTokenRange(
			this.documentBodyTokenIdTape,
			this.documentBodyTokenRangeById[docId],
		);
	}

	private getOffloadedDocumentBodyTokenIds(
		docId: number,
	): readonly number[] | undefined {
		const fileDescriptor = this.offloadedBodyTokenColdTapeFd;
		const range = this.offloadedBodyTokenColdRangeById[docId];
		if (fileDescriptor === null || !range || range.end <= range.start) {
			return undefined;
		}
		const byteLength = range.end - range.start;
		const buffer = Buffer.allocUnsafe(byteLength);
		const bytesRead = readSync(
			fileDescriptor,
			buffer,
			0,
			byteLength,
			range.start,
		);
		if (bytesRead <= 0) {
			return undefined;
		}
		if (bytesRead !== byteLength) {
			throw new Error(
				`Coverage lexical cold body token read truncated for doc ${docId}: ${bytesRead}/${byteLength}`,
			);
		}
		return readCoverageLexicalNumericTokenRange(
			new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead),
			{
				start: 0,
				end: bytesRead,
			},
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

	private clearOffloadedColdBodyTokenSource(): void {
		if (this.offloadedBodyTokenColdTapeFd !== null) {
			try {
				closeSync(this.offloadedBodyTokenColdTapeFd);
			} catch {
				// Ignore best-effort cleanup failures for experimental cold storage.
			}
			this.offloadedBodyTokenColdTapeFd = null;
		}
		if (this.offloadedBodyTokenColdTapePath) {
			try {
				unlinkSync(this.offloadedBodyTokenColdTapePath);
			} catch {
				// Ignore missing/stale temp files.
			}
			this.offloadedBodyTokenColdTapePath = null;
		}
		this.offloadedBodyTokenColdRangeById.length = 0;
	}

	private writeOffloadedColdBodyTokenSource(
		tape: Uint8Array,
		rangesById: readonly (CoverageLexicalTokenRange | undefined)[],
	): boolean {
		this.clearOffloadedColdBodyTokenSource();
		if (tape.length === 0) {
			return true;
		}
		try {
			mkdirSync(COVERAGE_LEXICAL_OFFLOADED_BODY_TOKEN_COLD_DIR, {
				recursive: true,
			});
			const coldTapePath = join(
				COVERAGE_LEXICAL_OFFLOADED_BODY_TOKEN_COLD_DIR,
				`coverage-lexical-body-token-cold-${process.pid}-${this.offloadedBodyTokenArenaId}.bin`,
			);
			writeFileSync(coldTapePath, tape);
			this.offloadedBodyTokenColdTapeFd = openSync(coldTapePath, "r");
			this.offloadedBodyTokenColdTapePath = coldTapePath;
			this.offloadedBodyTokenColdRangeById.length = 0;
			this.offloadedBodyTokenColdRangeById.push(...rangesById);
			return true;
		} catch (error) {
			void error;
			this.offloadedBodyTokenColdSourceAvailable = false;
			this.clearOffloadedColdBodyTokenSource();
			return false;
		}
	}

	private restoreOffloadedColdBodyTokenSourceToResidentTape(): void {
		if (
			this.documentBodyTokenIdTape.length > 0 ||
			this.offloadedBodyTokenColdTapePath === null
		) {
			return;
		}
		const restoredRanges = [...this.offloadedBodyTokenColdRangeById];
		const restoredTape = Uint8Array.from(
			readFileSync(this.offloadedBodyTokenColdTapePath),
		);
		this.clearOffloadedColdBodyTokenSource();
		this.documentBodyTokenIdTape = restoredTape;
		this.documentBodyTokenRangeById.length = 0;
		this.documentBodyTokenRangeById.push(...restoredRanges);
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
			if (options.allowColdLoad === false) {
				return undefined;
			}
			const offloadedTokenIds = this.getOffloadedDocumentBodyTokenIds(docId);
			if (!offloadedTokenIds) {
				return undefined;
			}
			const coldTokens = Array.from(offloadedTokenIds, (tokenId) => {
				const token = this.getDocumentBodyTokenById(tokenId);
				if (token === undefined) {
					throw new Error(
						`Missing coverage lexical cold body token for id ${tokenId}`,
					);
				}
				return token;
			});
			cache?.set(docId, coldTokens);
			this.rememberHotCachedOffloadedBodyTokens(docId, coldTokens);
			return coldTokens;
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
		const fileSnapshotStore = this.getFileSnapshotStore();
		if (!fileSnapshotStore) {
			return;
		}
		const textsByPath = await fileSnapshotStore.readCurrentTexts(missingPaths);
		for (let index = 0; index < missingDocIds.length; index += 1) {
			const bodyText = textsByPath.get(missingPaths[index]);
			if (bodyText === undefined) {
				continue;
			}
			const tokens = tokenizeCoverageLexicalDocumentText(this.tokenizer, bodyText);
			queryCache.bodyTokensByDocId.set(missingDocIds[index], tokens);
			this.rememberHotCachedOffloadedBodyTokens(missingDocIds[index], tokens);
		}
	}

	private shouldExperimentallyOffloadResidentBodyTokens(): boolean {
		return (
			this.offloadedBodyTokenColdSourceAvailable &&
			isCoverageLexicalExperimentalBodyTokenOffloadEnabled() &&
			this.getFileSnapshotStore() !== null
		);
	}

	private collectLikelyRecallBodyTokenDocIds(
		queryTerms: readonly string[],
	): readonly number[] {
		const candidatePostings = Array.from(new Set(queryTerms))
			.map((term) => this.bodyPostings.get(term))
			.filter(
				(postings): postings is readonly number[] | Uint32Array =>
					postings !== undefined && postings.length > 0,
			)
			.sort((left, right) => left.length - right.length);
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
		const offloaded = this.writeOffloadedColdBodyTokenSource(
			this.documentBodyTokenIdTape,
			this.documentBodyTokenRangeById,
		);
		if (!offloaded) {
			return;
		}
		this.documentBodyTokenIdTape = new Uint8Array(0);
		this.documentBodyTokenRangeById.length = 0;
	}

	private offloadResidentDocumentBodyHanSegments(): void {
		if (!this.shouldExperimentallyOffloadResidentBodyTokens()) {
			return;
		}
		this.documentBodyHanSegmentsById.length = 0;
	}

	private mapDocumentBodyTokensToIds(tokens: readonly string[]): number[] {
		return tokens.map((token) => this.getOrCreateDocumentBodyTokenId(token));
	}

	private setDocumentBodyTokens(
		docId: number,
		tokens: readonly string[],
	): void {
		this.restoreOffloadedColdBodyTokenSourceToResidentTape();
		this.rebuildDocumentBodyTokenTape(
			new Map([[docId, this.mapDocumentBodyTokensToIds(tokens)]]),
		);
	}

	private clearDocumentBodyTokens(docId: number): void {
		this.restoreOffloadedColdBodyTokenSourceToResidentTape();
		this.rebuildDocumentBodyTokenTape(new Map([[docId, undefined]]));
	}

	private compactDocumentBodyTokenLexicon(): void {
		this.restoreOffloadedColdBodyTokenSourceToResidentTape();
		if (this.documentBodyTokenLexicon.length === 0) {
			this.documentBodyTokenLexicon.length = 0;
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
			this.documentBodyTokenLexicon.length = 0;
			this.documentBodyTokenIdByTerm.clear();
			this.documentBodyTokenIdTape = new Uint8Array(0);
			this.documentBodyTokenRangeById.length = 0;
			this.bodyPostings.clear();
			return;
		}
		if (usedTokenIds.size === this.documentBodyTokenLexicon.length) {
			return;
		}
		const nextLexicon: string[] = [];
		const nextIdByTerm = new Map<string, number>();
		const tokenIdRemap = new Map<number, number>();
		for (
			let tokenId = 0;
			tokenId < this.documentBodyTokenLexicon.length;
			tokenId += 1
		) {
			if (!usedTokenIds.has(tokenId)) {
				continue;
			}
			const token = this.getDocumentBodyTokenById(tokenId);
			if (token === undefined) {
				throw new Error(
					`Missing compacted coverage lexical body token for id ${tokenId}`,
				);
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
		this.documentBodyTokenLexicon.length = 0;
		this.documentBodyTokenLexicon.push(...nextLexicon);
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
		this.offloadResidentDocumentBodyHanSegments();
		await this.flushPendingBodyTokenColdStoreWrites();
	}

	deleteDocuments(paths: string[]): void {
		for (const path of paths) {
			this.removeDocument(path);
		}
		void this.flushPendingBodyTokenColdStoreWrites();
	}

	async searchFiles(request: FileSearchRequest): Promise<MatchedFile[]> {
		const queryStartedAt = this.benchmarkPhaseTiming ? performance.now() : 0;
		this.lastBenchmarkOffloadSearchDebug = null;
		try {
			const queryTerms = this.tokenizer
				.tokenizeSequence(request.queryText, "search")
				.map((term) => term.toLowerCase());
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
					queryKind: plan.queryKind,
					route: plan.route,
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
			this.getDocumentBodyTokenLexiconValues(),
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
		const storedDocument = createCoverageLexicalDocument(docId, documentTextFields);
		const bodyText = document.content ?? "";
		const derivedState = buildCoverageLexicalDerivedDocumentIndexState(
			this.tokenizer,
			documentTextFields,
			{ bodyText },
		);

		this.documents.set(document.path, storedDocument);
		this.documentById[docId] = storedDocument;
		this.setDocumentBodyTokens(docId, derivedState.bodyTokenSequence);
		this.documentTagValuesById[docId] = derivedState.tagValues;
		this.stageBodyTokenColdUpsert({
			path: document.path,
			bodyTokens: derivedState.bodyTokenSequence,
			hanSegments: extractHanSegments(bodyText),
		});
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
		const overrides = new Map<string, Uint32Array | undefined>();
		for (const [term, docs] of this.bodyPostings.entries()) {
			if (docs.indexOf(docId) === -1) {
				continue;
			}
			overrides.set(term, removeDocIdFromSortedPosting(docs, docId));
		}
		this.bodyPostings.updateMany(overrides);
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
	}

	private async clearPersistedBodyTokenColdStore(): Promise<void> {
		this.pendingBodyTokenColdDeletes.clear();
		this.pendingBodyTokenColdUpsertsByPath.clear();
		const store = this.getBodyTokenColdStore();
		if (!store) {
			return;
		}
		await store.clearAll();
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
		return (await fileSnapshotStore.readCurrentTexts([path])).get(path) ?? null;
	}

	private buildBinarySnapshotState(): CoverageLexicalSnapshotState {
		return {
			nextDocumentId: this.nextDocumentId,
			sortedLexicon: [...this.getSortedLexicon()],
			bodyTokenLexicon: this.getDocumentBodyTokenLexiconValues(),
			documents: this.documentById.flatMap((document) =>
				document
					? [
							{
								docId: document.docId,
								path: this.documentPathById[document.docId] ?? "",
								...this.getDocumentTextFields(document.docId),
									bodyTokenIds: [
										...(this.getDocumentBodyTokenIds(document.docId) ?? []),
									],
									bodyHanSegments: [],
									tagValues: [
										...(this.documentTagValuesById[document.docId] ?? []),
									],
							},
					  ]
					: [],
			),
			...this.cloneLivePostingState(),
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
		this.documentBodyTokenLexicon.length = 0;
		this.documentBodyTokenLexicon.push(...state.bodyTokenLexicon);
		this.documentBodyTokenIdByTerm.clear();
		for (let tokenId = 0; tokenId < this.documentBodyTokenLexicon.length; tokenId += 1) {
			this.documentBodyTokenIdByTerm.set(
				this.documentBodyTokenLexicon[tokenId],
				tokenId,
			);
		}
		const bodyTokenIdsById = new Map<number, readonly number[]>();
		for (const document of state.documents) {
			const storedDocument: CoverageLexicalDocument = {
				docId: document.docId,
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
			this.documentTagValuesById[document.docId] = [...document.tagValues];
		}
		this.rebuildDocumentBodyTokenTape(bodyTokenIdsById);
		this.restoreLivePostingState(state);
		this.metadataHeadingCharPostings.clear();
		this.offloadResidentDocumentBodyTokens();
		this.offloadResidentDocumentBodyHanSegments();
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

	private cloneLivePostingState(): Pick<
		CoverageLexicalSnapshotState,
		CoverageLexicalLivePostingKey
	> {
		return Object.fromEntries(
			COVERAGE_LEXICAL_LIVE_POSTING_DESCRIPTORS.map((descriptor) => [
				descriptor.key,
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
		return queryTerms.map((term) => ({
			bodyExactDocCount: getPostingEntryCount(this.bodyPostings.get(term)),
			metadataExactDocCount: getUnionPostingEntryCount([
				this.metadataBasenamePostings.get(term),
				this.metadataAliasPostings.get(term),
				this.metadataFolderPostings.get(term),
				this.metadataHeadingPostings.get(term),
				this.metadataTagPostings.get(term),
			]),
			basenameExactDocCount: getPostingEntryCount(
				this.metadataBasenamePostings.get(term),
			),
			folderExactDocCount: getPostingEntryCount(
				this.metadataFolderPostings.get(term),
			),
			headingExactDocCount: getPostingEntryCount(
				this.metadataHeadingPostings.get(term),
			),
			aliasExactDocCount: getPostingEntryCount(this.metadataAliasPostings.get(term)),
		}));
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
		const rankedCount = coarseRanked.length;
		if (rankedCount === 0) {
			return new Set<number>();
		}
		const budget = this.computeCoarseHydrationBudget(
			plan,
			maxItemResults,
			rankedCount,
		);
		if (rankedCount <= budget) {
			return new Set(coarseRanked.map((result) => result.docId));
		}
		const hydratedDocIds = new Set<number>();
		for (let index = 0; index < budget; index += 1) {
			hydratedDocIds.add(coarseRanked[index].docId);
		}
		const cutoff = coarseRanked[Math.max(0, budget - 1)];
		const extensionLimit = Math.min(
			rankedCount,
			budget + COVERAGE_LEXICAL_OFFLOAD_HYDRATION_TIE_LOOKAHEAD,
		);
		for (let index = budget; index < extensionLimit; index += 1) {
			const candidate = coarseRanked[index];
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
			const hasBodyUpgradePotential =
				state.phraseMatches.length > 0 ||
				state.bodyPrefixWitness !== null ||
				state.bodyCharMatchIndices.length > 0 ||
				hasUnresolvedCoverageLexicalBodyUpgradePotential(state);
			if (tiesWithCutoff || hasBodyUpgradePotential) {
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
			unresolvedFamilyCount: number;
			unresolvedWeightUpperBound: number;
		}> = [];
		for (let index = extensionLimit; index < unresolvedTailLimit; index += 1) {
			const candidate = coarseRanked[index];
			if (hydratedDocIds.has(candidate.docId)) {
				continue;
			}
			const state = candidates.get(candidate.docId);
			if (!state || !hasUnresolvedCoverageLexicalBodyUpgradePotential(state)) {
				continue;
			}
			unresolvedTailCandidates.push({
				docId: candidate.docId,
				index,
				unresolvedFamilyCount:
					state.unresolvedBodyEvidence.unresolvedFamilyCount,
				unresolvedWeightUpperBound:
					state.unresolvedBodyEvidence.unresolvedWeightUpperBound,
			});
		}
		unresolvedTailCandidates.sort((left, right) => {
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
		let minBudget = 24;
		let multiplier = 4;
		let cap = 64;
		switch (plan.queryKind) {
			case "body_only_local":
				minBudget = 48;
				multiplier = 10;
				cap = 128;
				break;
			case "anchor_body_hybrid":
				minBudget = 36;
				multiplier = 7;
				cap = 96;
				break;
			case "bridge_dependent":
				minBudget = 40;
				multiplier = 8;
				cap = 112;
				break;
			case "memory_relaxed":
				minBudget = 56;
				multiplier = 10;
				cap = 144;
				break;
			case "metadata_only_anchored":
			default:
				break;
		}
		return Math.min(
			candidateCount,
			Math.min(cap, Math.max(minBudget, requested * multiplier)),
		);
	}

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
	const coreBody = createEmptyAreaSignal();
	const softBody = createEmptyAreaSignal();
	const metadataAnchor = createEmptyAreaSignal();
	const metadataPrefixAssist = createEmptyAreaSignal();
	const metadataIdentity = createEmptyMetadataIdentitySignal();
	const bodyChar = createEmptyCharSignal();
	const metadataChar = createEmptyCharSignal();
	const familyCountSummary = createEmptyFamilyCountSummary();
	let bodyPrefixWitness: CoverageLexicalPrefixWitness | null = null;
	let metadataPrefixWitness: CoverageLexicalPrefixWitness | null = null;
	let tailCoreWeight = 0;
	let tailSoftWeight = 0;
	const matchedTerms: string[] = [];
	const matchedTermSet = new Set<string>();

	for (const family of families) {
		const familyIndex = family.index;
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

		if (!matchedTermSet.has(family.normalizedTerm)) {
			matchedTermSet.add(family.normalizedTerm);
			matchedTerms.push(family.normalizedTerm);
		}

		familyCountSummary.totalMatchedFamilyCount += 1;
		if (bodyCode > 0) {
			familyCountSummary.bodyMatchedFamilyCount += 1;
		}
		if (metadataCode > 0 || assistCode > 0) {
			const primaryMetadataField =
				basenameCode > 0 || basenameAssistCode > 0
					? "basename"
					: aliasCode > 0 || aliasAssistCode > 0
						? "aliases"
						: folderCode > 0 || folderAssistCode > 0
							? "folder"
							: headingsCode > 0 || headingsAssistCode > 0
								? "headings"
								: tagsCode > 0 || tagsAssistCode > 0
									? "tags"
									: null;
			if (primaryMetadataField) {
				familyCountSummary.metadataMatchedFamilyCount += 1;
				accumulateMetadataFieldCount(
					familyCountSummary,
					primaryMetadataField,
				);
			}
		}

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

	return {
		familyCountSummary,
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
	};
}

function withCoverageLexicalLocalEvidence(
	baseSignal: CoverageLexicalFamilySignal,
	localEvidence: CoverageLexicalFamilySignal["localEvidence"],
): CoverageLexicalFamilySignal {
	return {
		...baseSignal,
		localEvidence,
	};
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

function createEmptyFamilyCountSummary(): CoverageLexicalFamilyCountSummary {
	return {
		totalMatchedFamilyCount: 0,
		metadataMatchedFamilyCount: 0,
		bodyMatchedFamilyCount: 0,
		basenameMatchedFamilyCount: 0,
		aliasesMatchedFamilyCount: 0,
		folderMatchedFamilyCount: 0,
		headingsMatchedFamilyCount: 0,
		tagsMatchedFamilyCount: 0,
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

function accumulateMetadataFieldCount(
	summary: CoverageLexicalFamilyCountSummary,
	field: CoverageLexicalMetadataField,
): void {
	if (field === "basename") {
		summary.basenameMatchedFamilyCount += 1;
		return;
	}
	if (field === "aliases") {
		summary.aliasesMatchedFamilyCount += 1;
		return;
	}
	if (field === "folder") {
		summary.folderMatchedFamilyCount += 1;
		return;
	}
	if (field === "headings") {
		summary.headingsMatchedFamilyCount += 1;
		return;
	}
	summary.tagsMatchedFamilyCount += 1;
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
	if (coarseRanked.length <= maxItemResults) {
		return new Set(coarseRanked.map((result) => result.docId));
	}
	let budget = Math.min(
		coarseRanked.length,
		Math.max(DEFAULT_LOCAL_WINDOW_RERANK_BUDGET, maxItemResults * 3),
	);
	while (budget < coarseRanked.length) {
		const left = coarseRanked[budget - 1];
		const right = coarseRanked[budget];
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
	return new Set(coarseRanked.slice(0, budget).map((result) => result.docId));
}

function computePerFileLocalWindowLimit(
	plan: CoverageLexicalPlan,
	bodyTokenCount: number,
): number {
	if (
		plan.queryKind === "memory_relaxed" ||
		plan.bodyFamilyCount >= 4 ||
		bodyTokenCount >= 96
	) {
		return 3;
	}
	return 2;
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

function pruneWeakCoverageLexicalDisplayResults(
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
	const kept: CoverageLexicalDocRankableResult[] = [results[0]];
	for (let index = 1; index < results.length; index += 1) {
		const result = results[index];
		const candidateCoverage = computeCoverageLexicalDisplayCoverage(
			result.coverageLexicalSignal,
			config,
		);
		const thresholdRatio =
			index <= 3 ? config.top2To4Ratio : config.top5PlusRatio;
		if (candidateCoverage <= topCoverage * thresholdRatio) {
			continue;
		}
		kept.push(result);
	}
	return kept;
}

function computeCoverageLexicalDisplayCoverage(
	signal: CoverageLexicalFamilySignal,
	config: CoverageLexicalDisplayPruneConfig,
): number {
	return (
		signal.coreBody.coverageCount +
		signal.softBody.coverageCount +
		signal.metadataAnchor.coverageCount +
		signal.metadataIdentity.overall.coverageCount +
		signal.metadataIdentity.phraseCoverageCount +
		signal.bodyChar.matchCount * config.bodyCharWeight +
		signal.metadataChar.matchCount * config.metadataCharWeight +
		signal.tagSignal.exactMatchCount * config.tagExactWeight +
		signal.tagSignal.charMatchCount * config.tagCharWeight
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
			0.34,
		),
		top5PlusRatio: readCoverageLexicalNumberEnv(
			"COVERAGE_LEXICAL_DISPLAY_PRUNE_TOP5_PLUS_RATIO",
			0.5,
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
