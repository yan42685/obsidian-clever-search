import type {
	FileSubItem,
	IndexedDocument,
	MatchedFile,
} from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import type {
	FileSearchEngine,
	FileSearchRequest,
	SerializedFileSearchIndex,
} from "../file-search-engine";
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
import { buildCoverageLexicalPlan } from "./coverage-lexical-planner";
import { collectCoverageLexicalCandidateStatesByDocId } from "./coverage-lexical-recall";
import { buildCoverageLexicalPairSignatures } from "./coverage-lexical-signatures";
import {
	compareCoverageLexicalResultSignals,
} from "./coverage-lexical-ranker";
import {
	buildCoverageLexicalWindowFusionSignal,
	createEmptyCoverageLexicalWindowFusionSignal,
} from "./coverage-lexical-fusion";
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
	aliasPhraseTerms: Set<string>;
	aliasTerms: Set<string>;
	aliasCharTerms: Set<string>;
	basenamePhraseTerms: Set<string>;
	basenameTerms: Set<string>;
	basenameCharTerms: Set<string>;
	bodyTokenSequence: string[];
	bodyPhraseTerms: Set<string>;
	bodyText: string;
	bodyTerms: Set<string>;
	bodyCharTerms: Set<string>;
	folderPhraseTerms: Set<string>;
	folderTerms: Set<string>;
	folderCharTerms: Set<string>;
	headingPhraseTerms: Set<string>;
	headingTerms: Set<string>;
	headingCharTerms: Set<string>;
	metadataTerms: Set<string>;
	tagPhraseTerms: Set<string>;
	tagTerms: Set<string>;
	tagCharTerms: Set<string>;
	tagValues: string[];
};

type CoverageLexicalDocRankableResult = {
	docId: number;
	queryTerms: string[];
	matchedTerms: string[];
	score?: number;
	coverageLexicalSignal: CoverageLexicalFamilySignal;
	admissionSignal: ReturnType<typeof buildCoverageLexicalPassageAdmissionSignal>;
};

const DEFAULT_LOCAL_WINDOW_RERANK_BUDGET = 24;

@singleton()
export class CoverageLexicalFileSearchEngine implements FileSearchEngine {
	readonly backend = "coverage-lexical" as const;
	readonly supportsSerialization = false;

	private readonly tokenizer = getInstance(Tokenizer);
	private readonly documents = new Map<string, CoverageLexicalDocument>();
	private readonly documentById: Array<CoverageLexicalDocument | undefined> = [];
	private readonly documentIdByPath = new Map<string, number>();
	private readonly documentPathById: Array<string | undefined> = [];
	private readonly documentBodyTokensById: Array<readonly string[] | undefined> = [];
	private readonly documentTagValuesById: Array<readonly string[] | undefined> = [];
	private nextDocumentId = 0;
	private readonly bodyPostings = new Map<string, number[]>();
	private readonly bodyCharPostings = new Map<string, number[]>();
	private readonly bodyHanSegmentPostings = new Map<string, Set<string>>();
	private readonly bodyPhrasePostings = new Map<string, number[]>();
	private readonly metadataAliasCharPostings = new Map<string, number[]>();
	private readonly metadataAliasHanSegmentPostings = new Map<string, Set<string>>();
	private readonly metadataAliasPhrasePostings = new Map<string, number[]>();
	private readonly metadataAliasPostings = new Map<string, number[]>();
	private readonly metadataBasenameCharPostings = new Map<string, number[]>();
	private readonly metadataBasenameHanSegmentPostings = new Map<string, Set<string>>();
	private readonly metadataBasenamePhrasePostings = new Map<string, number[]>();
	private readonly metadataBasenamePostings = new Map<string, number[]>();
	private readonly metadataFolderCharPostings = new Map<string, number[]>();
	private readonly metadataFolderHanSegmentPostings = new Map<string, Set<string>>();
	private readonly metadataFolderPhrasePostings = new Map<string, number[]>();
	private readonly metadataFolderPostings = new Map<string, number[]>();
	private readonly metadataHeadingCharPostings = new Map<string, number[]>();
	private readonly metadataHeadingHanSegmentPostings = new Map<string, Set<string>>();
	private readonly metadataHeadingPhrasePostings = new Map<string, number[]>();
	private readonly metadataHeadingPostings = new Map<string, number[]>();
	private readonly metadataPostings = new Map<string, number[]>();
	private readonly metadataTagCharPostings = new Map<string, number[]>();
	private readonly metadataTagFullPostings = new Map<string, number[]>();
	private readonly metadataTagPhrasePostings = new Map<string, number[]>();
	private readonly metadataTagPostings = new Map<string, number[]>();
	private readonly lexicon = new Set<string>();
	private sortedLexicon: string[] = [];

	async reIndexAll(
		data: IndexedDocument[] | SerializedFileSearchIndex,
	): Promise<boolean> {
		if (!Array.isArray(data)) {
			logger.warn(
				"coverage-lexical MVP currently supports rebuild from live documents only",
			);
			this.clearIndex();
			return false;
		}

		this.clearIndex();
		await this.addDocuments(data);
		return true;
	}

