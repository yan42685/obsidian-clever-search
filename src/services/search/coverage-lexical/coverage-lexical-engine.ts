import { Vault } from "obsidian";
import { innerSetting } from "src/globals/plugin-setting";
import type {
	FileSubItem,
	IndexedDocument,
	MatchedFile,
} from "src/globals/search-types";
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
	buildCoverageLexicalPhraseTerms,
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
import {
	decodeCoverageLexicalSnapshotV1,
	encodeCoverageLexicalSnapshotV1,
	type CoverageLexicalSnapshotState,
} from "./coverage-lexical-snapshot";
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
	CoverageLexicalPlan,
	CoverageLexicalPairSignature,
	CoverageLexicalPhraseSignature,
} from "./coverage-lexical-types";

type CoverageLexicalDocument = {
	docId: number;
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
	bodyHanSegments: string[];
	bodyTerms: Set<string>;
	bodyCharTerms: Set<string>;
	aliasTerms: Set<string>;
	aliasCharTerms: Set<string>;
	aliasPhraseTerms: Set<string>;
	basenameTerms: Set<string>;
	basenameCharTerms: Set<string>;
	basenamePhraseTerms: Set<string>;
	folderTerms: Set<string>;
	folderCharTerms: Set<string>;
	folderPhraseTerms: Set<string>;
	headingTerms: Set<string>;
	headingCharTerms: Set<string>;
	headingPhraseTerms: Set<string>;
	tagTerms: Set<string>;
	tagCharTerms: Set<string>;
	tagPhraseTerms: Set<string>;
	tagValues: string[];
};

function createCoverageLexicalDocument(
	docId: number,
	document: Pick<
		IndexedDocument,
		"basename" | "folder" | "aliases" | "tags" | "headings"
	>,
): CoverageLexicalDocument {
	return {
		docId,
		basenameText: document.basename ?? "",
		folderText: document.folder ?? "",
		aliasesText: document.aliases ?? "",
		tagsText: document.tags ?? "",
		headingsText: document.headings ?? "",
	};
}

