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
import { collectCoverageLexicalCandidateStates } from "./coverage-lexical-recall";
import { buildCoverageLexicalPairSignatures } from "./coverage-lexical-signatures";
import {
	compareCoverageLexicalResultSignals,
	rankCoverageLexicalResults,
	type CoverageLexicalRankableResult,
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
const DEFAULT_LOCAL_WINDOW_RERANK_BUDGET = 24;

@singleton()
export class CoverageLexicalFileSearchEngine implements FileSearchEngine {
	readonly backend = "coverage-lexical" as const;
	readonly supportsSerialization = false;

	private readonly tokenizer = getInstance(Tokenizer);
	private readonly documents = new Map<string, CoverageLexicalDocument>();
	private readonly documentBodyTokensByPath = new Map<string, readonly string[]>();
	private readonly documentTagValuesByPath = new Map<string, readonly string[]>();
	private readonly bodyPostings = new Map<string, Set<string>>();
	private readonly bodyCharPostings = new Map<string, Set<string>>();
	private readonly bodyHanSegmentPostings = new Map<string, Set<string>>();
	private readonly bodyPhrasePostings = new Map<string, Set<string>>();
	private readonly metadataAliasCharPostings = new Map<string, Set<string>>();
	private readonly metadataAliasHanSegmentPostings = new Map<string, Set<string>>();
	private readonly metadataAliasPhrasePostings = new Map<string, Set<string>>();
	private readonly metadataAliasPostings = new Map<string, Set<string>>();
	private readonly metadataBasenameCharPostings = new Map<string, Set<string>>();
	private readonly metadataBasenameHanSegmentPostings = new Map<string, Set<string>>();
	private readonly metadataBasenamePhrasePostings = new Map<string, Set<string>>();
	private readonly metadataBasenamePostings = new Map<string, Set<string>>();
	private readonly metadataFolderCharPostings = new Map<string, Set<string>>();
	private readonly metadataFolderHanSegmentPostings = new Map<string, Set<string>>();
	private readonly metadataFolderPhrasePostings = new Map<string, Set<string>>();
	private readonly metadataFolderPostings = new Map<string, Set<string>>();
	private readonly metadataHeadingCharPostings = new Map<string, Set<string>>();
	private readonly metadataHeadingHanSegmentPostings = new Map<string, Set<string>>();
	private readonly metadataHeadingPhrasePostings = new Map<string, Set<string>>();
	private readonly metadataHeadingPostings = new Map<string, Set<string>>();
	private readonly metadataPostings = new Map<string, Set<string>>();
	private readonly metadataTagCharPostings = new Map<string, Set<string>>();
	private readonly metadataTagFullPostings = new Map<string, Set<string>>();
	private readonly metadataTagPhrasePostings = new Map<string, Set<string>>();
	private readonly metadataTagPostings = new Map<string, Set<string>>();
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
		this.documentBodyTokensByPath.clear();
		this.documentTagValuesByPath.clear();
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
		const candidates = collectCoverageLexicalCandidateStates(
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
				documentBodyTokensByPath: this.documentBodyTokensByPath,
				documentTagValuesByPath: this.documentTagValuesByPath,
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
			.map(([path, state]) =>
				this.createRankableResult(
					path,
					queryTerms,
					plan,
					state,
					false,
					phraseSignatures,
					pairSignatures,
					charQuery,
				),
			)
			.filter((result): result is CoverageLexicalRankableResult => result !== null);
		const coarseResultByPath = new Map(
			coarseResults.map((result) => [result.path, result] as const),
		);
		const admissionSignals = new Map(
			coarseResults.map((result) => {
				const document = this.documents.get(result.path);
				return [
					result.path,
					buildCoverageLexicalPassageAdmissionSignal(
						document?.bodyTokenSequence ?? [],
						plan.families,
						candidates.get(result.path) ?? {
							bodyMatches: new Map(),
							bodyCharTerms: new Set(),
							metadataMatches: new Map(),
							metadataCharTerms: new Set(),
							metadataFieldMatches: {
								basename: new Map(),
								aliases: new Map(),
								folder: new Map(),
								headings: new Map(),
								tags: new Map(),
							},
							phraseMatches: new Set(),
							tagCharTerms: new Set(),
							tagExactTerms: new Set(),
						},
						phraseSignatures,
					),
				] as const;
			}),
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
				admissionSignals.get(left.path)!,
				admissionSignals.get(right.path)!,
			);
			if (admissionDecision !== 0) {
				return admissionDecision;
			}
			return (
				(right.score ?? 0) - (left.score ?? 0) ||
				left.path.localeCompare(right.path)
			);
		});
		const localWindowPaths = computeLocalWindowRerankPaths(
			coarseRanked,
			admissionSignals,
			plan,
			request.maxItemResults,
		);
		const rerankedResults: CoverageLexicalRankableResult[] = [];
		for (const [path, state] of candidates.entries()) {
			if (!localWindowPaths.has(path)) {
				const coarseResult = coarseResultByPath.get(path);
				if (coarseResult) {
					rerankedResults.push(coarseResult);
				}
				continue;
			}
			const rerankedResult = this.createRankableResult(
				path,
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
		const ranked = rankCoverageLexicalResults(rerankedResults, plan);
		const finalResults = ranked.slice(0, request.maxItemResults);
		return finalResults.map(
			({ coverageLexicalSignal: _coverageLexicalSignal, ...result }) => ({
				...result,
				nativeSubItemsReady: false,
				directSubItems: [],
			}),
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
		const postings = {
			body: estimatePostingMapBytes(this.bodyPostings, accumulator),
			bodyChar: estimatePostingMapBytes(this.bodyCharPostings, accumulator),
			bodyHanSegments: estimatePostingMapBytes(
				this.bodyHanSegmentPostings,
				accumulator,
			),
			bodyPhrase: estimatePostingMapBytes(this.bodyPhrasePostings, accumulator),
			metadataAlias: estimatePostingMapBytes(
				this.metadataAliasPostings,
				accumulator,
			),
			metadataAliasChar: estimatePostingMapBytes(
				this.metadataAliasCharPostings,
				accumulator,
			),
			metadataAliasHanSegments: estimatePostingMapBytes(
				this.metadataAliasHanSegmentPostings,
				accumulator,
			),
			metadataAliasPhrase: estimatePostingMapBytes(
				this.metadataAliasPhrasePostings,
				accumulator,
			),
			metadataBasename: estimatePostingMapBytes(
				this.metadataBasenamePostings,
				accumulator,
			),
			metadataBasenameChar: estimatePostingMapBytes(
				this.metadataBasenameCharPostings,
				accumulator,
			),
			metadataBasenameHanSegments: estimatePostingMapBytes(
				this.metadataBasenameHanSegmentPostings,
				accumulator,
			),
			metadataBasenamePhrase: estimatePostingMapBytes(
				this.metadataBasenamePhrasePostings,
				accumulator,
			),
			metadataFolder: estimatePostingMapBytes(
				this.metadataFolderPostings,
				accumulator,
			),
			metadataFolderChar: estimatePostingMapBytes(
				this.metadataFolderCharPostings,
				accumulator,
			),
			metadataFolderHanSegments: estimatePostingMapBytes(
				this.metadataFolderHanSegmentPostings,
				accumulator,
			),
			metadataFolderPhrase: estimatePostingMapBytes(
				this.metadataFolderPhrasePostings,
				accumulator,
			),
			metadataHeading: estimatePostingMapBytes(
				this.metadataHeadingPostings,
				accumulator,
			),
			metadataHeadingChar: estimatePostingMapBytes(
				this.metadataHeadingCharPostings,
				accumulator,
			),
			metadataHeadingHanSegments: estimatePostingMapBytes(
				this.metadataHeadingHanSegmentPostings,
				accumulator,
			),
			metadataHeadingPhrase: estimatePostingMapBytes(
				this.metadataHeadingPhrasePostings,
				accumulator,
			),
			metadata: estimatePostingMapBytes(this.metadataPostings, accumulator),
			metadataTag: estimatePostingMapBytes(
				this.metadataTagPostings,
				accumulator,
			),
			metadataTagChar: estimatePostingMapBytes(
				this.metadataTagCharPostings,
				accumulator,
			),
			metadataTagFull: estimatePostingMapBytes(
				this.metadataTagFullPostings,
				accumulator,
			),
			metadataTagPhrase: estimatePostingMapBytes(
				this.metadataTagPhrasePostings,
				accumulator,
			),
		};
		const lexicon = estimateStringArrayBytes(this.sortedLexicon, accumulator);
		const total =
			accumulator.stringPoolBytes +
			documents.total +
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
				postings: toNamedByteBreakdown(postings),
				lexicon,
			},
		};
	}

	private indexDocument(document: IndexedDocument): void {
		this.removeDocument(document.path);

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

		this.documents.set(document.path, {
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
		});
		this.documentBodyTokensByPath.set(document.path, bodyTokenSequence);
		this.documentTagValuesByPath.set(document.path, tagValues);

		for (const term of bodyTerms) {
			addPosting(this.bodyPostings, term, document.path);
			this.lexicon.add(term);
		}
		for (const term of bodyCharTerms) {
			addPosting(this.bodyCharPostings, term, document.path);
		}
		for (const term of bodyPhraseTerms) {
			addPosting(this.bodyPhrasePostings, term, document.path);
		}
		for (const term of aliasTerms) {
			addPosting(this.metadataAliasPostings, term, document.path);
			this.lexicon.add(term);
		}
		for (const term of aliasCharTerms) {
			addPosting(this.metadataAliasCharPostings, term, document.path);
		}
		for (const term of aliasPhraseTerms) {
			addPosting(this.metadataAliasPhrasePostings, term, document.path);
		}
		for (const term of basenameTerms) {
			addPosting(this.metadataBasenamePostings, term, document.path);
			this.lexicon.add(term);
		}
		for (const term of basenameCharTerms) {
			addPosting(this.metadataBasenameCharPostings, term, document.path);
		}
		for (const term of basenamePhraseTerms) {
			addPosting(this.metadataBasenamePhrasePostings, term, document.path);
		}
		for (const term of folderTerms) {
			addPosting(this.metadataFolderPostings, term, document.path);
			this.lexicon.add(term);
		}
		for (const term of folderCharTerms) {
			addPosting(this.metadataFolderCharPostings, term, document.path);
		}
		for (const term of folderPhraseTerms) {
			addPosting(this.metadataFolderPhrasePostings, term, document.path);
		}
		for (const term of headingTerms) {
			addPosting(this.metadataHeadingPostings, term, document.path);
			this.lexicon.add(term);
		}
		for (const term of headingCharTerms) {
			addPosting(this.metadataHeadingCharPostings, term, document.path);
		}
		for (const term of headingPhraseTerms) {
			addPosting(this.metadataHeadingPhrasePostings, term, document.path);
		}
		for (const term of metadataTerms) {
			addPosting(this.metadataPostings, term, document.path);
			this.lexicon.add(term);
		}
		for (const term of tagTerms) {
			addPosting(this.metadataTagPostings, term, document.path);
			this.lexicon.add(term);
		}
		for (const term of tagValues) {
			addPosting(this.metadataTagFullPostings, term, document.path);
		}
		for (const term of tagCharTerms) {
			addPosting(this.metadataTagCharPostings, term, document.path);
		}
		for (const term of tagPhraseTerms) {
			addPosting(this.metadataTagPhrasePostings, term, document.path);
		}
		this.sortedLexicon = Array.from(this.lexicon).sort();
	}

	private removeDocument(path: string): void {
		const existing = this.documents.get(path);
		if (!existing) {
			return;
		}

		for (const term of existing.bodyTerms) {
			removePosting(this.bodyPostings, term, path);
		}
		for (const term of existing.bodyCharTerms) {
			removePosting(this.bodyCharPostings, term, path);
		}
		for (const term of existing.bodyPhraseTerms) {
			removePosting(this.bodyPhrasePostings, term, path);
		}
		for (const term of existing.aliasTerms) {
			removePosting(this.metadataAliasPostings, term, path);
		}
		for (const term of existing.aliasCharTerms) {
			removePosting(this.metadataAliasCharPostings, term, path);
		}
		for (const term of existing.aliasPhraseTerms) {
			removePosting(this.metadataAliasPhrasePostings, term, path);
		}
		for (const term of existing.basenameTerms) {
			removePosting(this.metadataBasenamePostings, term, path);
		}
		for (const term of existing.basenameCharTerms) {
			removePosting(this.metadataBasenameCharPostings, term, path);
		}
		for (const term of existing.basenamePhraseTerms) {
			removePosting(this.metadataBasenamePhrasePostings, term, path);
		}
		for (const term of existing.folderTerms) {
			removePosting(this.metadataFolderPostings, term, path);
		}
		for (const term of existing.folderCharTerms) {
			removePosting(this.metadataFolderCharPostings, term, path);
		}
		for (const term of existing.folderPhraseTerms) {
			removePosting(this.metadataFolderPhrasePostings, term, path);
		}
		for (const term of existing.headingTerms) {
			removePosting(this.metadataHeadingPostings, term, path);
		}
		for (const term of existing.headingCharTerms) {
			removePosting(this.metadataHeadingCharPostings, term, path);
		}
		for (const term of existing.headingPhraseTerms) {
			removePosting(this.metadataHeadingPhrasePostings, term, path);
		}
		for (const term of existing.metadataTerms) {
			removePosting(this.metadataPostings, term, path);
		}
		for (const term of existing.tagTerms) {
			removePosting(this.metadataTagPostings, term, path);
		}
		for (const term of existing.tagValues) {
			removePosting(this.metadataTagFullPostings, term, path);
		}
		for (const term of existing.tagCharTerms) {
			removePosting(this.metadataTagCharPostings, term, path);
		}
		for (const term of existing.tagPhraseTerms) {
			removePosting(this.metadataTagPhrasePostings, term, path);
		}
		this.documents.delete(path);
		this.documentBodyTokensByPath.delete(path);
		this.documentTagValuesByPath.delete(path);
		this.rebuildLexicon();
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
			bodyExactDocCount: this.bodyPostings.get(term)?.size ?? 0,
			metadataExactDocCount: this.metadataPostings.get(term)?.size ?? 0,
			basenameExactDocCount: this.metadataBasenamePostings.get(term)?.size ?? 0,
			folderExactDocCount: this.metadataFolderPostings.get(term)?.size ?? 0,
			headingExactDocCount: this.metadataHeadingPostings.get(term)?.size ?? 0,
			aliasExactDocCount: this.metadataAliasPostings.get(term)?.size ?? 0,
		}));
	}

	private createRankableResult(
		path: string,
		queryTerms: readonly string[],
		plan: CoverageLexicalPlan,
		state: CoverageLexicalCandidateState,
		includeLocalWindow: boolean,
		phraseSignatures: readonly CoverageLexicalPhraseSignature[],
		pairSignatures: readonly CoverageLexicalPairSignature[],
		charQuery: CoverageLexicalCharQuery,
	): CoverageLexicalRankableResult | null {
		const document = this.documents.get(path);
		if (!document) {
			return null;
		}
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
			path,
			queryTerms: [...queryTerms],
			matchedTerms: signal.matchedTerms,
			score: computeFallbackScore(signal),
			coverageLexicalSignal: signal,
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
		const bodyKind = state.bodyMatches.get(family.index) ?? null;
		const metadataKind = state.metadataMatches.get(family.index) ?? null;
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
		phraseBridgeCount: state.phraseMatches.size,
		phraseBridgeWeight: Array.from(state.phraseMatches).reduce(
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
	fullSegmentCount: number;
	bestSegmentCoverageCount: number;
	bestSegmentCoverageRatio: number;
} {
	return {
		matchCount: 0,
		matchRatio: 0,
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
	matches: ReadonlyMap<number, CoverageFamilyMatchKind>,
	familyIndex: number,
	baseWeight: number,
): void {
	const kind = matches.get(familyIndex) ?? null;
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
		const kind = matches.get(familyIndex) ?? null;
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
		if ((state.metadataFieldMatches[field].get(familyIndex) ?? null) !== null) {
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
	) as Array<[CoverageLexicalMetadataField, Map<number, CoverageFamilyMatchKind>]>) {
		if (matches.get(familyIndex) !== kind) {
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


function computeLocalWindowRerankPaths(
	coarseRanked: readonly CoverageLexicalRankableResult[],
	admissionSignals: ReadonlyMap<string, ReturnType<typeof buildCoverageLexicalPassageAdmissionSignal>>,
	plan: CoverageLexicalPlan,
	maxItemResults: number,
): Set<string> {
	if (coarseRanked.length <= maxItemResults) {
		return new Set(coarseRanked.map((result) => result.path));
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
			admissionSignals.get(left.path)!,
			admissionSignals.get(right.path)!,
		);
		if (signalDecision !== 0 || admissionDecision !== 0) {
			break;
		}
		budget += 1;
	}
	return new Set(
		coarseRanked.slice(0, budget).map((result) => result.path),
	);
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

type IndexSizeAccumulator = {
	seenStrings: Set<string>;
	stringPoolBytes: number;
};

const INDEX_COLLECTION_HEADER_BYTES = 4;
const INDEX_REFERENCE_BYTES = 4;
const INDEX_MAP_ENTRY_BYTES = 8;
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

function estimateDocumentStoreBytes(
	documents: ReadonlyMap<string, CoverageLexicalDocument>,
	accumulator: IndexSizeAccumulator,
): Record<string, unknown> & { total: number } {
	const sections = {
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