	clearIndex(): void {
		this.documents.clear();
		this.documentById.length = 0;
		this.documentIdByPath.clear();
		this.documentPathById.length = 0;
		this.documentBodyTokensById.length = 0;
		this.documentTagValuesById.length = 0;
		this.nextDocumentId = 0;
		this.bodyPostings.clear();
		this.bodyCharPostings.clear();
		this.bodyHanSegmentPostings.clear();
		this.bodyPhrasePostings.clear();
		this.metadataAliasCharPostings.clear();
		this.metadataAliasHanSegmentPostings.clear();
		this.metadataAliasPhrasePostings.clear();
		this.metadataAliasPostings.clear();
		this.metadataBasenameCharPostings.clear();
		this.metadataBasenameHanSegmentPostings.clear();
		this.metadataBasenamePhrasePostings.clear();
		this.metadataBasenamePostings.clear();
		this.metadataFolderCharPostings.clear();
		this.metadataFolderHanSegmentPostings.clear();
		this.metadataFolderPhrasePostings.clear();
		this.metadataFolderPostings.clear();
		this.metadataHeadingCharPostings.clear();
		this.metadataHeadingHanSegmentPostings.clear();
		this.metadataHeadingPhrasePostings.clear();
		this.metadataHeadingPostings.clear();
		this.metadataPostings.clear();
		this.metadataTagCharPostings.clear();
		this.metadataTagFullPostings.clear();
		this.metadataTagPhrasePostings.clear();
		this.metadataTagPostings.clear();
		this.lexicon.clear();
		this.sortedLexicon = [];
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

		const familyProbes = this.buildFamilyProbes(queryTerms);
		const plan = buildCoverageLexicalPlan(request.queryText, queryTerms, familyProbes);
		const pairSignatures = buildCoverageLexicalPairSignatures(plan.families);
		const phraseSignatures = [
			...buildCoverageLexicalPhraseSignatures(plan.families),
			...buildCoverageLexicalStructuredMetadataSignatures(
				request.queryText,
				plan.families,
			),
		];
		const candidates = collectCoverageLexicalCandidateStatesByDocId(
			{
				bodyPostings: this.bodyPostings,
				bodyCharPostings: this.bodyCharPostings,
				bodyHanSegmentPostings: this.bodyHanSegmentPostings,
				metadataAliasCharPostings: this.metadataAliasCharPostings,
				metadataAliasHanSegmentPostings: this.metadataAliasHanSegmentPostings,
				metadataAliasPhrasePostings: this.metadataAliasPhrasePostings,
				metadataAliasPostings: this.metadataAliasPostings,
				metadataBasenameCharPostings: this.metadataBasenameCharPostings,
				metadataBasenameHanSegmentPostings: this.metadataBasenameHanSegmentPostings,
				metadataBasenamePhrasePostings: this.metadataBasenamePhrasePostings,
				metadataBasenamePostings: this.metadataBasenamePostings,
				metadataFolderCharPostings: this.metadataFolderCharPostings,
				metadataFolderHanSegmentPostings: this.metadataFolderHanSegmentPostings,
				metadataFolderPhrasePostings: this.metadataFolderPhrasePostings,
				metadataFolderPostings: this.metadataFolderPostings,
				metadataHeadingCharPostings: this.metadataHeadingCharPostings,
				metadataHeadingHanSegmentPostings: this.metadataHeadingHanSegmentPostings,
				metadataHeadingPhrasePostings: this.metadataHeadingPhrasePostings,
				metadataHeadingPostings: this.metadataHeadingPostings,
				metadataPostings: this.metadataPostings,
				bodyPhrasePostings: this.bodyPhrasePostings,
				metadataTagCharPostings: this.metadataTagCharPostings,
				metadataTagFullPostings: this.metadataTagFullPostings,
				metadataTagPhrasePostings: this.metadataTagPhrasePostings,
				metadataTagPostings: this.metadataTagPostings,
				sortedLexicon: this.sortedLexicon,
				documentIdByPath: this.documentIdByPath,
				documentPathById: this.documentPathById,
				documentBodyTokensById: this.documentBodyTokensById,
				documentTagValuesById: this.documentTagValuesById,
			},
			plan,
			phraseSignatures,
			request,
			charQuery,
		);
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
				),
			)
			.filter((result): result is CoverageLexicalDocRankableResult => result !== null);
		const coarseResultByDocId = new Map(
			coarseResults.map((result) => [result.docId, result] as const),
		);
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
			);
			if (rerankedResult) {
				rerankedResults.push(rerankedResult);
			}
		}
		const ranked = rankCoverageLexicalDocResults(rerankedResults, plan);
		const finalResults = ranked.slice(0, request.maxItemResults);
		return finalResults.map((result) =>
			projectDocRankableResult(result, this.documentPathById),
		);
	}

	getDirectSubItems(
		queryText: string,
		path: string,
		maxSubItemCount: number,
	): FileSubItem[] | null {
		const document = this.documents.get(path);
		if (!document) {
			return null;
		}
		return buildDirectSubitemsExactFileSubItems({
			queryText,
			snapshotText: document.bodyText,
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
		return null;
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
			bodyHanSegmentTermCount: this.bodyHanSegmentPostings.size,
			bodyPhraseTermCount: this.bodyPhrasePostings.size,
			metadataAliasCharTermCount: this.metadataAliasCharPostings.size,
			metadataAliasHanSegmentTermCount: this.metadataAliasHanSegmentPostings.size,
			metadataAliasPhraseTermCount: this.metadataAliasPhrasePostings.size,
			metadataAliasTermCount: this.metadataAliasPostings.size,
			metadataBasenameCharTermCount: this.metadataBasenameCharPostings.size,
			metadataBasenameHanSegmentTermCount: this.metadataBasenameHanSegmentPostings.size,
			metadataBasenamePhraseTermCount: this.metadataBasenamePhrasePostings.size,
			metadataBasenameTermCount: this.metadataBasenamePostings.size,
			metadataFolderCharTermCount: this.metadataFolderCharPostings.size,
			metadataFolderHanSegmentTermCount: this.metadataFolderHanSegmentPostings.size,
			metadataFolderPhraseTermCount: this.metadataFolderPhrasePostings.size,
			metadataFolderTermCount: this.metadataFolderPostings.size,
			metadataHeadingCharTermCount: this.metadataHeadingCharPostings.size,
			metadataHeadingHanSegmentTermCount: this.metadataHeadingHanSegmentPostings.size,
			metadataHeadingPhraseTermCount: this.metadataHeadingPhrasePostings.size,
			metadataHeadingTermCount: this.metadataHeadingPostings.size,
			metadataTermCount: this.metadataPostings.size,
			metadataTagCharTermCount: this.metadataTagCharPostings.size,
			metadataTagFullTermCount: this.metadataTagFullPostings.size,
			metadataTagPhraseTermCount: this.metadataTagPhrasePostings.size,
			metadataTagTermCount: this.metadataTagPostings.size,
			lexiconSize: this.sortedLexicon.length,
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
			this.documentBodyTokensById,
			this.documentTagValuesById,
			this.nextDocumentId,
			accumulator,
		);
		const postings = {
			body: estimateNumericPostingMapBytes(this.bodyPostings, accumulator),
			bodyChar: estimateNumericPostingMapBytes(this.bodyCharPostings, accumulator),
			bodyHanSegments: estimatePostingMapBytes(
				this.bodyHanSegmentPostings,
				accumulator,
			),
			bodyPhrase: estimateNumericPostingMapBytes(
				this.bodyPhrasePostings,
				accumulator,
			),
			metadataAlias: estimateNumericPostingMapBytes(
				this.metadataAliasPostings,
				accumulator,
			),
			metadataAliasChar: estimateNumericPostingMapBytes(
				this.metadataAliasCharPostings,
				accumulator,
			),
			metadataAliasHanSegments: estimatePostingMapBytes(
				this.metadataAliasHanSegmentPostings,
				accumulator,
			),
			metadataAliasPhrase: estimateNumericPostingMapBytes(
				this.metadataAliasPhrasePostings,
				accumulator,
			),
			metadataBasename: estimateNumericPostingMapBytes(
				this.metadataBasenamePostings,
				accumulator,
			),
			metadataBasenameChar: estimateNumericPostingMapBytes(
				this.metadataBasenameCharPostings,
				accumulator,
			),
			metadataBasenameHanSegments: estimatePostingMapBytes(
				this.metadataBasenameHanSegmentPostings,
				accumulator,
			),
			metadataBasenamePhrase: estimateNumericPostingMapBytes(
				this.metadataBasenamePhrasePostings,
				accumulator,
			),
			metadataFolder: estimateNumericPostingMapBytes(
				this.metadataFolderPostings,
				accumulator,
			),
			metadataFolderChar: estimateNumericPostingMapBytes(
				this.metadataFolderCharPostings,
				accumulator,
			),
			metadataFolderHanSegments: estimatePostingMapBytes(
				this.metadataFolderHanSegmentPostings,
				accumulator,
			),
			metadataFolderPhrase: estimateNumericPostingMapBytes(
				this.metadataFolderPhrasePostings,
				accumulator,
			),
			metadataHeading: estimateNumericPostingMapBytes(
				this.metadataHeadingPostings,
				accumulator,
			),
			metadataHeadingChar: estimateNumericPostingMapBytes(
				this.metadataHeadingCharPostings,
				accumulator,
			),
			metadataHeadingHanSegments: estimatePostingMapBytes(
				this.metadataHeadingHanSegmentPostings,
				accumulator,
			),
			metadataHeadingPhrase: estimateNumericPostingMapBytes(
				this.metadataHeadingPhrasePostings,
				accumulator,
			),
			metadata: estimateNumericPostingMapBytes(
				this.metadataPostings,
				accumulator,
			),
			metadataTag: estimateNumericPostingMapBytes(
				this.metadataTagPostings,
				accumulator,
			),
			metadataTagChar: estimateNumericPostingMapBytes(
				this.metadataTagCharPostings,
				accumulator,
			),
			metadataTagFull: estimateNumericPostingMapBytes(
				this.metadataTagFullPostings,
				accumulator,
			),
			metadataTagPhrase: estimateNumericPostingMapBytes(
				this.metadataTagPhrasePostings,
				accumulator,
			),
		};
		const lexicon = estimateStringArrayBytes(this.sortedLexicon, accumulator);
		const total =
			accumulator.stringPoolBytes +
			documents.total +
			documentIdentity.total +
			sumNamedByteBreakdowns(postings) +
			lexicon.total;
		return {
			estimatedBytes: {
				total,
				stringPool: {
					bytes: accumulator.stringPoolBytes,
					uniqueStrings: accumulator.seenStrings.size,
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

		const bodyTokenSequence = this.tokenizer
			.tokenizeSequence(document.content ?? "", "index")
			.map((term) => term.toLowerCase());
		const bodyTerms = new Set(bodyTokenSequence);
		const bodyCharTerms = new Set(extractHanBigrams(document.content ?? ""));
		const bodyHanSegments = new Set(extractHanSegments(document.content ?? ""));
		const basenameTerms = new Set(
			this.tokenizer
				.tokenizeSequence(document.basename ?? "", "index")
				.map((term) => term.toLowerCase()),
		);
		const basenameCharTerms = new Set(extractHanBigrams(document.basename ?? ""));
		const basenameHanSegments = new Set(extractHanSegments(document.basename ?? ""));
		const folderTerms = new Set(
			this.tokenizer
				.tokenizeSequence(document.folder ?? "", "index")
				.map((term) => term.toLowerCase()),
		);
		const folderCharTerms = new Set(extractHanBigrams(document.folder ?? ""));
		const folderHanSegments = new Set(extractHanSegments(document.folder ?? ""));
		const aliasTerms = new Set(
			this.tokenizer
				.tokenizeSequence(document.aliases ?? "", "index")
				.map((term) => term.toLowerCase()),
		);
		const aliasCharTerms = new Set(extractHanBigrams(document.aliases ?? ""));
		const aliasHanSegments = new Set(extractHanSegments(document.aliases ?? ""));
		const tagTerms = new Set(
			this.tokenizer
				.tokenizeSequence(document.tags ?? "", "index")
				.map((term) => term.toLowerCase()),
		);
		const tagValues = splitCoverageLexicalTagValues(document.tags ?? "");
		const tagCharTerms = new Set(
			tagValues.flatMap((tagValue) => extractHanBigrams(tagValue)),
		);
		const headingTerms = new Set(
			this.tokenizer
				.tokenizeSequence(document.headings ?? "", "index")
				.map((term) => term.toLowerCase()),
		);
		const headingCharTerms = new Set(extractHanBigrams(document.headings ?? ""));
		const headingHanSegments = new Set(extractHanSegments(document.headings ?? ""));
		const metadataTokenSequence = [
			...basenameTerms,
			...folderTerms,
			...aliasTerms,
			...tagTerms,
			...headingTerms,
		];
		const metadataTerms = new Set(metadataTokenSequence);
		const aliasPhraseTerms = new Set(buildCoverageLexicalPhraseTerms(Array.from(aliasTerms)));
		const basenamePhraseTerms = new Set(
			buildCoverageLexicalPhraseTerms(Array.from(basenameTerms)),
		);
		const bodyPhraseTerms = new Set(
			buildCoverageLexicalPhraseTerms(bodyTokenSequence),
		);
		const folderPhraseTerms = new Set(
			buildCoverageLexicalPhraseTerms(Array.from(folderTerms)),
		);
		const headingPhraseTerms = new Set(
			buildCoverageLexicalPhraseTerms(Array.from(headingTerms)),
		);
		const tagPhraseTerms = new Set(
			buildCoverageLexicalPhraseTerms(Array.from(tagTerms)),
		);

		const indexedDocument = {
			docId,
			aliasPhraseTerms,
			aliasTerms,
			aliasCharTerms,
			basenamePhraseTerms,
			basenameTerms,
			basenameCharTerms,
			bodyTokenSequence,
			bodyPhraseTerms,
			bodyText: document.content ?? "",
			bodyTerms,
			bodyCharTerms,
			folderPhraseTerms,
			folderTerms,
			folderCharTerms,
			headingPhraseTerms,
			headingTerms,
			headingCharTerms,
			metadataTerms,
			tagPhraseTerms,
			tagTerms,
			tagCharTerms,
			tagValues,
		};
		this.documents.set(document.path, indexedDocument);
		this.documentById[docId] = indexedDocument;
		this.documentBodyTokensById[docId] = bodyTokenSequence;
		this.documentTagValuesById[docId] = tagValues;

		for (const term of bodyTerms) {
			addNumericPosting(this.bodyPostings, term, docId);
			this.lexicon.add(term);
		}
		for (const term of bodyCharTerms) {
			addNumericPosting(this.bodyCharPostings, term, docId);
		}
		for (const term of bodyPhraseTerms) {
			addNumericPosting(this.bodyPhrasePostings, term, docId);
		}
		for (const term of aliasTerms) {
			addNumericPosting(this.metadataAliasPostings, term, docId);
			this.lexicon.add(term);
		}
		for (const term of aliasCharTerms) {
			addNumericPosting(this.metadataAliasCharPostings, term, docId);
		}
		for (const term of aliasPhraseTerms) {
			addNumericPosting(this.metadataAliasPhrasePostings, term, docId);
		}
		for (const term of basenameTerms) {
			addNumericPosting(this.metadataBasenamePostings, term, docId);
			this.lexicon.add(term);
		}
		for (const term of basenameCharTerms) {
			addNumericPosting(this.metadataBasenameCharPostings, term, docId);
		}
		for (const term of basenamePhraseTerms) {
			addNumericPosting(this.metadataBasenamePhrasePostings, term, docId);
		}
		for (const term of folderTerms) {
			addNumericPosting(this.metadataFolderPostings, term, docId);
			this.lexicon.add(term);
		}
		for (const term of folderCharTerms) {
			addNumericPosting(this.metadataFolderCharPostings, term, docId);
		}
		for (const term of folderPhraseTerms) {
			addNumericPosting(this.metadataFolderPhrasePostings, term, docId);
		}
		for (const term of headingTerms) {
			addNumericPosting(this.metadataHeadingPostings, term, docId);
			this.lexicon.add(term);
		}
		for (const term of headingCharTerms) {
			addNumericPosting(this.metadataHeadingCharPostings, term, docId);
		}
		for (const term of headingPhraseTerms) {
			addNumericPosting(this.metadataHeadingPhrasePostings, term, docId);
		}
		for (const term of metadataTerms) {
			addNumericPosting(this.metadataPostings, term, docId);
			this.lexicon.add(term);
		}
		for (const term of tagTerms) {
			addNumericPosting(this.metadataTagPostings, term, docId);
			this.lexicon.add(term);
		}
		for (const term of new Set(tagValues)) {
			addNumericPosting(this.metadataTagFullPostings, term, docId);
		}
		for (const term of tagCharTerms) {
			addNumericPosting(this.metadataTagCharPostings, term, docId);
		}
		for (const term of tagPhraseTerms) {
			addNumericPosting(this.metadataTagPhrasePostings, term, docId);
		}
		this.sortedLexicon = Array.from(this.lexicon).sort();
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
		for (const term of existing.bodyTerms) {
			removeNumericPosting(this.bodyPostings, term, docId);
		}
		for (const term of existing.bodyCharTerms) {
			removeNumericPosting(this.bodyCharPostings, term, docId);
		}
		for (const term of existing.bodyPhraseTerms) {
			removeNumericPosting(this.bodyPhrasePostings, term, docId);
		}
		for (const term of existing.aliasTerms) {
			removeNumericPosting(this.metadataAliasPostings, term, docId);
		}
		for (const term of existing.aliasCharTerms) {
			removeNumericPosting(this.metadataAliasCharPostings, term, docId);
		}
		for (const term of existing.aliasPhraseTerms) {
			removeNumericPosting(this.metadataAliasPhrasePostings, term, docId);
		}
		for (const term of existing.basenameTerms) {
			removeNumericPosting(this.metadataBasenamePostings, term, docId);
		}
		for (const term of existing.basenameCharTerms) {
			removeNumericPosting(this.metadataBasenameCharPostings, term, docId);
		}
		for (const term of existing.basenamePhraseTerms) {
			removeNumericPosting(this.metadataBasenamePhrasePostings, term, docId);
		}
		for (const term of existing.folderTerms) {
			removeNumericPosting(this.metadataFolderPostings, term, docId);
		}
		for (const term of existing.folderCharTerms) {
			removeNumericPosting(this.metadataFolderCharPostings, term, docId);
		}
		for (const term of existing.folderPhraseTerms) {
			removeNumericPosting(this.metadataFolderPhrasePostings, term, docId);
		}
		for (const term of existing.headingTerms) {
			removeNumericPosting(this.metadataHeadingPostings, term, docId);
		}
		for (const term of existing.headingCharTerms) {
			removeNumericPosting(this.metadataHeadingCharPostings, term, docId);
		}
		for (const term of existing.headingPhraseTerms) {
			removeNumericPosting(this.metadataHeadingPhrasePostings, term, docId);
		}
		for (const term of existing.metadataTerms) {
			removeNumericPosting(this.metadataPostings, term, docId);
		}
		for (const term of existing.tagTerms) {
			removeNumericPosting(this.metadataTagPostings, term, docId);
		}
		for (const term of new Set(existing.tagValues)) {
			removeNumericPosting(this.metadataTagFullPostings, term, docId);
		}
		for (const term of existing.tagCharTerms) {
			removeNumericPosting(this.metadataTagCharPostings, term, docId);
		}
		for (const term of existing.tagPhraseTerms) {
			removeNumericPosting(this.metadataTagPhrasePostings, term, docId);
		}
		this.documents.delete(path);
		this.documentById[docId] = undefined;
		this.documentBodyTokensById[docId] = undefined;
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
		for (const term of this.metadataPostings.keys()) {
			nextLexicon.add(term);
		}
		this.lexicon.clear();
		for (const term of nextLexicon) {
			this.lexicon.add(term);
		}
		this.sortedLexicon = Array.from(this.lexicon).sort();
	}

	private buildFamilyProbes(queryTerms: readonly string[]): CoverageLexicalFamilyProbe[] {
		return queryTerms.map((term) => ({
			bodyExactDocCount: getPostingEntryCount(this.bodyPostings.get(term)),
			metadataExactDocCount: getPostingEntryCount(this.metadataPostings.get(term)),
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

	private createRankableResult(
		docId: number,
		queryTerms: readonly string[],
		plan: CoverageLexicalPlan,
		state: CoverageLexicalCandidateState,
		includeLocalWindow: boolean,
		phraseSignatures: readonly CoverageLexicalPhraseSignature[],
		pairSignatures: readonly CoverageLexicalPairSignature[],
		charQuery: CoverageLexicalCharQuery,
	): CoverageLexicalDocRankableResult | null {
		const document = this.documentById[docId];
		if (!document) {
			return null;
		}
		const admissionSignal = buildCoverageLexicalPassageAdmissionSignal(
			document.bodyTokenSequence,
			plan.families,
			state,
			phraseSignatures,
		);
		const signal = buildCoverageSignal(
			plan,
			state,
			document.bodyTokenSequence,
			includeLocalWindow,
			phraseSignatures,
			pairSignatures,
			charQuery,
			document.tagValues,
		);
		if (
			signal.coreBody.coverageCount === 0 &&
			signal.softBody.coverageCount === 0 &&
			signal.metadataAnchor.coverageCount === 0 &&
			signal.bodyChar.matchCount === 0 &&
			signal.metadataChar.matchCount === 0 &&
			signal.tagSignal.exactMatchCount === 0 &&
			signal.tagSignal.charMatchCount === 0
		) {
			return null;
		}

		return {
			docId,
			queryTerms: [...queryTerms],
			matchedTerms: signal.matchedTerms,
			score: computeFallbackScore(signal),
			coverageLexicalSignal: signal,
			admissionSignal,
		};
	}

}

function buildCoverageSignal(
	plan: CoverageLexicalPlan,
	state: CoverageLexicalCandidateState,
	bodyTokenSequence: readonly string[],
	includeLocalWindow: boolean,
	phraseSignatures: readonly CoverageLexicalPhraseSignature[],
	pairSignatures: readonly CoverageLexicalPairSignature[],
	charQuery: CoverageLexicalCharQuery,
	tagValues: readonly string[],
): CoverageLexicalFamilySignal {
	const families = plan.families;
	const coreBody = createEmptyAreaSignal();
	const softBody = createEmptyAreaSignal();
	const metadataAnchor = createEmptyAreaSignal();
	const metadataIdentity = createEmptyMetadataIdentitySignal();
	const bodyChar = createEmptyCharSignal();
	const metadataChar = createEmptyCharSignal();
	const totalMatchedFamilyIndices = new Set<number>();
	const bodyMatchedFamilyIndices = new Set<number>();
	const primaryMetadataFields = new Map<number, CoverageLexicalMetadataField>();
	let tailCoreWeight = 0;
	let tailSoftWeight = 0;
	const matchedTerms = new Set<string>();

	for (const family of families) {
		const bodyKind = getRecordedMatchKind(state.bodyMatches, family.index);
		const metadataKind = getRecordedMatchKind(
			state.metadataMatches,
			family.index,
		);
		if (family.role === "noise" || (!bodyKind && !metadataKind)) {
			continue;
		}

		const weight = computeFamilyTailWeight(family.index);
		const bestKind = pickBetterMatchKind(bodyKind, metadataKind);
		if (bestKind) {
			matchedTerms.add(family.normalizedTerm);
		}
		totalMatchedFamilyIndices.add(family.index);
		if (bodyKind) {
			bodyMatchedFamilyIndices.add(family.index);
		}
		if (metadataKind) {
			const primaryMetadataField = resolvePrimaryMetadataFieldForFamily(
				state,
				family.index,
			);
			if (primaryMetadataField) {
				primaryMetadataFields.set(family.index, primaryMetadataField);
			}
		}
		if (family.role === "body") {
			if (bodyKind && family.strength === "core") {
				applyMatch(coreBody, bodyKind, weight);
				tailCoreWeight += weight;
				continue;
			}
			if (bodyKind) {
				applyMatch(softBody, bodyKind, weight);
				tailSoftWeight += weight;
				continue;
			}
			if (metadataKind) {
				const boostedWeight =
					weight * getMetadataFieldBoost(state, family.index, metadataKind);
				applyMatch(softBody, metadataKind, boostedWeight);
				tailSoftWeight += boostedWeight;
				applyIdentityMatch(metadataIdentity, state, family.index, weight);
			}
			continue;
		}
		if (family.role === "anchor") {
			if (metadataKind) {
				applyMatch(
					metadataAnchor,
					metadataKind,
					weight * getMetadataFieldBoost(state, family.index, metadataKind),
				);
				applyIdentityMatch(metadataIdentity, state, family.index, weight);
				continue;
			}
			if (bodyKind) {
				applyMatch(softBody, bodyKind, weight);
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

	bodyChar.matchCount = state.bodyCharTerms.size;
	bodyChar.matchRatio = computeCharMatchRatio(
		state.bodyCharTerms.size,
		charQuery.terms.length,
	);
	applySegmentCoverageSignal(bodyChar, state.bodyCharTerms, charQuery);
	metadataChar.matchCount = state.metadataCharTerms.size;
	metadataChar.matchRatio = computeCharMatchRatio(
		state.metadataCharTerms.size,
		charQuery.terms.length,
	);
	applySegmentCoverageSignal(metadataChar, state.metadataCharTerms, charQuery);
	const tagFallback = evaluateCoverageLexicalTagFallback(tagValues, charQuery);
	for (const term of tagFallback.exactTerms) {
		matchedTerms.add(term);
	}

	return {
		familyCountSummary: summarizeFamilyCountSignals(
			totalMatchedFamilyIndices,
			bodyMatchedFamilyIndices,
			primaryMetadataFields,
		),
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
		localEvidence: includeLocalWindow
			? buildCoverageLexicalWindowFusionSignal(
				bodyTokenSequence,
				families,
				pairSignatures,
				computePerFileLocalWindowLimit(plan, bodyTokenSequence.length),
			)
			: createEmptyCoverageLexicalWindowFusionSignal(),
		matchedTerms: Array.from(matchedTerms),
	};
}

function pickBetterMatchKind(
	left: CoverageFamilyMatchKind,
	right: CoverageFamilyMatchKind,
): CoverageFamilyMatchKind {
	const rank = {
		exact: 3,
		prefix: 2,
		fuzzy: 1,
		null: 0,
	} as const;
	return rank[left ?? "null"] >= rank[right ?? "null"] ? left : right;
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

function summarizeFamilyCountSignals(
	totalMatchedFamilyIndices: ReadonlySet<number>,
	bodyMatchedFamilyIndices: ReadonlySet<number>,
	primaryMetadataFields: ReadonlyMap<number, CoverageLexicalMetadataField>,
): CoverageLexicalFamilyCountSummary {
	const summary = createEmptyFamilyCountSummary();
	summary.totalMatchedFamilyCount = totalMatchedFamilyIndices.size;
	summary.bodyMatchedFamilyCount = bodyMatchedFamilyIndices.size;
	summary.metadataMatchedFamilyCount = primaryMetadataFields.size;
	for (const field of primaryMetadataFields.values()) {
		if (field === "basename") {
			summary.basenameMatchedFamilyCount += 1;
			continue;
		}
		if (field === "aliases") {
			summary.aliasesMatchedFamilyCount += 1;
			continue;
		}
		if (field === "folder") {
			summary.folderMatchedFamilyCount += 1;
			continue;
		}
		if (field === "headings") {
			summary.headingsMatchedFamilyCount += 1;
			continue;
		}
		summary.tagsMatchedFamilyCount += 1;
	}
	return summary;
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

function applyIdentityMatch(
	identity: CoverageLexicalMetadataIdentitySignal,
	state: CoverageLexicalCandidateState,
	familyIndex: number,
	baseWeight: number,
): void {
	const bestKind = getBestIdentityMatchKind(state, familyIndex);
	if (!bestKind) {
		return;
	}
	applyMatch(identity.overall, bestKind, baseWeight);
	applyIdentityFieldMatch(identity.alias, state.metadataFieldMatches.aliases, familyIndex, baseWeight);
	applyIdentityFieldMatch(identity.basename, state.metadataFieldMatches.basename, familyIndex, baseWeight);
	applyIdentityFieldMatch(identity.heading, state.metadataFieldMatches.headings, familyIndex, baseWeight);
	applyIdentityFieldMatch(identity.path, state.metadataFieldMatches.folder, familyIndex, baseWeight);
}

function applyIdentityFieldMatch(
	area: CoverageLexicalAreaSignal,
	matches: readonly number[],
	familyIndex: number,
	baseWeight: number,
): void {
	const kind = getRecordedMatchKind(matches, familyIndex);
	if (!kind) {
		return;
	}
	applyMatch(area, kind, baseWeight);
}

function getBestIdentityMatchKind(
	state: CoverageLexicalCandidateState,
	familyIndex: number,
): Exclude<CoverageFamilyMatchKind, null> | null {
	let bestKind: Exclude<CoverageFamilyMatchKind, null> | null = null;
	for (const matches of [
		state.metadataFieldMatches.aliases,
		state.metadataFieldMatches.basename,
		state.metadataFieldMatches.headings,
		state.metadataFieldMatches.folder,
	]) {
		const kind = getRecordedMatchKind(matches, familyIndex);
		if (!kind) {
			continue;
		}
		bestKind = pickBetterMatchKind(bestKind, kind) as Exclude<
			CoverageFamilyMatchKind,
			null
		>;
	}
	return bestKind;
}

function resolvePrimaryMetadataFieldForFamily(
	state: CoverageLexicalCandidateState,
	familyIndex: number,
): CoverageLexicalMetadataField | null {
	for (const field of [
		"basename",
		"aliases",
		"folder",
		"headings",
		"tags",
	] as const satisfies readonly CoverageLexicalMetadataField[]) {
		if (getRecordedMatchKind(state.metadataFieldMatches[field], familyIndex)) {
			return field;
		}
	}
	return null;
}

function getMetadataFieldBoost(
	state: CoverageLexicalCandidateState,
	familyIndex: number,
	kind: Exclude<CoverageFamilyMatchKind, null>,
): number {
	let bestBoost = 1;
	for (const [field, matches] of Object.entries(
		state.metadataFieldMatches,
	) as Array<[CoverageLexicalMetadataField, number[]]>) {
		if (getRecordedMatchKind(matches, familyIndex) !== kind) {
			continue;
		}
		bestBoost = Math.max(bestBoost, getMetadataFieldWeight(field));
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
	matchedTerms: ReadonlySet<string>,
	charQuery: CoverageLexicalCharQuery,
): void {
	for (const segment of charQuery.hanSegments) {
		const bigrams = charQuery.segmentBigrams.get(segment) ?? [];
		if (bigrams.length === 0) {
			continue;
		}
		const matchedCount = bigrams.filter((token) => matchedTerms.has(token)).length;
		if (matchedCount === bigrams.length) {
			target.fullSegmentCount += 1;
		}
		target.bestSegmentCoverageCount = Math.max(
			target.bestSegmentCoverageCount,
			matchedCount,
		);
		target.bestSegmentCoverageRatio = Math.max(
			target.bestSegmentCoverageRatio,
			matchedCount / bigrams.length,
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
};

const INDEX_COLLECTION_HEADER_BYTES = 4;
const INDEX_REFERENCE_BYTES = 4;
const INDEX_MAP_ENTRY_BYTES = 8;
const INDEX_NUMBER_BYTES = 8;
const INDEX_POSTING_DOC_ID_BYTES = 4;
const UTF8_ENCODER = new TextEncoder();

function createIndexSizeAccumulator(): IndexSizeAccumulator {
	return {
		seenStrings: new Set(),
		stringPoolBytes: 0,
	};
}

function accountStringBytes(
	accumulator: IndexSizeAccumulator,
	value: string,
): void {
	if (accumulator.seenStrings.has(value)) {
		return;
	}
	accumulator.seenStrings.add(value);
	accumulator.stringPoolBytes += UTF8_ENCODER.encode(value).byteLength;
}

function estimateStringArrayBytes(
	values: readonly string[],
	accumulator: IndexSizeAccumulator,
): {
	total: number;
	count: number;
	referenceBytes: number;
} {
	let count = 0;
	for (const value of values) {
		count += 1;
		accountStringBytes(accumulator, value);
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
): {
	total: number;
	count: number;
	referenceBytes: number;
} {
	return estimateStringArrayBytes(Array.from(values), accumulator);
}

function estimatePostingMapBytes(
	postings: ReadonlyMap<string, ReadonlySet<string>>,
	accumulator: IndexSizeAccumulator,
): {
	total: number;
	termCount: number;
	postingCount: number;
	mapEntryBytes: number;
	referenceBytes: number;
} {
	let termCount = 0;
	let postingCount = 0;
	for (const [term, paths] of postings.entries()) {
		termCount += 1;
		accountStringBytes(accumulator, term);
		for (const path of paths) {
			postingCount += 1;
			accountStringBytes(accumulator, path);
		}
	}
	const mapEntryBytes = termCount * INDEX_MAP_ENTRY_BYTES;
	const referenceBytes =
		termCount * INDEX_REFERENCE_BYTES + postingCount * INDEX_REFERENCE_BYTES;
	return {
		total: INDEX_COLLECTION_HEADER_BYTES + mapEntryBytes + referenceBytes,
		termCount,
		postingCount,
		mapEntryBytes,
		referenceBytes,
	};
}

function estimateNumericPostingMapBytes(
	postings: ReadonlyMap<string, readonly number[]>,
	accumulator: IndexSizeAccumulator,
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
		accountStringBytes(accumulator, term);
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
		bodyText: { count: 0, referenceBytes: 0 },
		bodyTokenSequence: { count: 0, referenceBytes: 0 },
		bodyTerms: { count: 0, referenceBytes: 0 },
		bodyCharTerms: { count: 0, referenceBytes: 0 },
		bodyPhraseTerms: { count: 0, referenceBytes: 0 },
		aliasTerms: { count: 0, referenceBytes: 0 },
		aliasCharTerms: { count: 0, referenceBytes: 0 },
		aliasPhraseTerms: { count: 0, referenceBytes: 0 },
		basenameTerms: { count: 0, referenceBytes: 0 },
		basenameCharTerms: { count: 0, referenceBytes: 0 },
		basenamePhraseTerms: { count: 0, referenceBytes: 0 },
		folderTerms: { count: 0, referenceBytes: 0 },
		folderCharTerms: { count: 0, referenceBytes: 0 },
		folderPhraseTerms: { count: 0, referenceBytes: 0 },
		headingTerms: { count: 0, referenceBytes: 0 },
		headingCharTerms: { count: 0, referenceBytes: 0 },
		headingPhraseTerms: { count: 0, referenceBytes: 0 },
		metadataTerms: { count: 0, referenceBytes: 0 },
		tagTerms: { count: 0, referenceBytes: 0 },
		tagCharTerms: { count: 0, referenceBytes: 0 },
		tagPhraseTerms: { count: 0, referenceBytes: 0 },
		tagValues: { count: 0, referenceBytes: 0 },
	};
	for (const [path, document] of documents.entries()) {
		sections.docIds.count += 1;
		sections.docIds.referenceBytes += INDEX_NUMBER_BYTES;

		accountStringBytes(accumulator, path);
		sections.paths.count += 1;
		sections.paths.referenceBytes += INDEX_REFERENCE_BYTES;

		accountStringBytes(accumulator, document.bodyText);
		sections.bodyText.count += 1;
		sections.bodyText.referenceBytes += INDEX_REFERENCE_BYTES;

		accumulateSection(
			sections.bodyTokenSequence,
			estimateStringArrayBytes(document.bodyTokenSequence, accumulator),
		);
		accumulateSection(
			sections.bodyTerms,
			estimateStringSetBytes(document.bodyTerms, accumulator),
		);
		accumulateSection(
			sections.bodyCharTerms,
			estimateStringSetBytes(document.bodyCharTerms, accumulator),
		);
		accumulateSection(
			sections.bodyPhraseTerms,
			estimateStringSetBytes(document.bodyPhraseTerms, accumulator),
		);
		accumulateSection(
			sections.aliasTerms,
			estimateStringSetBytes(document.aliasTerms, accumulator),
		);
		accumulateSection(
			sections.aliasCharTerms,
			estimateStringSetBytes(document.aliasCharTerms, accumulator),
		);
		accumulateSection(
			sections.aliasPhraseTerms,
			estimateStringSetBytes(document.aliasPhraseTerms, accumulator),
		);
		accumulateSection(
			sections.basenameTerms,
			estimateStringSetBytes(document.basenameTerms, accumulator),
		);
		accumulateSection(
			sections.basenameCharTerms,
			estimateStringSetBytes(document.basenameCharTerms, accumulator),
		);
		accumulateSection(
			sections.basenamePhraseTerms,
			estimateStringSetBytes(document.basenamePhraseTerms, accumulator),
		);
		accumulateSection(
			sections.folderTerms,
			estimateStringSetBytes(document.folderTerms, accumulator),
		);
		accumulateSection(
			sections.folderCharTerms,
			estimateStringSetBytes(document.folderCharTerms, accumulator),
		);
		accumulateSection(
			sections.folderPhraseTerms,
			estimateStringSetBytes(document.folderPhraseTerms, accumulator),
		);
		accumulateSection(
			sections.headingTerms,
			estimateStringSetBytes(document.headingTerms, accumulator),
		);
		accumulateSection(
			sections.headingCharTerms,
			estimateStringSetBytes(document.headingCharTerms, accumulator),
		);
		accumulateSection(
			sections.headingPhraseTerms,
			estimateStringSetBytes(document.headingPhraseTerms, accumulator),
		);
		accumulateSection(
			sections.metadataTerms,
			estimateStringSetBytes(document.metadataTerms, accumulator),
		);
		accumulateSection(
			sections.tagTerms,
			estimateStringSetBytes(document.tagTerms, accumulator),
		);
		accumulateSection(
			sections.tagCharTerms,
			estimateStringSetBytes(document.tagCharTerms, accumulator),
		);
		accumulateSection(
			sections.tagPhraseTerms,
			estimateStringSetBytes(document.tagPhraseTerms, accumulator),
		);
		accumulateSection(
			sections.tagValues,
			estimateStringArrayBytes(document.tagValues, accumulator),
		);
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

function estimateDocumentIdentityBytes(
	documentIdByPath: ReadonlyMap<string, number>,
	documentPathById: readonly (string | undefined)[],
	documentById: readonly (CoverageLexicalDocument | undefined)[],
	documentBodyTokensById: readonly (readonly string[] | undefined)[],
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
		accountStringBytes(accumulator, path);
		pathToId.mapEntryBytes += INDEX_MAP_ENTRY_BYTES;
		pathToId.pathReferenceBytes += INDEX_REFERENCE_BYTES;
		pathToId.numberBytes += INDEX_NUMBER_BYTES;
	}

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
		accountStringBytes(accumulator, path);
	}

	const docStoreById = {
		slotCount: documentById.length,
		populatedCount: documentById.filter(Boolean).length,
		referenceBytes: documentById.length * INDEX_REFERENCE_BYTES,
	};
	const bodyTokensById = {
		slotCount: documentBodyTokensById.length,
		populatedCount: documentBodyTokensById.filter(Boolean).length,
		referenceBytes: documentBodyTokensById.length * INDEX_REFERENCE_BYTES,
	};
	const tagValuesById = {
		slotCount: documentTagValuesById.length,
		populatedCount: documentTagValuesById.filter(Boolean).length,
		referenceBytes: documentTagValuesById.length * INDEX_REFERENCE_BYTES,
	};

	const counter = {
		count: 1,
		value: nextDocumentId,
		numberBytes: INDEX_NUMBER_BYTES,
	};

	return {
		total:
			INDEX_COLLECTION_HEADER_BYTES * 2 +
			pathToId.mapEntryBytes +
			pathToId.pathReferenceBytes +
			pathToId.numberBytes +
			idToPath.referenceBytes +
			docStoreById.referenceBytes +
			bodyTokensById.referenceBytes +
			tagValuesById.referenceBytes +
			counter.numberBytes,
		pathToId,
		idToPath,
		docStoreById,
		bodyTokensById,
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

function toNamedByteBreakdown<T extends Record<string, { total: number }>>(
	breakdowns: T,
): T {
	return breakdowns;
}

function getPostingEntryCount(
	postings: ReadonlySet<string> | readonly number[] | undefined,
): number {
	if (!postings) {
		return 0;
	}
	return Array.isArray(postings)
		? postings.length
		: (postings as ReadonlySet<string>).size;
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