function buildCoverageLexicalDerivedDocumentIndexState(
	tokenizer: Tokenizer,
	document: CoverageLexicalDocument,
	options: {
		bodyText?: string;
		existingBodyTokenSequence?: readonly string[];
		existingBodyHanSegments?: readonly string[];
		existingTagValues?: readonly string[];
	} = {},
): CoverageLexicalDerivedDocumentIndexState {
	const bodyTokenSequence = options.existingBodyTokenSequence
		? [...options.existingBodyTokenSequence]
		: tokenizeCoverageLexicalDocumentText(tokenizer, options.bodyText ?? "");
	const bodyHanSegments = options.existingBodyHanSegments
		? [...options.existingBodyHanSegments]
		: extractHanSegments(options.bodyText ?? "");
	const bodyTerms = new Set(bodyTokenSequence);
	const bodyCharTerms = new Set(
		bodyHanSegments.flatMap((segment) => extractHanBigrams(segment)),
	);
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
	const headingCharTerms = new Set(extractHanBigrams(document.headingsText));
	return {
		bodyTokenSequence,
		bodyHanSegments,
		bodyTerms,
		bodyCharTerms,
		aliasTerms,
		aliasCharTerms,
		aliasPhraseTerms: buildCoverageLexicalPhraseTermSet(aliasTerms),
		basenameTerms,
		basenameCharTerms,
		basenamePhraseTerms: buildCoverageLexicalPhraseTermSet(basenameTerms),
		folderTerms,
		folderCharTerms,
		folderPhraseTerms: buildCoverageLexicalPhraseTermSet(folderTerms),
		headingTerms,
		headingCharTerms,
		headingPhraseTerms: buildCoverageLexicalPhraseTermSet(headingTerms),
		tagTerms,
		tagCharTerms,
		tagPhraseTerms: buildCoverageLexicalPhraseTermSet(tagTerms),
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

function buildCoverageLexicalPhraseTermSet(terms: Iterable<string>): Set<string> {
	return new Set(buildCoverageLexicalPhraseTerms(Array.from(terms)));
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
	bodyEvidenceTrace: CoverageLexicalBodyEvidenceTrace;
	admissionSignal: ReturnType<typeof buildCoverageLexicalPassageAdmissionSignal>;
	baseSignal: CoverageLexicalFamilySignal;
	coarseResult: CoverageLexicalDocRankableResult | null;
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

const DEFAULT_LOCAL_WINDOW_RERANK_BUDGET = 24;

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
	private readonly documentBodyTokenLexicon: string[] = [];
	private readonly documentBodyTokenIdByTerm = new Map<string, number>();
	private documentBodyTokenIdTape = new Uint32Array(0);
	private readonly documentBodyTokenRangeById: Array<CoverageLexicalTokenRange | undefined> = [];
	private readonly documentBodyHanSegmentsById: Array<
		readonly string[] | undefined
	> = [];
	private readonly documentTagValuesById: Array<readonly string[] | undefined> = [];
	private fileSnapshotStore: FileSnapshotStore | null | undefined;
	private nextDocumentId = 0;
	private readonly bodyPostings = new Map<string, number[]>();
	private readonly bodyCharPostings = new Map<string, Uint32Array>();
	private readonly metadataAliasCharPostings = new Map<string, number[]>();
	private readonly metadataAliasPhrasePostings = new Map<string, number[]>();
	private readonly metadataAliasPostings = new Map<string, number[]>();
	private readonly metadataBasenameCharPostings = new Map<string, number[]>();
	private readonly metadataBasenamePhrasePostings = new Map<string, number[]>();
	private readonly metadataBasenamePostings = new Map<string, number[]>();
	private readonly metadataFolderCharPostings = new Map<string, number[]>();
	private readonly metadataFolderPhrasePostings = new Map<string, number[]>();
	private readonly metadataFolderPostings = new Map<string, number[]>();
	private readonly metadataHeadingCharPostings = new Map<string, number[]>();
	private readonly metadataHeadingPhrasePostings = new Map<string, number[]>();
	private readonly metadataHeadingPostings = new Map<string, number[]>();
	private readonly metadataTagCharPostings = new Map<string, number[]>();
	private readonly metadataTagFullPostings = new Map<string, number[]>();
	private readonly metadataTagPhrasePostings = new Map<string, number[]>();
	private readonly metadataTagPostings = new Map<string, number[]>();
	private readonly lexicon = new Set<string>();
	private sortedLexiconCache: string[] = [];
	private sortedLexiconDirty = false;

	get sortedLexicon(): readonly string[] {
		return this.getSortedLexicon();
	}

	private benchmarkPhaseTiming: CoverageLexicalBenchmarkPhaseTimingState | null =
		null;

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
			this.sortedLexiconCache = Array.from(this.lexicon).sort();
			this.sortedLexiconDirty = false;
		}
		return this.sortedLexiconCache;
	}

	resetBenchmarkPhaseTiming(): void {
		this.benchmarkPhaseTiming = createCoverageLexicalBenchmarkPhaseTimingState();
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
		this.documentBodyTokenIdTape = new Uint32Array(0);
		this.documentBodyTokenRangeById.length = 0;
		this.documentBodyHanSegmentsById.length = 0;
		this.documentTagValuesById.length = 0;
		this.fileSnapshotStore = undefined;
		this.nextDocumentId = 0;
		this.bodyPostings.clear();
		this.bodyCharPostings.clear();
		this.metadataAliasCharPostings.clear();
		this.metadataAliasPhrasePostings.clear();
		this.metadataAliasPostings.clear();
		this.metadataBasenameCharPostings.clear();
		this.metadataBasenamePhrasePostings.clear();
		this.metadataBasenamePostings.clear();
		this.metadataFolderCharPostings.clear();
		this.metadataFolderPhrasePostings.clear();
		this.metadataFolderPostings.clear();
		this.metadataHeadingCharPostings.clear();
		this.metadataHeadingPhrasePostings.clear();
		this.metadataHeadingPostings.clear();
		this.metadataTagCharPostings.clear();
		this.metadataTagFullPostings.clear();
		this.metadataTagPhrasePostings.clear();
		this.metadataTagPostings.clear();
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

	private getDocumentBodyTokenIds(docId: number): Uint32Array | undefined {
		return readCoverageLexicalNumericTokenRange(
			this.documentBodyTokenIdTape,
			this.documentBodyTokenRangeById[docId],
		);
	}

	private getDocumentBodyTokens(
		docId: number,
		cache?: Map<number, readonly string[]>,
	): readonly string[] | undefined {
		const cached = cache?.get(docId);
		if (cached) {
			return cached;
		}
		const tokenIds = this.getDocumentBodyTokenIds(docId);
		if (!tokenIds) {
			return undefined;
		}
		const tokens = Array.from(tokenIds, (tokenId) => {
			const token = this.documentBodyTokenLexicon[tokenId];
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
		if (
			this.documentBodyTokenIdTape.length === 0 ||
			this.documentBodyTokenLexicon.length === 0
		) {
			this.documentBodyTokenLexicon.length = 0;
			this.documentBodyTokenIdByTerm.clear();
			this.documentBodyTokenIdTape = new Uint32Array(0);
			return;
		}
		const usedTokenIds = new Set(this.documentBodyTokenIdTape);
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
			const token = this.documentBodyTokenLexicon[tokenId];
			const nextTokenId = nextLexicon.length;
			nextLexicon.push(token);
			nextIdByTerm.set(token, nextTokenId);
			tokenIdRemap.set(tokenId, nextTokenId);
		}
		this.documentBodyTokenIdTape = Uint32Array.from(this.documentBodyTokenIdTape, (tokenId) => {
			const nextTokenId = tokenIdRemap.get(tokenId);
			if (nextTokenId === undefined) {
				throw new Error(
					`Missing compacted coverage lexical body token id for ${tokenId}`,
				);
			}
			return nextTokenId;
		});
		this.documentBodyTokenLexicon.length = 0;
		this.documentBodyTokenLexicon.push(...nextLexicon);
		this.documentBodyTokenIdByTerm.clear();
		for (const [token, tokenId] of nextIdByTerm.entries()) {
			this.documentBodyTokenIdByTerm.set(token, tokenId);
		}
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
			const start = nextTape.length;
			nextTape.push(...tokens);
			nextRanges[docId] = {
				start,
				end: nextTape.length,
			};
		}
		this.documentBodyTokenIdTape = Uint32Array.from(nextTape);
		this.documentBodyTokenRangeById.length = 0;
		this.documentBodyTokenRangeById.push(...nextRanges);
	}
	async addDocuments(documents: IndexedDocument[]): Promise<void> {
		for (const document of documents) {
			this.indexDocument(document);
		}
	}

	deleteDocuments(paths: string[]): void {
		for (const path of paths) {
			this.removeDocument(path);
		}
	}

	async searchFiles(request: FileSearchRequest): Promise<MatchedFile[]> {
		const queryStartedAt = this.benchmarkPhaseTiming ? performance.now() : 0;
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
					bodyCharPostings: this.bodyCharPostings,
					metadataAliasCharPostings: this.metadataAliasCharPostings,
					metadataAliasPhrasePostings: this.metadataAliasPhrasePostings,
					metadataAliasPostings: this.metadataAliasPostings,
					metadataBasenameCharPostings: this.metadataBasenameCharPostings,
					metadataBasenamePhrasePostings: this.metadataBasenamePhrasePostings,
					metadataBasenamePostings: this.metadataBasenamePostings,
					metadataFolderCharPostings: this.metadataFolderCharPostings,
					metadataFolderPhrasePostings: this.metadataFolderPhrasePostings,
					metadataFolderPostings: this.metadataFolderPostings,
					metadataHeadingCharPostings: this.metadataHeadingCharPostings,
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
					getDocumentBodyTokens: (docId: number) =>
						this.getDocumentBodyTokens(docId, queryCache.bodyTokensByDocId) ??
						[],
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

			const coarseResults = Array.from(candidates.entries())
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
					),
				)
				.filter((result): result is CoverageLexicalDocRankableResult => result !== null);
			const coarseResultByDocId = new Map(
				coarseResults.map((result) => [result.docId, result] as const),
			);
			const coarseSortStartedAt = this.benchmarkPhaseTiming ? performance.now() : 0;
			const coarseRanked = [...coarseResults].sort((left, right) => {
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
				);
				if (rerankedResult) {
					rerankedResults.push(rerankedResult);
				}
			}
			const finalRankStartedAt = this.benchmarkPhaseTiming ? performance.now() : 0;
			const ranked = rankCoverageLexicalDocResults(rerankedResults, plan);
			const finalResults = ranked.slice(0, request.maxItemResults);
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
			bodyCharTermCount: this.bodyCharPostings.size,
			metadataAliasCharTermCount: this.metadataAliasCharPostings.size,
			metadataAliasPhraseTermCount: this.metadataAliasPhrasePostings.size,
			metadataAliasTermCount: this.metadataAliasPostings.size,
			metadataBasenameCharTermCount: this.metadataBasenameCharPostings.size,
			metadataBasenamePhraseTermCount: this.metadataBasenamePhrasePostings.size,
			metadataBasenameTermCount: this.metadataBasenamePostings.size,
			metadataFolderCharTermCount: this.metadataFolderCharPostings.size,
			metadataFolderPhraseTermCount: this.metadataFolderPhrasePostings.size,
			metadataFolderTermCount: this.metadataFolderPostings.size,
			metadataHeadingCharTermCount: this.metadataHeadingCharPostings.size,
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
		const documents = estimateDocumentStoreBytes(this.documents, accumulator);
		const documentIdentity = estimateDocumentIdentityBytes(
			this.documentIdByPath,
			this.documentPathById,
			this.documentById,
			this.documentBodyTokenLexicon,
			this.documentBodyTokenIdTape,
			this.documentBodyTokenRangeById,
			this.documentBodyHanSegmentsById,
			this.documentTagValuesById,
			this.nextDocumentId,
			accumulator,
		);
		const postings = {
			body: estimateNumericPostingMapBytes(
				this.bodyPostings,
				accumulator,
				"postings.body.term",
			),
			bodyChar: estimatePackedNumericPostingMapBytes(
				this.bodyCharPostings,
				accumulator,
				"postings.bodyChar.term",
			),
			metadataAlias: estimateNumericPostingMapBytes(
				this.metadataAliasPostings,
				accumulator,
				"postings.metadataAlias.term",
			),
			metadataAliasChar: estimateNumericPostingMapBytes(
				this.metadataAliasCharPostings,
				accumulator,
				"postings.metadataAliasChar.term",
			),
			metadataAliasPhrase: estimateNumericPostingMapBytes(
				this.metadataAliasPhrasePostings,
				accumulator,
				"postings.metadataAliasPhrase.term",
			),
			metadataBasename: estimateNumericPostingMapBytes(
				this.metadataBasenamePostings,
				accumulator,
				"postings.metadataBasename.term",
			),
			metadataBasenameChar: estimateNumericPostingMapBytes(
				this.metadataBasenameCharPostings,
				accumulator,
				"postings.metadataBasenameChar.term",
			),
			metadataBasenamePhrase: estimateNumericPostingMapBytes(
				this.metadataBasenamePhrasePostings,
				accumulator,
				"postings.metadataBasenamePhrase.term",
			),
			metadataFolder: estimateNumericPostingMapBytes(
				this.metadataFolderPostings,
				accumulator,
				"postings.metadataFolder.term",
			),
			metadataFolderChar: estimateNumericPostingMapBytes(
				this.metadataFolderCharPostings,
				accumulator,
				"postings.metadataFolderChar.term",
			),
			metadataFolderPhrase: estimateNumericPostingMapBytes(
				this.metadataFolderPhrasePostings,
				accumulator,
				"postings.metadataFolderPhrase.term",
			),
			metadataHeading: estimateNumericPostingMapBytes(
				this.metadataHeadingPostings,
				accumulator,
				"postings.metadataHeading.term",
			),
			metadataHeadingChar: estimateNumericPostingMapBytes(
				this.metadataHeadingCharPostings,
				accumulator,
				"postings.metadataHeadingChar.term",
			),
			metadataHeadingPhrase: estimateNumericPostingMapBytes(
				this.metadataHeadingPhrasePostings,
				accumulator,
				"postings.metadataHeadingPhrase.term",
			),
			metadataTag: estimateNumericPostingMapBytes(
				this.metadataTagPostings,
				accumulator,
				"postings.metadataTag.term",
			),
			metadataTagChar: estimateNumericPostingMapBytes(
				this.metadataTagCharPostings,
				accumulator,
				"postings.metadataTagChar.term",
			),
			metadataTagFull: estimateNumericPostingMapBytes(
				this.metadataTagFullPostings,
				accumulator,
				"postings.metadataTagFull.term",
			),
			metadataTagPhrase: estimateNumericPostingMapBytes(
				this.metadataTagPhrasePostings,
				accumulator,
				"postings.metadataTagPhrase.term",
			),
		};
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
		const storedDocument = createCoverageLexicalDocument(docId, document);
		const bodyText = document.content ?? "";
		const derivedState = buildCoverageLexicalDerivedDocumentIndexState(
			this.tokenizer,
			storedDocument,
			{ bodyText },
		);

		this.documents.set(document.path, storedDocument);
		this.documentById[docId] = storedDocument;
		this.setDocumentBodyTokens(docId, derivedState.bodyTokenSequence);
		this.documentBodyHanSegmentsById[docId] = derivedState.bodyHanSegments;
		this.documentTagValuesById[docId] = derivedState.tagValues;

		for (const term of derivedState.bodyTerms) {
			addNumericPosting(this.bodyPostings, term, docId);
			this.lexicon.add(term);
		}
		for (const term of derivedState.bodyCharTerms) {
			addPackedNumericPosting(this.bodyCharPostings, term, docId);
		}
		for (const term of derivedState.aliasTerms) {
			addNumericPosting(this.metadataAliasPostings, term, docId);
			this.lexicon.add(term);
		}
		for (const term of derivedState.aliasCharTerms) {
			addNumericPosting(this.metadataAliasCharPostings, term, docId);
		}
		for (const term of derivedState.aliasPhraseTerms) {
			addNumericPosting(this.metadataAliasPhrasePostings, term, docId);
		}
		for (const term of derivedState.basenameTerms) {
			addNumericPosting(this.metadataBasenamePostings, term, docId);
			this.lexicon.add(term);
		}
		for (const term of derivedState.basenameCharTerms) {
			addNumericPosting(this.metadataBasenameCharPostings, term, docId);
		}
		for (const term of derivedState.basenamePhraseTerms) {
			addNumericPosting(this.metadataBasenamePhrasePostings, term, docId);
		}
		for (const term of derivedState.folderTerms) {
			addNumericPosting(this.metadataFolderPostings, term, docId);
			this.lexicon.add(term);
		}
		for (const term of derivedState.folderCharTerms) {
			addNumericPosting(this.metadataFolderCharPostings, term, docId);
		}
		for (const term of derivedState.folderPhraseTerms) {
			addNumericPosting(this.metadataFolderPhrasePostings, term, docId);
		}
		for (const term of derivedState.headingTerms) {
			addNumericPosting(this.metadataHeadingPostings, term, docId);
			this.lexicon.add(term);
		}
		for (const term of derivedState.headingCharTerms) {
			addNumericPosting(this.metadataHeadingCharPostings, term, docId);
		}
		for (const term of derivedState.headingPhraseTerms) {
			addNumericPosting(this.metadataHeadingPhrasePostings, term, docId);
		}
		for (const term of derivedState.tagTerms) {
			addNumericPosting(this.metadataTagPostings, term, docId);
			this.lexicon.add(term);
		}
		for (const term of new Set(derivedState.tagValues)) {
			addNumericPosting(this.metadataTagFullPostings, term, docId);
		}
		for (const term of derivedState.tagCharTerms) {
			addNumericPosting(this.metadataTagCharPostings, term, docId);
		}
		for (const term of derivedState.tagPhraseTerms) {
			addNumericPosting(this.metadataTagPhrasePostings, term, docId);
		}
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
			existing,
			{
				existingBodyTokenSequence: this.getDocumentBodyTokens(docId),
				existingBodyHanSegments: this.documentBodyHanSegmentsById[docId],
				existingTagValues: this.documentTagValuesById[docId],
			},
		);
		for (const term of derivedState.bodyTerms) {
			removeNumericPosting(this.bodyPostings, term, docId);
		}
		for (const term of derivedState.bodyCharTerms) {
			removePackedNumericPosting(this.bodyCharPostings, term, docId);
		}
		for (const term of derivedState.aliasTerms) {
			removeNumericPosting(this.metadataAliasPostings, term, docId);
		}
		for (const term of derivedState.aliasCharTerms) {
			removeNumericPosting(this.metadataAliasCharPostings, term, docId);
		}
		for (const term of derivedState.aliasPhraseTerms) {
			removeNumericPosting(this.metadataAliasPhrasePostings, term, docId);
		}
		for (const term of derivedState.basenameTerms) {
			removeNumericPosting(this.metadataBasenamePostings, term, docId);
		}
		for (const term of derivedState.basenameCharTerms) {
			removeNumericPosting(this.metadataBasenameCharPostings, term, docId);
		}
		for (const term of derivedState.basenamePhraseTerms) {
			removeNumericPosting(this.metadataBasenamePhrasePostings, term, docId);
		}
		for (const term of derivedState.folderTerms) {
			removeNumericPosting(this.metadataFolderPostings, term, docId);
		}
		for (const term of derivedState.folderCharTerms) {
			removeNumericPosting(this.metadataFolderCharPostings, term, docId);
		}
		for (const term of derivedState.folderPhraseTerms) {
			removeNumericPosting(this.metadataFolderPhrasePostings, term, docId);
		}
		for (const term of derivedState.headingTerms) {
			removeNumericPosting(this.metadataHeadingPostings, term, docId);
		}
		for (const term of derivedState.headingCharTerms) {
			removeNumericPosting(this.metadataHeadingCharPostings, term, docId);
		}
		for (const term of derivedState.headingPhraseTerms) {
			removeNumericPosting(this.metadataHeadingPhrasePostings, term, docId);
		}
		for (const term of derivedState.tagTerms) {
			removeNumericPosting(this.metadataTagPostings, term, docId);
		}
		for (const term of new Set(derivedState.tagValues)) {
			removeNumericPosting(this.metadataTagFullPostings, term, docId);
		}
		for (const term of derivedState.tagCharTerms) {
			removeNumericPosting(this.metadataTagCharPostings, term, docId);
		}
		for (const term of derivedState.tagPhraseTerms) {
			removeNumericPosting(this.metadataTagPhrasePostings, term, docId);
		}
		this.documents.delete(path);
		this.documentById[docId] = undefined;
		this.clearDocumentBodyTokens(docId);
		this.compactDocumentBodyTokenLexicon();
		this.documentBodyHanSegmentsById[docId] = undefined;
		this.documentTagValuesById[docId] = undefined;
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
		for (const term of this.bodyPostings.keys()) {
			nextLexicon.add(term);
		}
		for (const postings of this.getMetadataExactPostingMaps()) {
			for (const term of postings.keys()) {
				nextLexicon.add(term);
			}
		}
		this.lexicon.clear();
		for (const term of nextLexicon) {
			this.lexicon.add(term);
		}
		this.markLexiconDirty();
	}

	private getMetadataExactPostingMaps(): readonly ReadonlyMap<string, readonly number[]>[] {
		return [
			this.metadataBasenamePostings,
			this.metadataAliasPostings,
			this.metadataFolderPostings,
			this.metadataHeadingPostings,
			this.metadataTagPostings,
		];
	}

	private getFileSnapshotStore(): FileSnapshotStore | null {
		if (this.fileSnapshotStore !== undefined) {
			return this.fileSnapshotStore;
		}
		if (
			!container.isRegistered(FileSnapshotStore, true) &&
			!container.isRegistered(Vault, true)
		) {
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
		const currentText = fileSnapshotStore.peekCurrentFileText(path);
		if (currentText !== undefined) {
			return currentText;
		}
		const indexedSnapshots = await fileSnapshotStore.getIndexedSnapshotTexts([path]);
		const indexedSnapshotText = indexedSnapshots.get(path);
		if (indexedSnapshotText !== undefined) {
			fileSnapshotStore.setCurrentFileText(path, indexedSnapshotText);
			return indexedSnapshotText;
		}
		return await fileSnapshotStore.readCurrentFileText(path);
	}

	private buildBinarySnapshotState(): CoverageLexicalSnapshotState {
		return {
			nextDocumentId: this.nextDocumentId,
			sortedLexicon: [...this.getSortedLexicon()],
			bodyTokenLexicon: [...this.documentBodyTokenLexicon],
			documents: this.documentById.flatMap((document) =>
				document
					? [
							{
								docId: document.docId,
								path: this.documentPathById[document.docId] ?? "",
								basenameText: document.basenameText,
								folderText: document.folderText,
								aliasesText: document.aliasesText,
								tagsText: document.tagsText,
								headingsText: document.headingsText,
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
			bodyPostings: cloneNumericPostingMap(this.bodyPostings),
			bodyCharPostings: clonePackedNumericPostingMap(this.bodyCharPostings),
			bodyHanSegmentPostings: new Map(),
			metadataAliasCharPostings: cloneNumericPostingMap(
				this.metadataAliasCharPostings,
			),
			metadataAliasHanSegmentPostings: new Map(),
			metadataAliasPhrasePostings: cloneNumericPostingMap(
				this.metadataAliasPhrasePostings,
			),
			metadataAliasPostings: cloneNumericPostingMap(this.metadataAliasPostings),
			metadataBasenameCharPostings: cloneNumericPostingMap(
				this.metadataBasenameCharPostings,
			),
			metadataBasenameHanSegmentPostings: new Map(),
			metadataBasenamePhrasePostings: cloneNumericPostingMap(
				this.metadataBasenamePhrasePostings,
			),
			metadataBasenamePostings: cloneNumericPostingMap(
				this.metadataBasenamePostings,
			),
			metadataFolderCharPostings: cloneNumericPostingMap(
				this.metadataFolderCharPostings,
			),
			metadataFolderHanSegmentPostings: new Map(),
			metadataFolderPhrasePostings: cloneNumericPostingMap(
				this.metadataFolderPhrasePostings,
			),
			metadataFolderPostings: cloneNumericPostingMap(this.metadataFolderPostings),
			metadataHeadingCharPostings: cloneNumericPostingMap(
				this.metadataHeadingCharPostings,
			),
			metadataHeadingHanSegmentPostings: new Map(),
			metadataHeadingPhrasePostings: cloneNumericPostingMap(
				this.metadataHeadingPhrasePostings,
			),
			metadataHeadingPostings: cloneNumericPostingMap(
				this.metadataHeadingPostings,
			),
			metadataPostings: new Map(),
			metadataTagCharPostings: cloneNumericPostingMap(
				this.metadataTagCharPostings,
			),
			metadataTagFullPostings: cloneNumericPostingMap(
				this.metadataTagFullPostings,
			),
			metadataTagPhrasePostings: cloneNumericPostingMap(
				this.metadataTagPhrasePostings,
			),
			metadataTagPostings: cloneNumericPostingMap(this.metadataTagPostings),
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
			this.documentBodyHanSegmentsById[document.docId] = [
				...document.bodyHanSegments,
			];
			this.documentTagValuesById[document.docId] = [...document.tagValues];
		}
		this.rebuildDocumentBodyTokenTape(bodyTokenIdsById);
		restoreNumericPostingMap(this.bodyPostings, state.bodyPostings);
		restorePackedNumericPostingMap(this.bodyCharPostings, state.bodyCharPostings);
		restoreNumericPostingMap(
			this.metadataAliasCharPostings,
			state.metadataAliasCharPostings,
		);
		restoreNumericPostingMap(
			this.metadataAliasPhrasePostings,
			state.metadataAliasPhrasePostings,
		);
		restoreNumericPostingMap(this.metadataAliasPostings, state.metadataAliasPostings);
		restoreNumericPostingMap(
			this.metadataBasenameCharPostings,
			state.metadataBasenameCharPostings,
		);
		restoreNumericPostingMap(
			this.metadataBasenamePhrasePostings,
			state.metadataBasenamePhrasePostings,
		);
		restoreNumericPostingMap(
			this.metadataBasenamePostings,
			state.metadataBasenamePostings,
		);
		restoreNumericPostingMap(
			this.metadataFolderCharPostings,
			state.metadataFolderCharPostings,
		);
		restoreNumericPostingMap(
			this.metadataFolderPhrasePostings,
			state.metadataFolderPhrasePostings,
		);
		restoreNumericPostingMap(this.metadataFolderPostings, state.metadataFolderPostings);
		restoreNumericPostingMap(
			this.metadataHeadingCharPostings,
			state.metadataHeadingCharPostings,
		);
		restoreNumericPostingMap(
			this.metadataHeadingPhrasePostings,
			state.metadataHeadingPhrasePostings,
		);
		restoreNumericPostingMap(
			this.metadataHeadingPostings,
			state.metadataHeadingPostings,
		);
		restoreNumericPostingMap(
			this.metadataTagCharPostings,
			state.metadataTagCharPostings,
		);
		restoreNumericPostingMap(
			this.metadataTagFullPostings,
			state.metadataTagFullPostings,
		);
		restoreNumericPostingMap(
			this.metadataTagPhrasePostings,
			state.metadataTagPhrasePostings,
		);
		restoreNumericPostingMap(this.metadataTagPostings, state.metadataTagPostings);
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
	): CoverageLexicalDocRankableResult | null {
		const cached = this.getOrCreateRankableDocCacheEntry(
			docId,
			queryTerms,
			plan,
			state,
			phraseSignatures,
			charQuery,
			queryCache,
		);
		if (!cached?.coarseResult) {
			return null;
		}
		if (!includeLocalWindow) {
			return cached.coarseResult;
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
	): CoverageLexicalEngineQueryDocCacheEntry | null {
		const cached = queryCache.docCacheById.get(docId);
		if (cached) {
			return cached;
		}
		const bodyTokenSequence = this.getDocumentBodyTokens(
			docId,
			queryCache.bodyTokensByDocId,
		);
		if (!bodyTokenSequence) {
			return null;
		}
		const tagValues = this.documentTagValuesById[docId] ?? [];
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
			state,
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
		const coarseSignalStartedAt = this.benchmarkPhaseTiming ? performance.now() : 0;
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
		const created = {
			bodyEvidenceTrace,
			admissionSignal,
			baseSignal,
			coarseResult,
		};
		queryCache.docCacheById.set(docId, created);
		return created;
	}

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
	const metadataIdentity = createEmptyMetadataIdentitySignal();
	const bodyChar = createEmptyCharSignal();
	const metadataChar = createEmptyCharSignal();
	const familyCountSummary = createEmptyFamilyCountSummary();
	let tailCoreWeight = 0;
	let tailSoftWeight = 0;
	const matchedTerms: string[] = [];
	const matchedTermSet = new Set<string>();

	for (const family of families) {
		const familyIndex = family.index;
		const bodyCode = state.bodyMatches[familyIndex] ?? 0;
		const metadataCode = state.metadataMatches[familyIndex] ?? 0;
		if (family.role === "noise" || (bodyCode === 0 && metadataCode === 0)) {
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
		if (metadataCode > 0) {
			const primaryMetadataField =
				basenameCode > 0
					? "basename"
					: aliasCode > 0
						? "aliases"
						: folderCode > 0
							? "folder"
							: headingsCode > 0
								? "headings"
								: tagsCode > 0
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
					weight,
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
					weight,
				);
				continue;
			}
			if (bodyCode > 0) {
				applyMatchCode(softBody, bodyCode, weight);
				tailSoftWeight += weight;
			}
		}
	}

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
		metadataIdentity,
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
	baseWeight: number,
): void {
	const bestCode = Math.max(
		aliasCode,
		basenameCode,
		headingsCode,
		folderCode,
	);
	if (bestCode === 0) {
		return;
	}
	applyMatchCode(identity.overall, bestCode, baseWeight);
	applyMatchCode(identity.alias, aliasCode, baseWeight);
	applyMatchCode(identity.basename, basenameCode, baseWeight);
	applyMatchCode(identity.heading, headingsCode, baseWeight);
	applyMatchCode(identity.path, folderCode, baseWeight);
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
	return {
		path,
		queryTerms: result.queryTerms,
		matchedTerms: result.matchedTerms,
		score: result.score,
		nativeSubItemsReady: false,
		directSubItems: [],
	};
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
const INDEX_POSTING_DOC_ID_BYTES = 4;
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

function estimateNumericPostingMapBytes(
	postings: ReadonlyMap<string, readonly number[]>,
	accumulator: IndexSizeAccumulator,
	source: string,
): {
	total: number;
	termCount: number;
	postingCount: number;
	mapEntryBytes: number;
	termReferenceBytes: number;
	postingNumberBytes: number;
} {
	let termCount = 0;
	let postingCount = 0;
	for (const [term, docIds] of postings.entries()) {
		termCount += 1;
		accountStringBytes(accumulator, term, source);
		postingCount += docIds.length;
	}
	const mapEntryBytes = termCount * INDEX_MAP_ENTRY_BYTES;
	const termReferenceBytes = termCount * INDEX_REFERENCE_BYTES;
	const postingNumberBytes = postingCount * INDEX_POSTING_DOC_ID_BYTES;
	return {
		total:
			INDEX_COLLECTION_HEADER_BYTES +
			mapEntryBytes +
			termReferenceBytes +
			postingNumberBytes,
		termCount,
		postingCount,
		mapEntryBytes,
		termReferenceBytes,
		postingNumberBytes,
	};
}

function estimatePackedNumericPostingMapBytes(
	postings: ReadonlyMap<string, Uint32Array>,
	accumulator: IndexSizeAccumulator,
	source: string,
): {
	total: number;
	termCount: number;
	postingCount: number;
	mapEntryBytes: number;
	termReferenceBytes: number;
	postingNumberBytes: number;
} {
	let termCount = 0;
	let postingCount = 0;
	for (const [term, docIds] of postings.entries()) {
		termCount += 1;
		accountStringBytes(accumulator, term, source);
		postingCount += docIds.length;
	}
	const mapEntryBytes = termCount * INDEX_MAP_ENTRY_BYTES;
	const termReferenceBytes = termCount * INDEX_REFERENCE_BYTES;
	const postingNumberBytes = postingCount * INDEX_POSTING_DOC_ID_BYTES;
	return {
		total:
			INDEX_COLLECTION_HEADER_BYTES +
			mapEntryBytes +
			termReferenceBytes +
			postingNumberBytes,
		termCount,
		postingCount,
		mapEntryBytes,
		termReferenceBytes,
		postingNumberBytes,
	};
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

function readCoverageLexicalNumericTokenRange(
	tape: Uint32Array,
	range: CoverageLexicalTokenRange | undefined,
): Uint32Array | undefined {
	if (!range) {
		return undefined;
	}
	return tape.subarray(range.start, range.end);
}

function estimateNumericTokenTapeSlotsBytes(
	tape: Uint32Array,
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
} {
	const populatedCount = rangesById.filter((range) => range !== undefined).length;
	const tapeArrayBytes = INDEX_COLLECTION_HEADER_BYTES + tape.length * INDEX_UINT32_BYTES;
	const slotReferenceBytes = rangesById.length * INDEX_REFERENCE_BYTES;
	const rangeNumberBytes = populatedCount * INDEX_NUMBER_BYTES * 2;
	return {
		total:
			INDEX_COLLECTION_HEADER_BYTES +
			slotReferenceBytes +
			rangeNumberBytes +
			tapeArrayBytes,
		slotCount: rangesById.length,
		populatedCount,
		slotReferenceBytes,
		rangeNumberBytes,
		tokenCount: tape.length,
		tokenNumberBytes: tape.length * INDEX_UINT32_BYTES,
		tapeArrayBytes,
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
	documentBodyTokenIdTape: Uint32Array,
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
	const byGroup = {
		bodyExactTerms: summarizeSources(["postings.body.term"]),
		metadataExactTerms: summarizeSources([
			"postings.metadataAlias.term",
			"postings.metadataBasename.term",
			"postings.metadataFolder.term",
			"postings.metadataHeading.term",
			"postings.metadataTag.term",
			"postings.metadataTagFull.term",
		]),
		metadataPhraseTerms: summarizeSources([
			"postings.metadataAliasPhrase.term",
			"postings.metadataBasenamePhrase.term",
			"postings.metadataFolderPhrase.term",
			"postings.metadataHeadingPhrase.term",
			"postings.metadataTagPhrase.term",
		]),
		bodyCharTerms: summarizeSources(["postings.bodyChar.term"]),
		metadataCharTerms: summarizeSources([
			"postings.metadataAliasChar.term",
			"postings.metadataBasenameChar.term",
			"postings.metadataFolderChar.term",
			"postings.metadataHeadingChar.term",
			"postings.metadataTagChar.term",
		]),
		documentText: summarizeSources([
			"documents.basenameText",
			"documents.folderText",
			"documents.aliasesText",
			"documents.tagsText",
			"documents.headingsText",
		]),
		documentPaths: summarizeSources([
			"documents.path",
			"documentIdentity.pathToId.path",
			"documentIdentity.idToPath.path",
		]),
		documentDerivedTokens: summarizeSources([
			"documentIdentity.bodyHanSegments",
			"documentIdentity.tagValues",
		]),
		lexicon: summarizeSources(["lexicon.term"]),
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
	postingsLists: readonly (readonly number[] | undefined)[],
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
	postingMaps: readonly ReadonlyMap<string, readonly number[]>[],
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

function addNumericPosting(
	postings: Map<string, number[]>,
	term: string,
	docId: number,
): void {
	let docs = postings.get(term);
	if (!docs) {
		docs = [];
		postings.set(term, docs);
	}
	docs.push(docId);
}

function cloneNumericPostingMap(
	postings: ReadonlyMap<string, readonly number[]>,
): Map<string, readonly number[]> {
	return new Map(
		Array.from(postings.entries(), ([term, docIds]) => [
			term,
			[...docIds].sort((left, right) => left - right),
		]),
	);
}

function restoreNumericPostingMap(
	target: Map<string, number[]>,
	source: ReadonlyMap<string, readonly number[]>,
): void {
	target.clear();
	for (const [term, docIds] of source) {
		target.set(term, [...docIds]);
	}
}

function addPackedNumericPosting(
	postings: Map<string, Uint32Array>,
	term: string,
	docId: number,
): void {
	const docs = postings.get(term);
	if (!docs) {
		postings.set(term, Uint32Array.of(docId));
		return;
	}
	const next = new Uint32Array(docs.length + 1);
	next.set(docs);
	next[docs.length] = docId;
	postings.set(term, next);
}

function clonePackedNumericPostingMap(
	postings: ReadonlyMap<string, Uint32Array>,
): Map<string, Uint32Array> {
	return new Map(
		Array.from(postings.entries(), ([term, docIds]) => [
			term,
			Uint32Array.from([...docIds].sort((left, right) => left - right)),
		]),
	);
}

function restorePackedNumericPostingMap(
	target: Map<string, Uint32Array>,
	source: ReadonlyMap<string, Uint32Array>,
): void {
	target.clear();
	for (const [term, docIds] of source) {
		target.set(term, new Uint32Array(docIds));
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

function removeNumericPosting(
	postings: Map<string, number[]>,
	term: string,
	docId: number,
): void {
	const docs = postings.get(term);
	if (!docs) {
		return;
	}
	const index = docs.indexOf(docId);
	if (index === -1) {
		return;
	}
	docs.splice(index, 1);
	if (docs.length === 0) {
		postings.delete(term);
	}
}

function removePackedNumericPosting(
	postings: Map<string, Uint32Array>,
	term: string,
	docId: number,
): void {
	const docs = postings.get(term);
	if (!docs) {
		return;
	}
	const index = docs.indexOf(docId);
	if (index === -1) {
		return;
	}
	if (docs.length === 1) {
		postings.delete(term);
		return;
	}
	const next = new Uint32Array(docs.length - 1);
	next.set(docs.subarray(0, index), 0);
	next.set(docs.subarray(index + 1), index);
	postings.set(term, next);
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
