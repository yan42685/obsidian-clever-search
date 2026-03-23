import type { IndexedDocument, MatchedFile } from "src/globals/search-types";
import { innerSetting, OuterSetting } from "src/globals/plugin-setting";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import type {
	FileSearchEngine,
	FileSearchRequest,
	SerializedFileSearchIndex,
} from "../file-search-engine";
import {
	createFileSearchQueryPlanner,
	type FileSearchQueryPlanner,
	type FileSearchQueryKind,
	type FileSearchQueryTermStats,
} from "../file-search-query-planner";
import { Tokenizer } from "../tokenizer";

type MetadataField = "basename" | "aliases" | "folder" | "tags" | "headings";
type SearchField = MetadataField | "content";

type FieldStats = {
	docLengths: Map<number, number>;
	totalLength: number;
};

type MatchedQueryTerm = {
	term: string;
	boost: number;
	kind: "exact" | "prefix" | "fuzzy";
};

type QueryTermMatch = {
	matchedTerms: MatchedQueryTerm[];
};

type PassageRecord = {
	id: number;
	fileId: number;
	filePath: string;
	text: string;
	length: number;
	tokenSequence: string[];
	wordTf: Map<string, number>;
	charTf: Map<string, number>;
};

type PassageCandidateState = {
	score: number;
	matchedTerms: Set<string>;
	matchedQueryTerms: Set<number>;
	matchedTermsByQueryTerm: Map<number, Set<string>>;
	exactMatchedQueryTerms: Set<number>;
	charHits: number;
};

type QueryExecution = {
	queryTermIndex: number;
	queryTerm: string;
	match: QueryTermMatch;
	estimatedVisitCost: number;
};

type FilePassageEvidence = {
	passageId: number;
	score: number;
	matchedQueryTerms: Set<number>;
	exactMatchedQueryTerms: Set<number>;
	matchedTermsByQueryTerm: Map<number, Set<string>>;
};

type FileCandidateState = {
	fileId: number;
	filePath: string;
	metadataScore: number;
	metadataLaneScore: number;
	metadataLaneTier: number;
	bestPassageScore: number;
	secondPassageScore: number;
	topPassageEvidences: FilePassageEvidence[];
	score: number;
	charHits: number;
	matchedTerms: Set<string>;
	matchedQueryTerms: Set<number>;
	matchedMetadataQueryTerms: Set<number>;
	matchedExpandedMetadataQueryTerms: Set<number>;
	matchedQueryTermsByField: Map<SearchField, Set<number>>;
	matchedExpandedQueryTermsByField: Map<SearchField, Set<number>>;
};

type FilePassageSetSignals = {
	score: number;
	bestCoverageRatio: number;
	unionCoverageRatio: number;
	corroboratedCoverageRatio: number;
	exactUnionCoverageRatio: number;
	decisivePassageRatio: number;
	anchorAgreementRatio: number;
	fragmentationRatio: number;
	bestWindowCoverageRatio: number;
	bestWindowAnchorRatio: number;
	bestWindowCompactnessRatio: number;
	localExplanationCompetitionScore: number;
	localExplanationUnionCoverageRatio: number;
	localExplanationCorroboratedCoverageRatio: number;
	localExplanationAnchorRatio: number;
	localExplanationCompactnessRatio: number;
};

type LocalWindowSignals = {
	score: number;
	coverageRatio: number;
	exactCoverageRatio: number;
	anchorCoverageRatio: number;
	compactnessRatio: number;
};

type LocalWindowExplanation = LocalWindowSignals & {
	startPosition: number;
	endPosition: number;
	matchedQueryTerms: Set<number>;
};

type QueryConditionedLocalWindowSet = {
	bestSignals: LocalWindowSignals;
	explanations: LocalWindowExplanation[];
	competitionScore: number;
	unionCoverageRatio: number;
	corroboratedCoverageRatio: number;
	anchorCoverageRatio: number;
	compactnessRatio: number;
};

type FileLocalExplanationCandidate = LocalWindowExplanation & {
	passageId: number;
	weightedScore: number;
};

type QueryScoringCache = {
	positionsByPassageId: Map<number, Map<number, number[]>>;
	localWindowSetsByPassageId: Map<number, QueryConditionedLocalWindowSet>;
};

type PassageUnit = {
	text: string;
	tokens: string[];
	charTerms: string[];
};

type QueryTermWeightMap = Map<number, number>;

type QueryTermDecomposition = {
	queryKind: FileSearchQueryKind | null;
	activeTermIndexes: ReadonlySet<number>;
	anchorTermIndexes: ReadonlySet<number>;
	bodyTermIndexes: ReadonlySet<number>;
	noiseTermIndexes: ReadonlySet<number>;
};

type QueryDecompositionSignals = {
	bodyEvidenceCoverageRatio: number;
	anchorSatisfiedRatio: number;
	metadataOnlyNoiseRatio: number;
	bodyAnchorSynergyRatio: number;
};

type MetadataLaneField =
	| "basename"
	| "aliases"
	| "headings"
	| "folder_basename"
	| "folder_aliases";

type MetadataLaneMatch = {
	tier: number;
	score: number;
	matchedTerms: string[];
	matchedQueryTermIndexes: Set<number>;
	expandedQueryTermIndexes: Set<number>;
	constituentFields: MetadataField[];
};

type ExperimentalQueryRoute =
	| "metadata_exact"
	| "path_anchor"
	| "mixed_anchor"
	| "body_local";

type RankedMatchedFile = MatchedFile & {
	queryRouteScore: number;
	metadataLaneScore: number;
	metadataLaneTier: number;
	shortAnchorLaneScore: number;
	shortAnchorLaneTier: number;
	scriptFitScore: number;
	pathLocaleFitScore: number;
	bestPassageScore: number;
	localExplanationCompetitionScore: number;
	basenameAliasCoverageRatio: number;
	basenameAliasAnchorRatio: number;
	headingCoverageRatio: number;
	headingAnchorRatio: number;
	pathCoverageRatio: number;
	pathAnchorRatio: number;
};

type ScriptProfile = {
	hasLatin: boolean;
	hasHan: boolean;
};

type QueryLocalePreference = {
	locale: "en" | "zh" | null;
	explicit: boolean;
};

const METADATA_FIELDS: MetadataField[] = [
	"basename",
	"aliases",
	"folder",
	"tags",
	"headings",
];
const SEARCH_FIELDS: SearchField[] = [...METADATA_FIELDS, "content"];
// Experimental backend uses an internal weighting scheme so retrieval quality
// is not tightly coupled to legacy file-level BM25 tuning knobs.
const METADATA_FIELD_WEIGHTS: Record<MetadataField, number> = {
	basename: 2.4,
	aliases: 2.1,
	folder: 1.35,
	tags: 0.95,
	headings: 1.5,
};
const WORD_BM25_K1 = 1.35;
const WORD_BM25_B = 0.72;
const WORD_PREFIX_EXPANSION_LIMIT = 96;
const WORD_FUZZY_EXPANSION_LIMIT = 64;
const WORD_MAX_FUZZY_EDITS = 2;
const WORD_EXPANSION_DOC_VISIT_BUDGET = 2200;
const PASSAGE_TARGET_TOKENS = 120;
const PASSAGE_MIN_TOKENS = 48;
const PASSAGE_OVERLAP_TOKENS = 48;
const MAX_PASSAGE_FRONTIER = 192;
const PASSAGE_PRUNE_TRIGGER = 640;
const PASSAGE_PRUNE_KEEP = 256;
const PASSAGE_EARLY_PRUNE_TRIGGER = 448;
const PASSAGE_EARLY_PRUNE_KEEP = 224;
const PASSAGE_EARLY_PRUNE_TAIL_KEEP = 256;
const MAX_LOCALITY_FRONTIER = 96;
const MAX_VERIFIER_FRONTIER = 48;
const CHAR_CHANNEL_WEIGHT = 0.38;
const CHAR_QUERY_BIGRAM_LIMIT = 16;
const CHAR_CHANNEL_EXISTING_STATE_THRESHOLD = 224;
const MAX_FILE_PASSAGE_EVIDENCES = 4;
const FILE_SECOND_PASSAGE_DECAY = 0.34;
const FILE_PASSAGE_SET_BEST_COVERAGE_BONUS = 1.12;
const FILE_PASSAGE_SET_UNION_COVERAGE_BONUS = 0.42;
const FILE_PASSAGE_SET_CORROBORATED_COVERAGE_BONUS = 0.86;
const FILE_PASSAGE_SET_EXACT_COVERAGE_BONUS = 0.34;
const FILE_PASSAGE_SET_DECISIVE_BONUS = 0.88;
const FILE_PASSAGE_SET_SUPPORT_BONUS = 0.72;
const FILE_PASSAGE_SET_ANCHOR_AGREEMENT_BONUS = 0.68;
const FILE_PASSAGE_SET_FRAGMENTATION_PENALTY = 1.05;
const FILE_PASSAGE_SET_DIFFUSE_SUPPORT_PENALTY = 0.62;
const FILE_METADATA_PRIOR = 0.28;
const FILE_COVERAGE_BONUS = 1.15;
const FILE_CHAR_HIT_BONUS = 0.06;
const FILE_METADATA_ANCHOR_BLEND = 0.82;
const FILE_PATHLIKE_METADATA_ANCHOR_BLEND = 1.28;
const FILE_MIXED_QUERY_BODY_METADATA_BONUS = 0.74;
const FILE_BASENAME_ALIAS_ANCHOR_BLEND = 1.34;
const FILE_BASENAME_ALIAS_ONLY_ANCHOR_BONUS = 1.02;
const FILE_BASENAME_ALIAS_BODY_MIX_BONUS = 0.94;
const FILE_TITLE_HEADING_ANCHOR_BLEND = 1.05;
const FILE_TITLE_ONLY_ANCHOR_BONUS = 0.88;
const FILE_BODY_TITLE_MIX_BONUS = 0.72;
const FILE_PATH_ONLY_ANCHOR_BONUS = 0.66;
const FILE_BODY_PATH_MIX_BONUS = 0.52;
const FILE_METADATA_DOMINANT_QUERY_BONUS = 0.7;
const FILE_PATHLIKE_METADATA_QUERY_BONUS = 1.05;
const FILE_DECOMPOSITION_BODY_EVIDENCE_BONUS = 0.96;
const FILE_DECOMPOSITION_BODY_ANCHOR_BONUS = 0.88;
const FILE_DECOMPOSITION_METADATA_NOISE_PENALTY = 0.92;
const FILE_SHORT_TITLE_FAST_PATH_EXACT = 7.4;
const FILE_SHORT_TITLE_FAST_PATH_PREFIX = 5.2;
const FILE_SHORT_HEADING_FAST_PATH_EXACT = 3.1;
const FILE_SHORT_HEADING_FAST_PATH_PREFIX = 2.05;
const FILE_SHORT_TITLE_FAST_PATH_COVERAGE = 1.35;
const FILE_SHORT_TITLE_FAST_PATH_COMPACTNESS = 2.6;
const FILE_SHORT_HEADING_FAST_PATH_COMPACTNESS = 1.1;
const FILE_SHORT_TITLE_ALL_TERMS_EXACT_BONUS = 4.4;
const FILE_SHORT_TITLE_ALL_TERMS_PREFIX_BONUS = 2.25;
const FILE_SHORT_TITLE_STRONG_MATCH_FLOOR = 5.2;
const FILE_SHORT_TITLE_CONTENT_CONFIRM_BONUS = 0.42;
const FILE_SHORT_TITLE_ROUTE_THRESHOLD = 8.5;
const PASSAGE_LOCALITY_COVERAGE_WEIGHT = 0.52;
const PASSAGE_LOCALITY_ORDER_WEIGHT = 0.4;
const PASSAGE_LOCALITY_COMPACTNESS_WEIGHT = 0.66;
const PASSAGE_LOCALITY_RARE_TERM_WEIGHT = 0.24;
const PASSAGE_LOCALITY_ANCHOR_WEIGHT = 0.22;
const PASSAGE_LOCALITY_TIGHT_PAIR_WEIGHT = 0.24;
const PASSAGE_LOCALITY_EXACT_QUERY_WEIGHT = 0.18;
const PASSAGE_LOCALITY_TIGHT_WINDOW_BONUS = 0.24;
const VERIFIER_COVERAGE_WEIGHT = 0.92;
const VERIFIER_ORDER_WEIGHT = 0.78;
const VERIFIER_COMPACTNESS_WEIGHT = 1.1;
const VERIFIER_RARE_TERM_WEIGHT = 0.48;
const VERIFIER_TIGHT_PAIR_WEIGHT = 0.42;
const VERIFIER_EXACT_QUERY_WEIGHT = 0.26;
const VERIFIER_EXACT_PHRASE_BONUS = 2.1;
const VERIFIER_METADATA_ANCHOR_BONUS = 0.8;
const VERIFIER_PASSAGE_ANCHOR_BONUS = 0.72;
const VERIFIER_BASENAME_ALIAS_ALIGNMENT_BONUS = 0.44;
const VERIFIER_HEADING_ALIGNMENT_BONUS = 0.12;
const VERIFIER_TIGHT_WINDOW_BONUS = 0.55;
const VERIFIER_LOCAL_WINDOW_WEIGHT = 0.78;
const PASSAGE_LOCALITY_LOCAL_WINDOW_WEIGHT = 0.42;
const LOCAL_WINDOW_MAX_SPAN_LIMIT = 32;
const LOCAL_WINDOW_BASE_SPAN = 8;
const LOCAL_WINDOW_SPAN_PER_TERM = 5;
const LOCAL_WINDOW_COVERAGE_WEIGHT = 1.24;
const LOCAL_WINDOW_EXACT_WEIGHT = 0.22;
const LOCAL_WINDOW_ANCHOR_WEIGHT = 0.54;
const LOCAL_WINDOW_COMPACTNESS_WEIGHT = 0.96;
const LOCAL_WINDOW_ORDER_WEIGHT = 0.34;
const LOCAL_WINDOW_TIGHT_PAIR_WEIGHT = 0.22;
const LOCAL_WINDOW_RARE_TERM_WEIGHT = 0.16;
const MAX_LOCAL_WINDOW_EXPLANATIONS_PER_PASSAGE = 3;
const MAX_FILE_LOCAL_EXPLANATIONS = 3;
const LOCAL_WINDOW_DUPLICATE_SPAN_OVERLAP_THRESHOLD = 0.72;
const LOCAL_WINDOW_DUPLICATE_TERM_OVERLAP_THRESHOLD = 0.85;
const MIN_LONG_CHUNK_CHARS = 220;
const HAN_SEQUENCE_REGEX = /\p{Script=Han}+/gu;
const EMPTY_LOCAL_WINDOW_SIGNALS: LocalWindowSignals = {
	score: 0,
	coverageRatio: 0,
	exactCoverageRatio: 0,
	anchorCoverageRatio: 0,
	compactnessRatio: 0,
};
const EMPTY_LOCAL_WINDOW_SET: QueryConditionedLocalWindowSet = {
	bestSignals: EMPTY_LOCAL_WINDOW_SIGNALS,
	explanations: [],
	competitionScore: 0,
	unionCoverageRatio: 0,
	corroboratedCoverageRatio: 0,
	anchorCoverageRatio: 0,
	compactnessRatio: 0,
};

@singleton()
export class PassageFileSearchEngine implements FileSearchEngine {
	readonly backend = "passage-bm25" as const;
	readonly supportsSerialization = false;
	private readonly outerSetting = getInstance(OuterSetting);
	private readonly tokenizer = getInstance(Tokenizer);
	private readonly metadataTermPostings = new Map<
		string,
		Map<MetadataField, Map<number, number>>
	>();
	private readonly passageWordPostings = new Map<string, Map<number, number>>();
	private readonly charBigramPostings = new Map<string, Map<number, number>>();
	private readonly sortedWordTerms: string[] = [];
	private readonly sortedCharTerms: string[] = [];
	private readonly metadataFieldStats: Record<MetadataField, FieldStats> = {
		basename: { docLengths: new Map(), totalLength: 0 },
		aliases: { docLengths: new Map(), totalLength: 0 },
		folder: { docLengths: new Map(), totalLength: 0 },
		tags: { docLengths: new Map(), totalLength: 0 },
		headings: { docLengths: new Map(), totalLength: 0 },
	};
	private readonly fileIdByPath = new Map<string, number>();
	private readonly pathByFileId = new Map<number, string>();
	private readonly fileMetadataTokens = new Map<
		number,
		Record<MetadataField, string[]>
	>();
	private readonly fileScriptProfiles = new Map<number, ScriptProfile>();
	private readonly filePassageIds = new Map<number, number[]>();
	private readonly passageById = new Map<number, PassageRecord>();
	private readonly passageLengths = new Map<number, number>();
	private nextFileId = 1;
	private nextPassageId = 1;
	private totalPassageLength = 0;

	async reIndexAll(
		data: IndexedDocument[] | SerializedFileSearchIndex,
	): Promise<boolean> {
		this.clearIndex();
		if (!Array.isArray(data)) {
			return false;
		}
		await this.addDocuments(data);
		return true;
	}

	async addDocuments(documents: IndexedDocument[]): Promise<void> {
		for (const document of documents) {
			this.indexDocument(document);
		}
		logger.debug(`passage lexical indexed/updated ${documents.length} docs`);
	}

	clearIndex(): void {
		this.clear();
	}

	deleteDocuments(paths: string[]): void {
		for (const path of paths) {
			this.removeDocument(path);
		}
	}

	async searchFiles(request: FileSearchRequest): Promise<MatchedFile[]> {
		const queryTerms = this.tokenizer
			.tokenize(request.queryText, "search")
			.map((term) => this.normalizeTerm(term));
		const queryCharTerms = this.buildQueryCharTerms(request.queryText);
		const queryScriptProfile = this.buildScriptProfile(request.queryText);
		if (
			(queryTerms.length === 0 && queryCharTerms.length === 0) ||
			this.pathByFileId.size === 0
		) {
			return [];
		}

		const prefixTerm =
			request.isPrefixMatch &&
			queryTerms.length > 0 &&
			queryTerms[queryTerms.length - 1].length >=
				innerSetting.search.minTermLengthForPrefixSearch
				? queryTerms[queryTerms.length - 1]
				: null;

		const passageStates = new Map<number, PassageCandidateState>();
		const fileStates = new Map<number, FileCandidateState>();
		const termStats: FileSearchQueryTermStats[] = [];

		const queryExecutions = queryTerms
			.map((queryTerm, queryTermIndex) => {
				const match = this.resolveWordMatches(
					queryTerm,
					prefixTerm === queryTerm,
					request.isFuzzy,
				);
				return {
					queryTermIndex,
					queryTerm,
					match,
					estimatedVisitCost: this.estimateQueryExecutionVisitCost(match),
				} satisfies QueryExecution;
			})
			.sort((left, right) => {
				if (left.estimatedVisitCost !== right.estimatedVisitCost) {
					return left.estimatedVisitCost - right.estimatedVisitCost;
				}
				return left.queryTermIndex - right.queryTermIndex;
			});

		for (
			let executionIndex = 0;
			executionIndex < queryExecutions.length;
			executionIndex++
		) {
			const { queryTermIndex, queryTerm, match } = queryExecutions[executionIndex];
			const docsMatchedForTerm = new Set<number>();
			const metadataDocsMatchedForTerm = new Set<number>();

			for (const matchedTerm of match.matchedTerms) {
				const contentPostings = this.passageWordPostings.get(matchedTerm.term);
				if (contentPostings) {
					const idf = this.computePassageIdf(contentPostings.size);
					const avgdl = this.averagePassageLength();
					for (const [passageId, tf] of contentPostings) {
						const passage = this.passageById.get(passageId);
						if (!passage) {
							continue;
						}
						const passageState = this.ensurePassageState(
							passageStates,
							passageId,
						);
						passageState.score +=
							idf *
							this.computeTfNorm(tf, passage.length, avgdl) *
							matchedTerm.boost;
						passageState.matchedTerms.add(matchedTerm.term);
						passageState.matchedQueryTerms.add(queryTermIndex);
						this.ensurePassageQueryTermMatch(
							passageState,
							queryTermIndex,
						).add(matchedTerm.term);
						if (matchedTerm.kind === "exact") {
							passageState.exactMatchedQueryTerms.add(queryTermIndex);
						}
						docsMatchedForTerm.add(passage.fileId);
					}
				}

				const metadataFields = this.metadataTermPostings.get(matchedTerm.term);
				if (!metadataFields) {
					continue;
				}

				for (const field of METADATA_FIELDS) {
					const postings = metadataFields.get(field);
					if (!postings || postings.size === 0) {
						continue;
					}
					const idf = this.computeMetadataIdf(postings.size);
					const avgdl = this.averageMetadataFieldLength(field);
					for (const [fileId, tf] of postings) {
						const fileState = this.ensureFileState(fileStates, fileId);
						const fileLength =
							this.metadataFieldStats[field].docLengths.get(fileId) ?? 0;
						fileState.metadataScore +=
							METADATA_FIELD_WEIGHTS[field] *
							idf *
							this.computeTfNorm(tf, fileLength, avgdl) *
							matchedTerm.boost;
						fileState.matchedTerms.add(matchedTerm.term);
						fileState.matchedQueryTerms.add(queryTermIndex);
						fileState.matchedMetadataQueryTerms.add(queryTermIndex);
						if (matchedTerm.kind !== "exact") {
							fileState.matchedExpandedMetadataQueryTerms.add(
								queryTermIndex,
							);
							this.ensureExpandedFieldMatch(fileState, field).add(
								queryTermIndex,
							);
						}
						this.ensureFieldMatch(fileState, field).add(queryTermIndex);
						docsMatchedForTerm.add(fileId);
						metadataDocsMatchedForTerm.add(fileId);
					}
				}
			}

			termStats.push({
				index: queryTermIndex,
				queryTerm,
				matchedDocCount: docsMatchedForTerm.size,
				matchedMetadataDocCount: metadataDocsMatchedForTerm.size,
				hasAnyMatch: docsMatchedForTerm.size > 0,
				hasExactMatch: match.matchedTerms.some((term) => term.kind === "exact"),
			});

			if (
				this.shouldEarlyPrunePassageStates(
					queryExecutions.length,
					executionIndex + 1,
					passageStates.size,
				)
			) {
				this.prunePassageStates(
					passageStates,
					this.computeEarlyPruneKeepCount(
						queryExecutions.length,
						executionIndex + 1,
					),
				);
			}
		}
		termStats.sort((left, right) => left.index - right.index);

		if (queryCharTerms.length > 0) {
			this.scoreCharChannel(
				queryCharTerms,
				passageStates,
				passageStates.size === 0 ||
					queryTerms.length === 0 ||
					passageStates.size < CHAR_CHANNEL_EXISTING_STATE_THRESHOLD,
			);
			if (passageStates.size > PASSAGE_PRUNE_KEEP) {
				this.prunePassageStates(passageStates, PASSAGE_PRUNE_KEEP);
			}
		}

		if (passageStates.size === 0 && fileStates.size === 0) {
			return [];
		}

		const activeWordTerms = termStats.some((stat) => stat.hasAnyMatch);
		const planner =
			queryTerms.length > 0 && activeWordTerms
				? createFileSearchQueryPlanner({
						rawQueryText: request.queryText,
						queryTerms,
						termStats,
						docCount: this.pathByFileId.size,
					})
				: null;
		const queryRoute = this.determineExperimentalQueryRoute(planner);
		if (planner && queryTerms.length > 0) {
			this.applyMetadataExactPrefixLane(
				queryTerms,
				prefixTerm,
				planner,
				termStats,
				fileStates,
			);
		}
		const queryTermDecomposition = buildQueryTermDecomposition(
			termStats,
			planner,
		);
		const queryTermWeights = buildQueryTermWeightMap(
			termStats,
			this.pathByFileId.size,
			planner,
			queryTermDecomposition,
		);
		const totalQueryWeight = getTotalQueryWeight(queryTerms, queryTermWeights);
		const queryScoringCache = this.createQueryScoringCache();
		const topPassages = this.selectTopPassages(
			passageStates,
			queryTerms,
			request.queryText,
			fileStates,
			planner,
			queryTermWeights,
			totalQueryWeight,
			queryScoringCache,
		);

		for (const [passageId, passageState] of topPassages) {
			const passage = this.passageById.get(passageId);
			if (!passage) {
				continue;
			}
			const fileState = this.ensureFileState(fileStates, passage.fileId);
			this.insertFilePassageEvidence(fileState, passageId, passageState);
			fileState.charHits += passageState.charHits;
			for (const matchedTerm of passageState.matchedTerms) {
				fileState.matchedTerms.add(matchedTerm);
			}
			for (const queryTermIndex of passageState.matchedQueryTerms) {
				fileState.matchedQueryTerms.add(queryTermIndex);
				this.ensureFieldMatch(fileState, "content").add(queryTermIndex);
			}
		}

		if (planner) {
			return this.searchWithPlanner(
				request,
				queryTerms,
				planner,
				queryRoute,
				fileStates,
				queryTermWeights,
				queryTermDecomposition,
				totalQueryWeight,
				queryScriptProfile,
				queryScoringCache,
			);
		}

		return this.sortMatchedFiles(
			Array.from(fileStates.values()).map((state) =>
				this.createMatchedFile(
					state,
					queryTerms.length > 0 ? queryTerms : queryCharTerms,
					0,
					planner,
					queryRoute,
					queryTermWeights,
					queryTermDecomposition,
					totalQueryWeight,
					queryScriptProfile,
					queryScoringCache,
				),
			),
			planner,
			queryRoute,
			{
				queryTerms,
				queryScriptProfile,
			},
		).slice(0, request.maxItemResults);
	}

	serialize(): SerializedFileSearchIndex | null {
		return null;
	}

	estimateIndexBytes(): number {
		let total = 0;
		total += this.sortedWordTerms.reduce(
			(sum, term) => sum + Buffer.byteLength(term, "utf8"),
			0,
		);
		total += this.sortedCharTerms.reduce(
			(sum, term) => sum + Buffer.byteLength(term, "utf8"),
			0,
		);
		for (const passage of this.passageById.values()) {
			total += Buffer.byteLength(passage.filePath, "utf8");
			total += Buffer.byteLength(passage.text, "utf8");
			total += passage.length * 4;
			total += passage.wordTf.size * 16;
			total += passage.charTf.size * 12;
		}
		for (const field of METADATA_FIELDS) {
			total += this.metadataFieldStats[field].docLengths.size * 8;
		}
		for (const fieldMap of this.metadataTermPostings.values()) {
			for (const postings of fieldMap.values()) {
				total += postings.size * 12;
			}
		}
		for (const postings of this.passageWordPostings.values()) {
			total += postings.size * 12;
		}
		for (const postings of this.charBigramPostings.values()) {
			total += postings.size * 10;
		}
		return total;
	}

	private searchWithPlanner(
		request: FileSearchRequest,
		queryTerms: string[],
		planner: FileSearchQueryPlanner,
		queryRoute: ExperimentalQueryRoute,
		fileStates: Map<number, FileCandidateState>,
		queryTermWeights: QueryTermWeightMap,
		queryTermDecomposition: QueryTermDecomposition,
		totalQueryWeight: number,
		queryScriptProfile: ScriptProfile,
		queryScoringCache: QueryScoringCache,
	): MatchedFile[] {
		const strictResults: RankedMatchedFile[] = [];
		const relaxedResults: RankedMatchedFile[] = [];

		for (const state of fileStates.values()) {
			if (planner.matches(state, "strict")) {
				strictResults.push(
					this.createMatchedFile(
						state,
						queryTerms,
						planner.computeScoreBonus(state, "strict"),
						planner,
						queryRoute,
						queryTermWeights,
						queryTermDecomposition,
						totalQueryWeight,
						queryScriptProfile,
						queryScoringCache,
					),
				);
			}
			if (planner.matches(state, "relaxed")) {
				relaxedResults.push(
					this.createMatchedFile(
						state,
						queryTerms,
						planner.computeScoreBonus(state, "relaxed"),
						planner,
						queryRoute,
						queryTermWeights,
						queryTermDecomposition,
						totalQueryWeight,
						queryScriptProfile,
						queryScoringCache,
					),
				);
			}
		}

		const strictSorted = this.sortMatchedFiles(strictResults, planner, queryRoute, {
			queryTerms,
			queryScriptProfile,
		});
		if (
			!planner.shouldUseRelaxedResults(
				strictSorted.length,
				request.maxItemResults,
			)
		) {
			return strictSorted.slice(0, request.maxItemResults);
		}

		const relaxedSorted = this.sortMatchedFiles(
			relaxedResults,
			planner,
			queryRoute,
			{
				queryTerms,
				queryScriptProfile,
			},
		);
		if (relaxedSorted.length > 0) {
			return relaxedSorted.slice(0, request.maxItemResults);
		}

		return this.sortMatchedFiles(
			Array.from(fileStates.values()).map((state) =>
				this.createMatchedFile(
					state,
					queryTerms,
					0,
					planner,
					queryRoute,
					queryTermWeights,
					queryTermDecomposition,
					totalQueryWeight,
					queryScriptProfile,
					queryScoringCache,
				),
			),
			planner,
			queryRoute,
			{
				queryTerms,
				queryScriptProfile,
			},
		).slice(0, request.maxItemResults);
	}

	private clear() {
		this.metadataTermPostings.clear();
		this.passageWordPostings.clear();
		this.charBigramPostings.clear();
		this.sortedWordTerms.length = 0;
		this.sortedCharTerms.length = 0;
		this.fileIdByPath.clear();
		this.pathByFileId.clear();
		this.fileMetadataTokens.clear();
		this.fileScriptProfiles.clear();
		this.filePassageIds.clear();
		this.passageById.clear();
		this.passageLengths.clear();
		this.nextFileId = 1;
		this.nextPassageId = 1;
		this.totalPassageLength = 0;
		for (const field of METADATA_FIELDS) {
			this.metadataFieldStats[field].docLengths.clear();
			this.metadataFieldStats[field].totalLength = 0;
		}
	}

	private indexDocument(document: IndexedDocument) {
		const existingFileId = this.fileIdByPath.get(document.path);
		if (existingFileId !== undefined) {
			this.removeDocument(document.path);
		}

		const fileId = this.nextFileId++;
		this.fileIdByPath.set(document.path, fileId);
		this.pathByFileId.set(fileId, document.path);
		this.fileScriptProfiles.set(
			fileId,
			this.buildScriptProfile(
				[
					document.path,
					document.basename ?? "",
					document.aliases ?? "",
					document.headings ?? "",
					(document.content ?? "").slice(0, 512),
				].join("\n"),
			),
		);

		const metadataTokens = {
			basename: this.tokenizeMetadata(document.basename ?? ""),
			aliases: this.tokenizeMetadata(document.aliases ?? ""),
			folder: this.tokenizeMetadata(document.folder ?? ""),
			tags: this.tokenizeMetadata(document.tags ?? ""),
			headings: this.tokenizeMetadata(document.headings ?? ""),
		};
		this.fileMetadataTokens.set(fileId, metadataTokens);

		for (const field of METADATA_FIELDS) {
			const tokens = metadataTokens[field];
			this.metadataFieldStats[field].docLengths.set(fileId, tokens.length);
			this.metadataFieldStats[field].totalLength += tokens.length;
			const tfMap = buildTfMap(tokens);
			for (const [term, tf] of tfMap) {
				let fieldMap = this.metadataTermPostings.get(term);
				if (!fieldMap) {
					fieldMap = new Map();
					this.metadataTermPostings.set(term, fieldMap);
					this.insertWordTerm(term);
				}
				let postings = fieldMap.get(field);
				if (!postings) {
					postings = new Map();
					fieldMap.set(field, postings);
				}
				postings.set(fileId, tf);
			}
		}

		const passages = this.buildPassages(fileId, document.path, document.content ?? "");
		this.filePassageIds.set(
			fileId,
			passages.map((passage) => passage.id),
		);
		for (const passage of passages) {
			this.passageById.set(passage.id, passage);
			this.passageLengths.set(passage.id, passage.length);
			this.totalPassageLength += passage.length;

			for (const [term, tf] of passage.wordTf) {
				let postings = this.passageWordPostings.get(term);
				if (!postings) {
					postings = new Map();
					this.passageWordPostings.set(term, postings);
					this.insertWordTerm(term);
				}
				postings.set(passage.id, tf);
			}

			for (const [term, tf] of passage.charTf) {
				let postings = this.charBigramPostings.get(term);
				if (!postings) {
					postings = new Map();
					this.charBigramPostings.set(term, postings);
					this.insertCharTerm(term);
				}
				postings.set(passage.id, tf);
			}
		}
	}

	private removeDocument(path: string) {
		const fileId = this.fileIdByPath.get(path);
		if (fileId === undefined) {
			return;
		}

		const metadataTokens = this.fileMetadataTokens.get(fileId);
		if (metadataTokens) {
			for (const field of METADATA_FIELDS) {
				const docLength =
					this.metadataFieldStats[field].docLengths.get(fileId) ?? 0;
				this.metadataFieldStats[field].docLengths.delete(fileId);
				this.metadataFieldStats[field].totalLength -= docLength;

				const tfMap = buildTfMap(metadataTokens[field]);
				for (const term of tfMap.keys()) {
					const fieldMap = this.metadataTermPostings.get(term);
					const postings = fieldMap?.get(field);
					postings?.delete(fileId);
					if (postings && postings.size === 0) {
						fieldMap?.delete(field);
					}
					if (fieldMap && fieldMap.size === 0) {
						this.metadataTermPostings.delete(term);
						if (!this.passageWordPostings.has(term)) {
							this.removeWordTerm(term);
						}
					}
				}
			}
		}

		const passageIds = this.filePassageIds.get(fileId) ?? [];
		for (const passageId of passageIds) {
			const passage = this.passageById.get(passageId);
			if (!passage) {
				continue;
			}
			this.totalPassageLength -= this.passageLengths.get(passageId) ?? 0;
			this.passageLengths.delete(passageId);

			for (const term of passage.wordTf.keys()) {
				const postings = this.passageWordPostings.get(term);
				postings?.delete(passageId);
				if (postings && postings.size === 0) {
					this.passageWordPostings.delete(term);
					if (!this.metadataTermPostings.has(term)) {
						this.removeWordTerm(term);
					}
				}
			}

			for (const term of passage.charTf.keys()) {
				const postings = this.charBigramPostings.get(term);
				postings?.delete(passageId);
				if (postings && postings.size === 0) {
					this.charBigramPostings.delete(term);
					this.removeCharTerm(term);
				}
			}

			this.passageById.delete(passageId);
		}

		this.fileMetadataTokens.delete(fileId);
		this.fileScriptProfiles.delete(fileId);
		this.filePassageIds.delete(fileId);
		this.fileIdByPath.delete(path);
		this.pathByFileId.delete(fileId);
	}

	private buildPassages(
		fileId: number,
		filePath: string,
		content: string,
	): PassageRecord[] {
		const units = this.buildPassageUnits(content);
		if (units.length === 0) {
			return [];
		}

		const passages: PassageRecord[] = [];
		let startIndex = 0;
		while (startIndex < units.length) {
			let endIndex = startIndex;
			let tokenCount = 0;

			while (endIndex < units.length) {
				tokenCount += units[endIndex].tokens.length;
				endIndex++;
				if (
					tokenCount >= PASSAGE_TARGET_TOKENS &&
					tokenCount >= PASSAGE_MIN_TOKENS
				) {
					break;
				}
			}

			if (endIndex <= startIndex) {
				endIndex = startIndex + 1;
			}

			const selectedUnits = units.slice(startIndex, endIndex);
			const tokens = selectedUnits.flatMap((unit) => unit.tokens);
			const charTerms = selectedUnits.flatMap((unit) => unit.charTerms);
			if (tokens.length > 0 || charTerms.length > 0) {
				const text = selectedUnits.map((unit) => unit.text).join("\n");
				passages.push({
					id: this.nextPassageId++,
					fileId,
					filePath,
					text,
					length: Math.max(tokens.length, charTerms.length, 1),
					tokenSequence: tokens,
					wordTf: buildTfMap(tokens),
					charTf: buildTfMap(charTerms),
				});
			}

			if (endIndex >= units.length) {
				break;
			}

			const nextStart = this.computeNextPassageStart(units, startIndex, endIndex);
			startIndex = nextStart > startIndex ? nextStart : startIndex + 1;
		}

		return passages;
	}

	private buildPassageUnits(content: string): PassageUnit[] {
		const normalizedContent = content.trim();
		if (!normalizedContent) {
			return [];
		}

		const paragraphs = normalizedContent
			.split(/\r?\n\s*\r?\n+/u)
			.map((paragraph) => paragraph.trim())
			.filter((paragraph) => paragraph.length > 0);
		const units: PassageUnit[] = [];

		for (const paragraph of paragraphs) {
			const rawSentences =
				paragraph.match(/[^。！？!?;\n]+[。！？!?;；]?/gu) ?? [paragraph];
			for (const sentence of rawSentences) {
				const trimmed = sentence.trim();
				if (!trimmed) {
					continue;
				}

				const tokens = this.tokenizeContent(trimmed);
				const charTerms = this.extractCjkBigrams(trimmed);
				if (tokens.length === 0 && charTerms.length === 0) {
					continue;
				}

				if (tokens.length <= PASSAGE_TARGET_TOKENS * 1.5) {
					units.push({ text: trimmed, tokens, charTerms });
					continue;
				}

				for (const chunk of sliceLongText(trimmed, MIN_LONG_CHUNK_CHARS)) {
					const chunkTokens = this.tokenizeContent(chunk);
					const chunkCharTerms = this.extractCjkBigrams(chunk);
					if (chunkTokens.length > 0 || chunkCharTerms.length > 0) {
						units.push({
							text: chunk,
							tokens: chunkTokens,
							charTerms: chunkCharTerms,
						});
					}
				}
			}
		}

		if (units.length > 0) {
			return units;
		}

		const fallbackTokens = this.tokenizeContent(normalizedContent);
		const fallbackCharTerms = this.extractCjkBigrams(normalizedContent);
		return fallbackTokens.length > 0 || fallbackCharTerms.length > 0
			? [
					{
						text: normalizedContent,
						tokens: fallbackTokens,
						charTerms: fallbackCharTerms,
					},
				]
			: [];
	}

	private computeNextPassageStart(
		units: PassageUnit[],
		startIndex: number,
		endIndex: number,
	): number {
		let overlapTokens = 0;
		let nextStart = endIndex;
		for (let index = endIndex - 1; index >= startIndex; index--) {
			overlapTokens += units[index].tokens.length;
			nextStart = index;
			if (overlapTokens >= PASSAGE_OVERLAP_TOKENS) {
				break;
			}
		}
		return nextStart;
	}

	private tokenizeMetadata(text: string): string[] {
		return this.tokenizer
			.tokenizeSequence(text, "index")
			.map((term) => this.normalizeTerm(term));
	}

	private tokenizeContent(text: string): string[] {
		return this.tokenizer
			.tokenizeSequence(text, "index")
			.map((term) => this.normalizeTerm(term));
	}

	private buildQueryCharTerms(queryText: string): string[] {
		return Array.from(
			new Set(this.extractCjkBigrams(queryText).slice(0, CHAR_QUERY_BIGRAM_LIMIT)),
		);
	}

	private extractCjkBigrams(text: string): string[] {
		const bigrams: string[] = [];
		for (const match of text.normalize("NFKC").matchAll(HAN_SEQUENCE_REGEX)) {
			const chars = Array.from(match[0]);
			for (let index = 0; index < chars.length - 1; index++) {
				bigrams.push(chars[index] + chars[index + 1]);
			}
		}
		return bigrams;
	}

	private scoreCharChannel(
		queryCharTerms: string[],
		passageStates: Map<number, PassageCandidateState>,
		allowNewStates: boolean,
	) {
		for (const charTerm of queryCharTerms) {
			const postings = this.charBigramPostings.get(charTerm);
			if (!postings) {
				continue;
			}
			const idf = this.computePassageIdf(postings.size);
			const avgdl = this.averagePassageLength();
			for (const [passageId, tf] of postings) {
				const passage = this.passageById.get(passageId);
				if (
					!passage ||
					(!allowNewStates && !passageStates.has(passageId))
				) {
					continue;
				}
				const state = this.ensurePassageState(passageStates, passageId);
				state.score +=
					CHAR_CHANNEL_WEIGHT *
					idf *
					this.computeTfNorm(tf, passage.length, avgdl);
				state.charHits += 1;
				state.matchedTerms.add(charTerm);
			}
		}
	}

	private estimateQueryExecutionVisitCost(match: QueryTermMatch): number {
		return match.matchedTerms.reduce((sum, matchedTerm) => {
			const df = this.termDocumentFrequency(matchedTerm.term);
			const kindWeight =
				matchedTerm.kind === "exact"
					? 0.7
					: matchedTerm.kind === "prefix"
						? 1
						: 1.15;
			return sum + Math.max(1, df) * kindWeight;
		}, 0);
	}

	private shouldEarlyPrunePassageStates(
		totalExecutionCount: number,
		completedExecutionCount: number,
		passageStateCount: number,
	): boolean {
		if (completedExecutionCount >= totalExecutionCount) {
			return false;
		}
		if (passageStateCount <= PASSAGE_EARLY_PRUNE_TRIGGER) {
			return false;
		}
		if (totalExecutionCount <= 2) {
			return passageStateCount > PASSAGE_PRUNE_KEEP;
		}
		return true;
	}

	private computeEarlyPruneKeepCount(
		totalExecutionCount: number,
		completedExecutionCount: number,
	): number {
		const remainingExecutionCount = Math.max(
			0,
			totalExecutionCount - completedExecutionCount,
		);
		if (remainingExecutionCount >= 2) {
			return PASSAGE_EARLY_PRUNE_KEEP;
		}
		if (remainingExecutionCount === 1) {
			return PASSAGE_EARLY_PRUNE_TAIL_KEEP;
		}
		return PASSAGE_PRUNE_KEEP;
	}

	private resolveWordMatches(
		queryTerm: string,
		allowPrefix: boolean,
		allowFuzzy: boolean,
	): QueryTermMatch {
		const matchedTerms = new Map<string, MatchedQueryTerm>();
		const prefixTerms = allowPrefix ? this.expandPrefixTerms(queryTerm) : [];
		const hasLongerPrefixAlternatives = prefixTerms.some(
			(term) => term !== queryTerm,
		);

		if (this.metadataTermPostings.has(queryTerm) || this.passageWordPostings.has(queryTerm)) {
			matchedTerms.set(queryTerm, {
				term: queryTerm,
				boost: allowPrefix && hasLongerPrefixAlternatives ? 0.72 : 1,
				kind: "exact",
			});
		}

		for (const term of prefixTerms) {
			if (matchedTerms.has(term)) {
				continue;
			}
			matchedTerms.set(term, {
				term,
				boost: computePrefixBoost(queryTerm, term),
				kind: "prefix",
			});
		}

		const hasExactMatch = matchedTerms.get(queryTerm)?.kind === "exact";
		if (allowFuzzy && !hasExactMatch) {
			for (const { term, distance } of this.expandFuzzyTerms(queryTerm)) {
				if (matchedTerms.has(term)) {
					continue;
				}
				matchedTerms.set(term, {
					term,
					boost:
						computeFuzzyBoost(distance) *
						(prefixTerms.length > 0 ? 0.92 : 1),
					kind: "fuzzy",
				});
			}
		}

		return {
			matchedTerms: this.trimMatchedTermsForExecution(
				Array.from(matchedTerms.values()),
			),
		};
	}

	private trimMatchedTermsForExecution(
		matchedTerms: MatchedQueryTerm[],
	): MatchedQueryTerm[] {
		const kindOrder: Record<MatchedQueryTerm["kind"], number> = {
			exact: 0,
			prefix: 1,
			fuzzy: 2,
		};
		const ordered = [...matchedTerms].sort((left, right) => {
			if (kindOrder[left.kind] !== kindOrder[right.kind]) {
				return kindOrder[left.kind] - kindOrder[right.kind];
			}
			if (right.boost !== left.boost) {
				return right.boost - left.boost;
			}
			const leftDf = this.termDocumentFrequency(left.term);
			const rightDf = this.termDocumentFrequency(right.term);
			if (leftDf !== rightDf) {
				return leftDf - rightDf;
			}
			return left.term.localeCompare(right.term);
		});

		const retained: MatchedQueryTerm[] = [];
		let cumulativeDf = 0;
		let expandedTermCount = 0;
		for (const matchedTerm of ordered) {
			const df = this.termDocumentFrequency(matchedTerm.term);
			if (
				matchedTerm.kind !== "exact" &&
				expandedTermCount > 0 &&
				cumulativeDf + df > WORD_EXPANSION_DOC_VISIT_BUDGET
			) {
				break;
			}
			retained.push(matchedTerm);
			cumulativeDf += df;
			if (matchedTerm.kind !== "exact") {
				expandedTermCount += 1;
			}
		}
		return retained;
	}

	private expandPrefixTerms(prefix: string): string[] {
		const terms: string[] = [];
		let index = lowerBoundString(this.sortedWordTerms, prefix);
		while (index < this.sortedWordTerms.length) {
			const term = this.sortedWordTerms[index];
			if (!term.startsWith(prefix)) {
				break;
			}
			terms.push(term);
			if (terms.length >= WORD_PREFIX_EXPANSION_LIMIT) {
				break;
			}
			index++;
		}
		return terms;
	}

	private expandFuzzyTerms(
		queryTerm: string,
	): Array<{ term: string; distance: number }> {
		const maxDistance = computeMaxFuzzyDistance(queryTerm);
		if (maxDistance <= 0) {
			return [];
		}

		const candidates: Array<{ term: string; distance: number }> = [];
		for (const term of this.sortedWordTerms) {
			if (Math.abs(term.length - queryTerm.length) > maxDistance) {
				continue;
			}
			if (term[0] !== queryTerm[0]) {
				continue;
			}
			const distance = boundedLevenshtein(term, queryTerm, maxDistance);
			if (distance <= maxDistance) {
				candidates.push({ term, distance });
			}
		}

		candidates.sort((left, right) => {
			if (left.distance !== right.distance) {
				return left.distance - right.distance;
			}
			if (left.term.length !== right.term.length) {
				return left.term.length - right.term.length;
			}
			return left.term.localeCompare(right.term);
		});

		return candidates.slice(0, WORD_FUZZY_EXPANSION_LIMIT);
	}

	private normalizeTerm(term: string): string {
		return this.outerSetting.isCaseSensitive
			? term
			: term.toLocaleLowerCase();
	}

	private computePassageIdf(df: number): number {
		const docCount = Math.max(1, this.passageById.size);
		return Math.log((docCount - df + 0.5) / (df + 0.5) + 1);
	}

	private computeMetadataIdf(df: number): number {
		const docCount = Math.max(1, this.pathByFileId.size);
		return Math.log((docCount - df + 0.5) / (df + 0.5) + 1);
	}

	private computeTfNorm(tf: number, dl: number, avgdl: number): number {
		const normalizedAvg = avgdl || 1;
		return (
			(tf * (WORD_BM25_K1 + 1)) /
			(tf +
				WORD_BM25_K1 *
					(1 - WORD_BM25_B + WORD_BM25_B * (dl / normalizedAvg)))
		);
	}

	private averagePassageLength(): number {
		return this.totalPassageLength / Math.max(1, this.passageById.size);
	}

	private averageMetadataFieldLength(field: MetadataField): number {
		return (
			this.metadataFieldStats[field].totalLength /
				Math.max(1, this.pathByFileId.size) || 1
		);
	}

	private termDocumentFrequency(term: string): number {
		const contentDf = this.passageWordPostings.get(term)?.size ?? 0;
		const metadataDf = Array.from(
			this.metadataTermPostings.get(term)?.values() ?? [],
		).reduce((sum, postings) => sum + postings.size, 0);
		return contentDf + metadataDf;
	}

	private ensurePassageState(
		states: Map<number, PassageCandidateState>,
		passageId: number,
	): PassageCandidateState {
		let state = states.get(passageId);
		if (!state) {
			state = {
				score: 0,
				matchedTerms: new Set<string>(),
				matchedQueryTerms: new Set<number>(),
				matchedTermsByQueryTerm: new Map<number, Set<string>>(),
				exactMatchedQueryTerms: new Set<number>(),
				charHits: 0,
			};
			states.set(passageId, state);
		}
		return state;
	}

	private ensurePassageQueryTermMatch(
		state: PassageCandidateState,
		queryTermIndex: number,
	): Set<string> {
		let matchedTerms = state.matchedTermsByQueryTerm.get(queryTermIndex);
		if (!matchedTerms) {
			matchedTerms = new Set<string>();
			state.matchedTermsByQueryTerm.set(queryTermIndex, matchedTerms);
		}
		return matchedTerms;
	}

	private ensureFileState(
		states: Map<number, FileCandidateState>,
		fileId: number,
	): FileCandidateState {
		let state = states.get(fileId);
		if (!state) {
			state = {
				fileId,
				filePath: this.pathByFileId.get(fileId) ?? "",
				metadataScore: 0,
				metadataLaneScore: 0,
				metadataLaneTier: 0,
				bestPassageScore: 0,
				secondPassageScore: 0,
				topPassageEvidences: [],
				score: 0,
				charHits: 0,
				matchedTerms: new Set<string>(),
				matchedQueryTerms: new Set<number>(),
				matchedMetadataQueryTerms: new Set<number>(),
				matchedExpandedMetadataQueryTerms: new Set<number>(),
				matchedQueryTermsByField: new Map<SearchField, Set<number>>(),
				matchedExpandedQueryTermsByField: new Map<SearchField, Set<number>>(),
			};
			states.set(fileId, state);
		}
		return state;
	}

	private insertFilePassageEvidence(
		state: FileCandidateState,
		passageId: number,
		passageState: PassageCandidateState,
	) {
		const evidence: FilePassageEvidence = {
			passageId,
			score: passageState.score,
			matchedQueryTerms: passageState.matchedQueryTerms,
			exactMatchedQueryTerms: passageState.exactMatchedQueryTerms,
			matchedTermsByQueryTerm: passageState.matchedTermsByQueryTerm,
		};
		const evidences = state.topPassageEvidences;
		let insertIndex = 0;
		while (insertIndex < evidences.length) {
			const current = evidences[insertIndex];
			if (
				current.score < evidence.score ||
				(current.score === evidence.score && current.passageId > passageId)
			) {
				break;
			}
			insertIndex += 1;
		}
		if (insertIndex < MAX_FILE_PASSAGE_EVIDENCES) {
			evidences.splice(insertIndex, 0, evidence);
			if (evidences.length > MAX_FILE_PASSAGE_EVIDENCES) {
				evidences.length = MAX_FILE_PASSAGE_EVIDENCES;
			}
		}
		state.bestPassageScore = evidences[0]?.score ?? 0;
		state.secondPassageScore = evidences[1]?.score ?? 0;
	}

	private ensureFieldMatch(
		state: FileCandidateState,
		field: SearchField,
	): Set<number> {
		let fieldMatches = state.matchedQueryTermsByField.get(field);
		if (!fieldMatches) {
			fieldMatches = new Set<number>();
			state.matchedQueryTermsByField.set(field, fieldMatches);
		}
		return fieldMatches;
	}

	private ensureExpandedFieldMatch(
		state: FileCandidateState,
		field: SearchField,
	): Set<number> {
		let fieldMatches = state.matchedExpandedQueryTermsByField.get(field);
		if (!fieldMatches) {
			fieldMatches = new Set<number>();
			state.matchedExpandedQueryTermsByField.set(field, fieldMatches);
		}
		return fieldMatches;
	}

	private createMatchedFile(
		state: FileCandidateState,
		queryTerms: string[],
		scoreBonus: number,
		planner: FileSearchQueryPlanner | null,
		queryRoute: ExperimentalQueryRoute,
		queryTermWeights: QueryTermWeightMap,
		queryTermDecomposition: QueryTermDecomposition,
		totalQueryWeight: number,
		queryScriptProfile: ScriptProfile,
		queryScoringCache: QueryScoringCache,
	): RankedMatchedFile {
		const contentMatches = this.getUnionFieldMatches(state, ["content"]);
		const basenameAliasMatches = this.getUnionFieldMatches(state, [
			"basename",
			"aliases",
		]);
		const headingMatches = this.getUnionFieldMatches(state, ["headings"]);
		const titleHeadingMatches = this.getUnionFieldMatches(state, [
			"basename",
			"aliases",
			"headings",
		]);
		const pathMatches = this.getUnionFieldMatches(state, ["folder", "tags"]);
		const basenameAliasExpandedMatches = this.getUnionExpandedFieldMatches(state, [
			"basename",
			"aliases",
		]);
		const headingExpandedMatches = this.getUnionExpandedFieldMatches(state, [
			"headings",
		]);
		const matchedQueryWeight = getSetWeight(
			state.matchedQueryTerms,
			queryTermWeights,
		);
		const metadataMatchedWeight = getSetWeight(
			state.matchedMetadataQueryTerms,
			queryTermWeights,
		);
		const contentMatchedWeight = getSetWeight(contentMatches, queryTermWeights);
		const basenameAliasMatchedWeight = getSetWeight(
			basenameAliasMatches,
			queryTermWeights,
		);
		const headingMatchedWeight = getSetWeight(headingMatches, queryTermWeights);
		const titleHeadingMatchedWeight = getSetWeight(
			titleHeadingMatches,
			queryTermWeights,
		);
		const pathMatchedWeight = getSetWeight(pathMatches, queryTermWeights);
		const basenameAliasExpandedWeight = getSetWeight(
			basenameAliasExpandedMatches,
			queryTermWeights,
		);
		const headingExpandedWeight = getSetWeight(
			headingExpandedMatches,
			queryTermWeights,
		);
		const basenameAliasExactWeight = Math.max(
			0,
			basenameAliasMatchedWeight - basenameAliasExpandedWeight,
		);
		const headingExactWeight = Math.max(
			0,
			headingMatchedWeight - headingExpandedWeight,
		);
		const basenameAliasOnlyAnchorWeight = getSetDifferenceWeight(
			basenameAliasMatches,
			contentMatches,
			queryTermWeights,
		);
		const headingOnlyAnchorWeight = getSetDifferenceWeight(
			headingMatches,
			contentMatches,
			queryTermWeights,
		);
		const titleOnlyAnchorWeight = getSetDifferenceWeight(
			titleHeadingMatches,
			contentMatches,
			queryTermWeights,
		);
		const pathOnlyAnchorWeight = getSetDifferenceWeight(
			pathMatches,
			contentMatches,
			queryTermWeights,
		);
		const coverageRatio = matchedQueryWeight / totalQueryWeight;
		const metadataCoverageRatio = metadataMatchedWeight / totalQueryWeight;
		const contentCoverageRatio = contentMatchedWeight / totalQueryWeight;
		const basenameAliasExactRatio = basenameAliasExactWeight / totalQueryWeight;
		const basenameAliasExpandedRatio = basenameAliasExpandedWeight / totalQueryWeight;
		const basenameAliasCoverageRatio =
			basenameAliasMatchedWeight / totalQueryWeight;
		const headingExactRatio = headingExactWeight / totalQueryWeight;
		const headingExpandedRatio = headingExpandedWeight / totalQueryWeight;
		const headingCoverageRatio = headingMatchedWeight / totalQueryWeight;
		const basenameAliasCompactness =
			basenameAliasMatchedWeight /
			Math.max(1, this.getMetadataFieldTokenCount(state.fileId, [
				"basename",
				"aliases",
			]));
		const headingCompactness =
			headingMatchedWeight /
			Math.max(1, this.getMetadataFieldTokenCount(state.fileId, ["headings"]));
		const titleHeadingCoverageRatio = titleHeadingMatchedWeight / totalQueryWeight;
		const pathCoverageRatio = pathMatchedWeight / totalQueryWeight;
		const basenameAliasOnlyCoverageRatio =
			basenameAliasOnlyAnchorWeight / totalQueryWeight;
		const headingOnlyCoverageRatio = headingOnlyAnchorWeight / totalQueryWeight;
		const titleOnlyCoverageRatio = titleOnlyAnchorWeight / totalQueryWeight;
		const pathOnlyCoverageRatio = pathOnlyAnchorWeight / totalQueryWeight;
		const metadataAnchorWeight = planner
			? getOverlapWeight(
					state.matchedMetadataQueryTerms,
					planner.anchorTermIndexes,
					queryTermWeights,
				)
			: 0;
		const titleHeadingAnchorWeight = planner
			? getOverlapWeight(
					titleHeadingMatches,
					planner.anchorTermIndexes,
					queryTermWeights,
				)
			: 0;
		const basenameAliasAnchorWeight = planner
			? getOverlapWeight(
					basenameAliasMatches,
					planner.anchorTermIndexes,
					queryTermWeights,
				)
			: 0;
		const headingAnchorWeight = planner
			? getOverlapWeight(
					headingMatches,
					planner.anchorTermIndexes,
					queryTermWeights,
				)
			: 0;
		const pathAnchorWeight = planner
			? getOverlapWeight(
					pathMatches,
					planner.anchorTermIndexes,
					queryTermWeights,
				)
			: 0;
		const passageSetSignals = this.computePassageSetSignals({
			state,
			queryTerms,
			planner,
			queryTermWeights,
			totalQueryWeight,
			queryScoringCache,
		});
		const metadataAnchorRatio = metadataAnchorWeight / totalQueryWeight;
		const titleHeadingAnchorRatio = titleHeadingAnchorWeight / totalQueryWeight;
		const basenameAliasAnchorRatio =
			basenameAliasAnchorWeight / totalQueryWeight;
		const headingAnchorRatio = headingAnchorWeight / totalQueryWeight;
		const pathAnchorRatio = pathAnchorWeight / totalQueryWeight;
		const queryDecompositionSignals = this.computeQueryDecompositionSignals({
			state,
			contentMatches,
			queryTermWeights,
			queryTermDecomposition,
		});
		const bodyMetadataBlendBonus =
			state.bestPassageScore > 0 && metadataAnchorWeight > 0
				? metadataAnchorRatio *
					(planner?.queryKind === "path_like"
						? FILE_PATHLIKE_METADATA_ANCHOR_BLEND
						: FILE_METADATA_ANCHOR_BLEND)
				: 0;
		const mixedQueryBonus =
			state.bestPassageScore > 0 &&
			metadataMatchedWeight > 0 &&
			contentMatchedWeight > 0
				? FILE_MIXED_QUERY_BODY_METADATA_BONUS *
					Math.min(1, metadataCoverageRatio + contentCoverageRatio * 0.5)
				: 0;
		const basenameAliasBlendBonus =
			state.bestPassageScore > 0 && basenameAliasMatchedWeight > 0
				? basenameAliasCoverageRatio * FILE_BASENAME_ALIAS_ANCHOR_BLEND +
					basenameAliasOnlyCoverageRatio *
						FILE_BASENAME_ALIAS_ONLY_ANCHOR_BONUS +
					basenameAliasAnchorRatio * FILE_BASENAME_ALIAS_BODY_MIX_BONUS
				: 0;
		const headingBlendBonus =
			state.bestPassageScore > 0 && headingMatchedWeight > 0
				? headingCoverageRatio * (FILE_TITLE_HEADING_ANCHOR_BLEND * 0.58) +
					headingOnlyCoverageRatio * (FILE_TITLE_ONLY_ANCHOR_BONUS * 0.32) +
					headingAnchorRatio * (FILE_BODY_TITLE_MIX_BONUS * 0.42)
				: 0;
		const titleHeadingBlendBonus =
			basenameAliasBlendBonus +
			headingBlendBonus +
			(state.bestPassageScore > 0 && titleHeadingMatchedWeight > 0
				? titleHeadingCoverageRatio * 0.12 +
					titleOnlyCoverageRatio * 0.08 +
					titleHeadingAnchorRatio * 0.1
				: 0);
		const pathBlendBonus =
			state.bestPassageScore > 0 && pathMatchedWeight > 0
				? pathCoverageRatio *
						(planner?.queryKind === "path_like"
							? FILE_PATHLIKE_METADATA_ANCHOR_BLEND * 0.45
							: FILE_METADATA_ANCHOR_BLEND * 0.22) +
					pathOnlyCoverageRatio * FILE_PATH_ONLY_ANCHOR_BONUS +
					pathAnchorRatio *
						(planner?.queryKind === "path_like"
							? FILE_PATHLIKE_METADATA_ANCHOR_BLEND * 0.7
							: FILE_METADATA_ANCHOR_BLEND * 0.35) +
					(contentMatchedWeight > 0
						? FILE_BODY_PATH_MIX_BONUS *
							Math.min(1, pathCoverageRatio + pathAnchorRatio * 0.5)
						: 0)
				: 0;
		const metadataDominantBonus =
			metadataCoverageRatio >= 0.66 &&
			contentCoverageRatio < 0.5
				? planner?.queryKind === "path_like"
					? FILE_PATHLIKE_METADATA_QUERY_BONUS * metadataCoverageRatio
					: FILE_METADATA_DOMINANT_QUERY_BONUS * metadataCoverageRatio
				: 0;
		const decompositionBodyBonus =
			queryDecompositionSignals.bodyEvidenceCoverageRatio *
			FILE_DECOMPOSITION_BODY_EVIDENCE_BONUS;
		const decompositionBodyAnchorBonus =
			queryDecompositionSignals.bodyAnchorSynergyRatio *
			FILE_DECOMPOSITION_BODY_ANCHOR_BONUS;
		const decompositionMetadataNoisePenalty =
			queryDecompositionSignals.metadataOnlyNoiseRatio *
			FILE_DECOMPOSITION_METADATA_NOISE_PENALTY;
		const baseScore =
			state.bestPassageScore +
			state.secondPassageScore * FILE_SECOND_PASSAGE_DECAY +
			passageSetSignals.score +
			state.metadataScore +
			coverageRatio * FILE_COVERAGE_BONUS +
			metadataCoverageRatio * FILE_METADATA_PRIOR +
			bodyMetadataBlendBonus +
			mixedQueryBonus +
			titleHeadingBlendBonus +
			pathBlendBonus +
			metadataDominantBonus +
			decompositionBodyBonus +
			decompositionBodyAnchorBonus -
			decompositionMetadataNoisePenalty +
			Math.min(0.55, state.charHits * FILE_CHAR_HIT_BONUS);
		const shortTitleFastPathScore = this.computeShortTitleFastPathScore({
			planner,
			coverageRatio,
			contentCoverageRatio,
			basenameAliasExactRatio,
			basenameAliasExpandedRatio,
			headingExactRatio,
			headingExpandedRatio,
			basenameAliasCompactness,
			headingCompactness,
		});
		const shortAnchorLaneTier = this.computeShortAnchorLaneTier({
			planner,
			basenameAliasExactRatio,
			basenameAliasExpandedRatio,
			headingExactRatio,
			headingExpandedRatio,
		});
		const scriptFitScore = this.computeScriptFitScore(
			state.fileId,
			queryScriptProfile,
		);
		const pathLocaleFitScore = this.computePathLocaleFitScore(
			state.filePath,
			queryTerms,
			queryScriptProfile,
		);
		const bodyCoreScore =
			state.bestPassageScore +
			state.secondPassageScore * FILE_SECOND_PASSAGE_DECAY +
			passageSetSignals.score +
			coverageRatio * FILE_COVERAGE_BONUS +
			Math.min(0.55, state.charHits * FILE_CHAR_HIT_BONUS);
		const metadataCoreScore =
			state.metadataScore +
			metadataCoverageRatio * FILE_METADATA_PRIOR +
			state.metadataLaneTier * 0.7 +
			state.metadataLaneScore * 0.04;
		const mixedEvidenceScore =
			bodyMetadataBlendBonus +
			mixedQueryBonus +
			titleHeadingBlendBonus +
			pathBlendBonus +
			metadataDominantBonus;
		const queryRouteScore = this.computeQueryRouteScore({
			queryRoute,
			bodyCoreScore,
			metadataCoreScore,
			mixedEvidenceScore,
			contentCoverageRatio,
			bodyEvidenceCoverageRatio:
				queryDecompositionSignals.bodyEvidenceCoverageRatio,
			anchorSatisfiedRatio:
				queryDecompositionSignals.anchorSatisfiedRatio,
			metadataOnlyNoiseRatio:
				queryDecompositionSignals.metadataOnlyNoiseRatio,
			bodyAnchorSynergyRatio:
				queryDecompositionSignals.bodyAnchorSynergyRatio,
			basenameAliasExactRatio,
			basenameAliasExpandedRatio,
			basenameAliasCoverageRatio,
			basenameAliasOnlyCoverageRatio,
			basenameAliasAnchorRatio,
			headingCoverageRatio,
			headingCompactness,
			headingAnchorRatio,
			metadataAnchorRatio,
			titleHeadingCoverageRatio,
			titleOnlyCoverageRatio,
			titleHeadingAnchorRatio,
			pathCoverageRatio,
			pathAnchorRatio,
			passageBestCoverageRatio: passageSetSignals.bestCoverageRatio,
			passageCorroboratedCoverageRatio:
				passageSetSignals.corroboratedCoverageRatio,
			passageAnchorAgreementRatio: passageSetSignals.anchorAgreementRatio,
			passageFragmentationRatio: passageSetSignals.fragmentationRatio,
			passageWindowCoverageRatio:
				passageSetSignals.bestWindowCoverageRatio,
			passageWindowAnchorRatio: passageSetSignals.bestWindowAnchorRatio,
			passageWindowCompactnessRatio:
				passageSetSignals.bestWindowCompactnessRatio,
			localExplanationCompetitionScore:
				passageSetSignals.localExplanationCompetitionScore,
			localExplanationUnionCoverageRatio:
				passageSetSignals.localExplanationUnionCoverageRatio,
			localExplanationCorroboratedCoverageRatio:
				passageSetSignals.localExplanationCorroboratedCoverageRatio,
			localExplanationAnchorRatio:
				passageSetSignals.localExplanationAnchorRatio,
			localExplanationCompactnessRatio:
				passageSetSignals.localExplanationCompactnessRatio,
			secondPassageScore: state.secondPassageScore,
			metadataLaneTier: state.metadataLaneTier,
			metadataLaneScore: state.metadataLaneScore,
			shortAnchorLaneScore: shortTitleFastPathScore,
			shortAnchorLaneTier,
			scriptFitScore,
			pathLocaleFitScore,
		});
		return {
			path: state.filePath,
			queryTerms,
			matchedTerms: Array.from(state.matchedTerms),
			score: baseScore + scoreBonus,
			queryRouteScore,
			metadataLaneScore: state.metadataLaneScore,
			metadataLaneTier: state.metadataLaneTier,
			shortAnchorLaneScore: shortTitleFastPathScore,
			shortAnchorLaneTier,
			scriptFitScore,
			pathLocaleFitScore,
			bestPassageScore: state.bestPassageScore,
			localExplanationCompetitionScore:
				passageSetSignals.localExplanationCompetitionScore,
			basenameAliasCoverageRatio,
			basenameAliasAnchorRatio,
			headingCoverageRatio,
			headingAnchorRatio,
			pathCoverageRatio,
			pathAnchorRatio,
		};
	}

	private computeQueryDecompositionSignals(params: {
		state: FileCandidateState;
		contentMatches: ReadonlySet<number>;
		queryTermWeights: QueryTermWeightMap;
		queryTermDecomposition: QueryTermDecomposition;
	}): QueryDecompositionSignals {
		const { state, contentMatches, queryTermWeights, queryTermDecomposition } = params;
		const bodyWeight = getSetWeight(
			queryTermDecomposition.bodyTermIndexes,
			queryTermWeights,
		);
		const anchorWeight = getSetWeight(
			queryTermDecomposition.anchorTermIndexes,
			queryTermWeights,
		);
		const noiseWeight = getSetWeight(
			queryTermDecomposition.noiseTermIndexes,
			queryTermWeights,
		);
		const bodyContentWeight = getOverlapWeight(
			contentMatches,
			queryTermDecomposition.bodyTermIndexes,
			queryTermWeights,
		);
		const anchorMatchedWeight = getOverlapWeight(
			state.matchedQueryTerms,
			queryTermDecomposition.anchorTermIndexes,
			queryTermWeights,
		);
		const metadataOnlyMatches = new Set<number>();
		for (const queryTermIndex of state.matchedMetadataQueryTerms) {
			if (!contentMatches.has(queryTermIndex)) {
				metadataOnlyMatches.add(queryTermIndex);
			}
		}
		const metadataOnlyNoiseWeight = getOverlapWeight(
			metadataOnlyMatches,
			queryTermDecomposition.noiseTermIndexes,
			queryTermWeights,
		);
		const bodyEvidenceCoverageRatio =
			bodyWeight > 0 ? bodyContentWeight / bodyWeight : 0;
		const anchorSatisfiedRatio =
			anchorWeight > 0 ? anchorMatchedWeight / anchorWeight : 0;
		const metadataOnlyNoiseRatio =
			noiseWeight > 0 ? metadataOnlyNoiseWeight / noiseWeight : 0;
		const bodyAnchorSynergyRatio =
			bodyWeight > 0 && anchorWeight > 0
				? bodyEvidenceCoverageRatio * anchorSatisfiedRatio
				: 0;
		return {
			bodyEvidenceCoverageRatio,
			anchorSatisfiedRatio,
			metadataOnlyNoiseRatio,
			bodyAnchorSynergyRatio,
		};
	}

	private sortMatchedFiles(
		results: RankedMatchedFile[],
		planner: FileSearchQueryPlanner | null = null,
		queryRoute: ExperimentalQueryRoute = "body_local",
		localeContext: {
			queryTerms: readonly string[];
			queryScriptProfile: ScriptProfile;
		} | null = null,
	): RankedMatchedFile[] {
		if (
			queryRoute === "metadata_exact" &&
			planner?.queryKind === "short_anchor" &&
			this.shouldRouteShortAnchorResults(results)
		) {
			return results.sort((left, right) => {
				const localePreference = localeContext
					? this.compareMirrorLocalePreference(left, right, localeContext)
					: 0;
				if (localePreference !== 0) {
					return localePreference;
				}
				if (right.queryRouteScore !== left.queryRouteScore) {
					return right.queryRouteScore - left.queryRouteScore;
				}
				if (right.shortAnchorLaneTier !== left.shortAnchorLaneTier) {
					return right.shortAnchorLaneTier - left.shortAnchorLaneTier;
				}
				if (right.scriptFitScore !== left.scriptFitScore) {
					return right.scriptFitScore - left.scriptFitScore;
				}
				const leftScore = left.score ?? 0;
				const rightScore = right.score ?? 0;
				if (rightScore !== leftScore) {
					return rightScore - leftScore;
				}
				return left.path.localeCompare(right.path);
			});
		}
		if (queryRoute === "metadata_exact" && this.shouldRouteMetadataLaneResults(results)) {
			return results.sort((left, right) => {
				const localePreference = localeContext
					? this.compareMirrorLocalePreference(left, right, localeContext)
					: 0;
				if (localePreference !== 0) {
					return localePreference;
				}
				if (right.queryRouteScore !== left.queryRouteScore) {
					return right.queryRouteScore - left.queryRouteScore;
				}
				if (right.metadataLaneTier !== left.metadataLaneTier) {
					return right.metadataLaneTier - left.metadataLaneTier;
				}
				if (right.scriptFitScore !== left.scriptFitScore) {
					return right.scriptFitScore - left.scriptFitScore;
				}
				const leftScore = left.score ?? 0;
				const rightScore = right.score ?? 0;
				if (rightScore !== leftScore) {
					return rightScore - leftScore;
				}
				if (right.shortAnchorLaneScore !== left.shortAnchorLaneScore) {
					return right.shortAnchorLaneScore - left.shortAnchorLaneScore;
				}
				return left.path.localeCompare(right.path);
			});
		}
		if (queryRoute === "path_anchor" && this.shouldRouteMetadataLaneResults(results)) {
			return results.sort((left, right) => {
				const localePreference = localeContext
					? this.compareMirrorLocalePreference(left, right, localeContext)
					: 0;
				if (localePreference !== 0) {
					return localePreference;
				}
				if (right.queryRouteScore !== left.queryRouteScore) {
					return right.queryRouteScore - left.queryRouteScore;
				}
				if (right.metadataLaneTier !== left.metadataLaneTier) {
					return right.metadataLaneTier - left.metadataLaneTier;
				}
				if (right.bestPassageScore !== left.bestPassageScore) {
					return right.bestPassageScore - left.bestPassageScore;
				}
				if (right.scriptFitScore !== left.scriptFitScore) {
					return right.scriptFitScore - left.scriptFitScore;
				}
				const leftScore = left.score ?? 0;
				const rightScore = right.score ?? 0;
				if (rightScore !== leftScore) {
					return rightScore - leftScore;
				}
				return left.path.localeCompare(right.path);
			});
		}
		if (queryRoute === "mixed_anchor") {
			return results.sort((left, right) => {
				const localePreference = localeContext
					? this.compareMirrorLocalePreference(left, right, localeContext)
					: 0;
				if (localePreference !== 0) {
					return localePreference;
				}
				if (right.queryRouteScore !== left.queryRouteScore) {
					return right.queryRouteScore - left.queryRouteScore;
				}
				if (
					right.localExplanationCompetitionScore !==
					left.localExplanationCompetitionScore
				) {
					return (
						right.localExplanationCompetitionScore -
						left.localExplanationCompetitionScore
					);
				}
				const leftScore = left.score ?? 0;
				const rightScore = right.score ?? 0;
				if (rightScore !== leftScore) {
					return rightScore - leftScore;
				}
				if (right.metadataLaneTier !== left.metadataLaneTier) {
					return right.metadataLaneTier - left.metadataLaneTier;
				}
				if (right.scriptFitScore !== left.scriptFitScore) {
					return right.scriptFitScore - left.scriptFitScore;
				}
				return left.path.localeCompare(right.path);
			});
		}
		return results.sort((left, right) => {
			const localePreference = localeContext
				? this.compareMirrorLocalePreference(left, right, localeContext)
				: 0;
			if (localePreference !== 0) {
				return localePreference;
			}
			if (right.queryRouteScore !== left.queryRouteScore) {
				return right.queryRouteScore - left.queryRouteScore;
			}
			if (
				right.localExplanationCompetitionScore !==
				left.localExplanationCompetitionScore
			) {
				return (
					right.localExplanationCompetitionScore -
					left.localExplanationCompetitionScore
				);
			}
			const leftScore = left.score ?? 0;
			const rightScore = right.score ?? 0;
			if (rightScore !== leftScore) {
				return rightScore - leftScore;
			}
			if (right.scriptFitScore !== left.scriptFitScore) {
				return right.scriptFitScore - left.scriptFitScore;
			}
			return left.path.localeCompare(right.path);
		});
	}

	private shouldRouteMetadataLaneResults(
		results: ReadonlyArray<RankedMatchedFile>,
	): boolean {
		return results.some((result) => result.metadataLaneTier > 0);
	}

	private compareMirrorLocalePreference(
		left: RankedMatchedFile,
		right: RankedMatchedFile,
		context: {
			queryTerms: readonly string[];
			queryScriptProfile: ScriptProfile;
		},
	): number {
		const preference = this.getQueryLocalePreference(
			context.queryTerms,
			context.queryScriptProfile,
		);
		if (!preference.locale) {
			return 0;
		}
		const leftLocale = this.detectPathLocale(left.path);
		const rightLocale = this.detectPathLocale(right.path);
		if (
			!leftLocale ||
			!rightLocale ||
			leftLocale === rightLocale ||
			(leftLocale !== preference.locale && rightLocale !== preference.locale)
		) {
			return 0;
		}
		if (!this.areMirrorLocaleVariants(left.path, right.path)) {
			return 0;
		}
		const queryRouteScoreGap = Math.abs(left.queryRouteScore - right.queryRouteScore);
		const scoreGap = Math.abs((left.score ?? 0) - (right.score ?? 0));
		const queryRouteGapThreshold = preference.explicit ? 18 : 12;
		const scoreGapThreshold = preference.explicit ? 10 : 7;
		if (
			queryRouteScoreGap > queryRouteGapThreshold ||
			scoreGap > scoreGapThreshold
		) {
			return 0;
		}
		return leftLocale === preference.locale ? -1 : 1;
	}

	private determineExperimentalQueryRoute(
		planner: FileSearchQueryPlanner | null,
	): ExperimentalQueryRoute {
		switch (planner?.queryKind) {
			case "short_anchor":
				return "metadata_exact";
			case "path_like":
				return "path_anchor";
			case "mixed":
				return "mixed_anchor";
			case "sentence_like":
			default:
				return "body_local";
		}
	}

	private computeQueryRouteScore(params: {
		queryRoute: ExperimentalQueryRoute;
		bodyCoreScore: number;
		metadataCoreScore: number;
		mixedEvidenceScore: number;
		contentCoverageRatio: number;
		bodyEvidenceCoverageRatio: number;
		anchorSatisfiedRatio: number;
		metadataOnlyNoiseRatio: number;
		bodyAnchorSynergyRatio: number;
		basenameAliasExactRatio: number;
		basenameAliasExpandedRatio: number;
		basenameAliasCoverageRatio: number;
		basenameAliasOnlyCoverageRatio: number;
		basenameAliasAnchorRatio: number;
		headingCoverageRatio: number;
		headingCompactness: number;
		headingAnchorRatio: number;
		metadataAnchorRatio: number;
		titleHeadingCoverageRatio: number;
		titleOnlyCoverageRatio: number;
		titleHeadingAnchorRatio: number;
		pathCoverageRatio: number;
		pathAnchorRatio: number;
		passageBestCoverageRatio: number;
		passageCorroboratedCoverageRatio: number;
		passageAnchorAgreementRatio: number;
		passageFragmentationRatio: number;
		passageWindowCoverageRatio: number;
		passageWindowAnchorRatio: number;
		passageWindowCompactnessRatio: number;
		localExplanationCompetitionScore: number;
		localExplanationUnionCoverageRatio: number;
		localExplanationCorroboratedCoverageRatio: number;
		localExplanationAnchorRatio: number;
		localExplanationCompactnessRatio: number;
		secondPassageScore: number;
		metadataLaneTier: number;
		metadataLaneScore: number;
		shortAnchorLaneScore: number;
		shortAnchorLaneTier: number;
		scriptFitScore: number;
		pathLocaleFitScore: number;
	}): number {
		const {
			queryRoute,
			bodyCoreScore,
			metadataCoreScore,
			mixedEvidenceScore,
			contentCoverageRatio,
			bodyEvidenceCoverageRatio,
			anchorSatisfiedRatio,
			metadataOnlyNoiseRatio,
			bodyAnchorSynergyRatio,
			basenameAliasExactRatio,
			basenameAliasExpandedRatio,
			basenameAliasCoverageRatio,
			basenameAliasOnlyCoverageRatio,
			basenameAliasAnchorRatio,
			headingCoverageRatio,
			headingCompactness,
			headingAnchorRatio,
			metadataAnchorRatio,
			titleHeadingCoverageRatio,
			titleOnlyCoverageRatio,
			titleHeadingAnchorRatio,
			pathCoverageRatio,
			pathAnchorRatio,
			passageBestCoverageRatio,
			passageCorroboratedCoverageRatio,
			passageAnchorAgreementRatio,
			passageFragmentationRatio,
			passageWindowCoverageRatio,
			passageWindowAnchorRatio,
			passageWindowCompactnessRatio,
			localExplanationCompetitionScore,
			localExplanationUnionCoverageRatio,
			localExplanationCorroboratedCoverageRatio,
			localExplanationAnchorRatio,
			localExplanationCompactnessRatio,
			secondPassageScore,
			metadataLaneTier,
			metadataLaneScore,
			shortAnchorLaneScore,
			shortAnchorLaneTier,
			scriptFitScore,
			pathLocaleFitScore,
		} = params;
		const titleAnchorEvidence =
			basenameAliasExactRatio * 1.9 +
			basenameAliasExpandedRatio * 0.8 +
			basenameAliasCoverageRatio * 1.3 +
			basenameAliasOnlyCoverageRatio * 1.15 +
			basenameAliasAnchorRatio * 1.8 +
			headingCoverageRatio * 0.28 +
			headingAnchorRatio * 0.45;
		const pathAnchorEvidence =
			pathCoverageRatio * 1.2 +
			pathAnchorRatio * 1.7 +
			metadataAnchorRatio * 0.55;
		const exactBasenameCorroborationScore =
			basenameAliasExactRatio >= 0.999
				? bodyCoreScore * 1.05 +
					passageBestCoverageRatio * 4.8 +
					passageWindowCoverageRatio * 3.6 +
					passageWindowCompactnessRatio * 2.2 +
					passageAnchorAgreementRatio * 1.4 -
					passageFragmentationRatio * 1.8
				: 0;
		const expandedBasenameCorroborationScore =
			basenameAliasExactRatio < 0.999 &&
			basenameAliasExpandedRatio >= 0.999 &&
			passageCorroboratedCoverageRatio > 0
				? secondPassageScore * 90 +
					passageCorroboratedCoverageRatio * 120 +
					bodyCoreScore * 6
				: 0;
		const bodyLocalScore =
			bodyCoreScore * 1.4 +
			mixedEvidenceScore * 0.88 +
			contentCoverageRatio * 7.6 +
			bodyEvidenceCoverageRatio * 5.4 +
			anchorSatisfiedRatio * 1.3 +
			bodyAnchorSynergyRatio * 4.6 -
			metadataOnlyNoiseRatio * 3.4 +
			passageBestCoverageRatio * 5.2 +
			passageCorroboratedCoverageRatio * 2.6 +
			passageWindowCoverageRatio * 3.8 +
			passageWindowAnchorRatio * 2.2 +
			passageWindowCompactnessRatio * 2.5 +
			localExplanationCompetitionScore * 1.25 +
			localExplanationUnionCoverageRatio * 1.9 +
			localExplanationCorroboratedCoverageRatio * 1.6 +
			localExplanationAnchorRatio * 0.75 +
			localExplanationCompactnessRatio * 0.6 +
			passageAnchorAgreementRatio * 2.4 -
			passageFragmentationRatio * 4.6 +
			titleAnchorEvidence * 1.8 +
			pathAnchorEvidence * 1.45 +
			titleHeadingAnchorRatio * 2.4 +
			pathAnchorRatio * 2.4 +
			metadataCoreScore * 0.08 +
			scriptFitScore * 0.5;
		switch (queryRoute) {
			case "metadata_exact":
				return (
					metadataLaneTier * 120 +
					shortAnchorLaneTier * 70 +
					metadataLaneScore * 3.8 +
					shortAnchorLaneScore * 2.2 +
					basenameAliasExactRatio * 38 +
					basenameAliasExpandedRatio * 14 +
					basenameAliasCoverageRatio * 12 +
					basenameAliasAnchorRatio * 18 +
					headingAnchorRatio * 6 +
					scriptFitScore * 6 +
					pathLocaleFitScore * 4.5 +
					exactBasenameCorroborationScore +
					expandedBasenameCorroborationScore +
					bodyCoreScore * 0.18 +
					metadataCoreScore * 0.25
				);
			case "path_anchor":
				return (
					metadataLaneTier * 105 +
					metadataLaneScore * 3.4 +
					bodyCoreScore * 0.98 +
					mixedEvidenceScore * 1.25 +
					pathCoverageRatio * 9 +
					pathAnchorRatio * 12 +
					metadataAnchorRatio * 8 +
					passageBestCoverageRatio * 1.8 +
					passageWindowCoverageRatio * 1.5 +
					passageWindowAnchorRatio * 1.8 +
					passageAnchorAgreementRatio * 1.6 -
					passageFragmentationRatio * 2.2 +
					scriptFitScore * 2 +
					pathLocaleFitScore * 5.5
				);
			case "mixed_anchor": {
				const mixedBodyPathIntent =
					pathCoverageRatio >= 0.4 &&
					pathAnchorRatio < 0.1 &&
					bodyEvidenceCoverageRatio >= 0.22 &&
					basenameAliasCoverageRatio < 0.12 &&
					basenameAliasExpandedRatio < 0.12 &&
					basenameAliasAnchorRatio < 0.12;
				const mixedTitleScore =
					bodyCoreScore * 1.18 +
					mixedEvidenceScore * 1.5 +
					contentCoverageRatio * 6.5 +
					bodyEvidenceCoverageRatio * 4.4 +
					bodyAnchorSynergyRatio * 5 +
					anchorSatisfiedRatio * 1.2 -
					metadataOnlyNoiseRatio * 3.2 +
					titleAnchorEvidence * 11.4 +
					titleHeadingCoverageRatio * 2.5 +
					titleOnlyCoverageRatio * 1.8 +
					metadataAnchorRatio * 5.5 +
					passageBestCoverageRatio * 2.1 +
					passageCorroboratedCoverageRatio * 1.2 +
					passageWindowCoverageRatio * 2.4 +
					passageWindowAnchorRatio * 2.2 +
					passageWindowCompactnessRatio * 1.6 +
					localExplanationCompetitionScore * 0.85 +
					localExplanationUnionCoverageRatio * 1.2 +
					localExplanationCorroboratedCoverageRatio * 1 +
					localExplanationAnchorRatio * 0.45 +
					localExplanationCompactnessRatio * 0.3 +
					passageAnchorAgreementRatio * 2 -
					passageFragmentationRatio * 2.4 +
					metadataLaneTier * 4.5 +
					metadataLaneScore * 0.32 +
					scriptFitScore;
				const mixedPathScore =
					bodyCoreScore * 1.22 +
					mixedEvidenceScore * 1.28 +
					contentCoverageRatio * 6.8 +
					bodyEvidenceCoverageRatio * 3.8 +
					bodyAnchorSynergyRatio * 4.2 +
					anchorSatisfiedRatio * 1.1 -
					metadataOnlyNoiseRatio * 2.8 +
					pathAnchorEvidence * 10.2 +
					titleHeadingAnchorRatio * 2.5 +
					passageBestCoverageRatio * 1.7 +
					passageCorroboratedCoverageRatio * 0.8 +
					passageWindowCoverageRatio * 1.8 +
					passageWindowAnchorRatio * 1.9 +
					passageWindowCompactnessRatio * 1.2 +
					localExplanationCompetitionScore * 0.45 +
					localExplanationUnionCoverageRatio * 0.7 +
					passageAnchorAgreementRatio * 1.7 -
					passageFragmentationRatio * 2.1 +
					metadataLaneTier * 3.5 +
					metadataLaneScore * 0.28 +
					scriptFitScore;
				const headingCrowdingPenalty =
					(headingCoverageRatio > 0
						? (headingCoverageRatio /
								Math.max(0.0025, headingCompactness)) *
							0.24
						: 0) +
					headingCoverageRatio * 6.8 +
					titleHeadingCoverageRatio * 2.2 +
					titleHeadingAnchorRatio * 1.4;
				const bodyPathScore = mixedBodyPathIntent
					? bodyCoreScore * 0.9 +
						secondPassageScore * 2.8 +
						mixedEvidenceScore * 1.35 +
						contentCoverageRatio * 7.3 +
						bodyEvidenceCoverageRatio * 8.4 +
						anchorSatisfiedRatio * 1.25 +
						bodyAnchorSynergyRatio * 6.4 -
						metadataOnlyNoiseRatio * 2.4 +
						pathCoverageRatio * 6.2 +
						pathAnchorRatio * 3.4 +
						passageBestCoverageRatio * 6.4 +
						passageCorroboratedCoverageRatio * 9.6 +
						passageWindowCoverageRatio * 11.2 +
						passageWindowAnchorRatio * 1.8 +
						passageWindowCompactnessRatio * 8.6 +
						localExplanationCompetitionScore * 1.4 +
						localExplanationUnionCoverageRatio * 2.2 +
						localExplanationCorroboratedCoverageRatio * 1.8 +
						passageAnchorAgreementRatio * 2.6 -
						passageFragmentationRatio * 2.2 +
						-headingCrowdingPenalty +
						metadataLaneTier * 1.8 +
						metadataLaneScore * 0.12 +
						scriptFitScore * 0.5
					: Number.NEGATIVE_INFINITY;
				const bodyLocalAdjustedScore = mixedBodyPathIntent
					? bodyLocalScore - headingCrowdingPenalty * 0.9
					: bodyLocalScore;
				const mixedPathAdjustedScore = mixedBodyPathIntent
					? mixedPathScore - headingCrowdingPenalty * 0.65
					: mixedPathScore;
				const mixedTitleAdjustedScore = mixedBodyPathIntent
					? mixedTitleScore -
						headingCrowdingPenalty * 1.1
					: mixedTitleScore;
				return Math.max(
					bodyLocalAdjustedScore,
					mixedTitleAdjustedScore,
					mixedPathAdjustedScore,
					bodyPathScore,
				);
			}
			case "body_local":
			default:
				return bodyLocalScore;
		}
	}

	private applyMetadataExactPrefixLane(
		queryTerms: string[],
		prefixTerm: string | null,
		planner: FileSearchQueryPlanner,
		termStats: readonly FileSearchQueryTermStats[],
		fileStates: Map<number, FileCandidateState>,
	) {
		const laneFields = this.selectMetadataLaneFields(planner);
		if (laneFields.length === 0 || queryTerms.length === 0) {
			return;
		}

		const anchorIndex = this.selectMetadataLaneAnchorIndex(termStats, planner);
		const anchorTerm = queryTerms[anchorIndex];
		const anchorTerms = this.getMetadataLaneCandidateTerms(
			anchorTerm,
			prefixTerm === anchorTerm,
		);
		if (anchorTerms.length === 0) {
			return;
		}

		const candidateFileIds = new Set<number>();
		for (const laneField of laneFields) {
			for (const field of this.getMetadataLaneFieldComponents(laneField)) {
				for (const term of anchorTerms) {
					const postings = this.metadataTermPostings.get(term)?.get(field);
					if (!postings) {
						continue;
					}
					for (const fileId of postings.keys()) {
						candidateFileIds.add(fileId);
						if (candidateFileIds.size >= 384) {
							break;
						}
					}
					if (candidateFileIds.size >= 384) {
						break;
					}
				}
				if (candidateFileIds.size >= 384) {
					break;
				}
			}
			if (candidateFileIds.size >= 384) {
				break;
			}
		}

		for (const fileId of candidateFileIds) {
			let bestMatch: MetadataLaneMatch | null = null;
			for (const laneField of laneFields) {
				const match = this.evaluateMetadataLaneField(
					fileId,
					laneField,
					queryTerms,
					prefixTerm,
					planner,
				);
				if (!match) {
					continue;
				}
				if (
					!bestMatch ||
					match.tier > bestMatch.tier ||
					(match.tier === bestMatch.tier && match.score > bestMatch.score)
				) {
					bestMatch = match;
				}
			}
			if (!bestMatch) {
				continue;
			}

			const state = this.ensureFileState(fileStates, fileId);
			if (
				bestMatch.tier > state.metadataLaneTier ||
				(bestMatch.tier === state.metadataLaneTier &&
					bestMatch.score > state.metadataLaneScore)
			) {
				state.metadataLaneTier = bestMatch.tier;
				state.metadataLaneScore = bestMatch.score;
			}
			for (const term of bestMatch.matchedTerms) {
				state.matchedTerms.add(term);
			}
			for (const queryTermIndex of bestMatch.matchedQueryTermIndexes) {
				state.matchedQueryTerms.add(queryTermIndex);
				state.matchedMetadataQueryTerms.add(queryTermIndex);
				for (const field of bestMatch.constituentFields) {
					this.ensureFieldMatch(state, field).add(queryTermIndex);
				}
			}
			for (const queryTermIndex of bestMatch.expandedQueryTermIndexes) {
				state.matchedExpandedMetadataQueryTerms.add(queryTermIndex);
				for (const field of bestMatch.constituentFields) {
					this.ensureExpandedFieldMatch(state, field).add(queryTermIndex);
				}
			}
		}
	}

	private selectMetadataLaneFields(
		planner: FileSearchQueryPlanner,
	): MetadataLaneField[] {
		switch (planner.queryKind) {
			case "short_anchor":
				return ["basename", "aliases", "headings"];
			case "path_like":
				return [
					"folder_basename",
					"folder_aliases",
					"basename",
					"aliases",
					"headings",
				];
			default:
				return [];
		}
	}

	private selectMetadataLaneAnchorIndex(
		termStats: readonly FileSearchQueryTermStats[],
		planner: FileSearchQueryPlanner,
	): number {
		const preferred = termStats
			.filter((stat) => stat.hasAnyMatch)
			.filter(
				(stat) =>
					planner.anchorTermIndexes.size === 0 ||
					planner.anchorTermIndexes.has(stat.index),
			)
			.sort((left, right) => {
				const leftDf =
					left.matchedMetadataDocCount > 0
						? left.matchedMetadataDocCount
						: left.matchedDocCount;
				const rightDf =
					right.matchedMetadataDocCount > 0
						? right.matchedMetadataDocCount
						: right.matchedDocCount;
				if (leftDf !== rightDf) {
					return leftDf - rightDf;
				}
				return left.index - right.index;
			});
		return preferred[0]?.index ?? 0;
	}

	private getMetadataLaneCandidateTerms(
		queryTerm: string,
		allowPrefix: boolean,
	): string[] {
		const candidates = new Set<string>();
		if (queryTerm.length === 0) {
			return [];
		}
		candidates.add(queryTerm);
		if (allowPrefix) {
			for (const term of this.expandPrefixTerms(queryTerm).slice(0, 32)) {
				candidates.add(term);
			}
		}
		return Array.from(candidates);
	}

	private evaluateMetadataLaneField(
		fileId: number,
		laneField: MetadataLaneField,
		queryTerms: string[],
		prefixTerm: string | null,
		planner: FileSearchQueryPlanner,
	): MetadataLaneMatch | null {
		const metadataTokens = this.fileMetadataTokens.get(fileId);
		if (!metadataTokens) {
			return null;
		}

		const sequence = this.getMetadataLaneSequence(metadataTokens, laneField);
		const sequenceMatch = this.computeMetadataLaneSequenceMatch(
			sequence.tokens,
			queryTerms,
			prefixTerm,
			planner.queryKind === "path_like" &&
				(laneField === "folder_basename" || laneField === "folder_aliases"),
		);
		if (!sequenceMatch) {
			return null;
		}

		const tier = this.computeMetadataLaneTier(
			laneField,
			sequenceMatch.usedPrefix,
			planner,
		);
		const compactness = queryTerms.length / Math.max(1, sequence.tokens.length);
		const exactness = sequenceMatch.exactMatchCount / Math.max(1, queryTerms.length);
		return {
			tier,
			score:
				tier * 100 +
				compactness * 12 +
				exactness * 8 -
				sequenceMatch.startIndex * 0.35 -
				(sequenceMatch.spanLength - queryTerms.length) * 0.45,
			matchedTerms: sequenceMatch.matchedTerms,
			matchedQueryTermIndexes: new Set(
				queryTerms.map((_, index) => index),
			),
			expandedQueryTermIndexes: sequenceMatch.usedPrefix
				? new Set(
						queryTerms
							.map((term, index) => ({ term, index }))
							.filter(({ term }) => term === prefixTerm)
							.map(({ index }) => index),
					)
				: new Set<number>(),
			constituentFields: sequence.constituentFields,
		};
	}

	private getMetadataLaneSequence(
		metadataTokens: Record<MetadataField, string[]>,
		laneField: MetadataLaneField,
	): { tokens: string[]; constituentFields: MetadataField[] } {
		switch (laneField) {
			case "basename":
			case "aliases":
			case "headings":
				return {
					tokens: metadataTokens[laneField],
					constituentFields: [laneField],
				};
			case "folder_basename":
				return {
					tokens: [...metadataTokens.folder, ...metadataTokens.basename],
					constituentFields: ["folder", "basename"],
				};
			case "folder_aliases":
				return {
					tokens: [...metadataTokens.folder, ...metadataTokens.aliases],
					constituentFields: ["folder", "aliases"],
				};
		}
	}

	private getMetadataLaneFieldComponents(
		laneField: MetadataLaneField,
	): MetadataField[] {
		switch (laneField) {
			case "basename":
			case "aliases":
			case "headings":
				return [laneField];
			case "folder_basename":
				return ["folder", "basename"];
			case "folder_aliases":
				return ["folder", "aliases"];
		}
	}

	private computeMetadataLaneSequenceMatch(
		fieldTokens: readonly string[],
		queryTerms: readonly string[],
		prefixTerm: string | null,
		allowGaps: boolean,
	):
		| {
				startIndex: number;
				spanLength: number;
				exactMatchCount: number;
				usedPrefix: boolean;
				matchedTerms: string[];
		  }
		| null {
		if (fieldTokens.length === 0 || queryTerms.length === 0) {
			return null;
		}

		let bestMatch:
			| {
					startIndex: number;
					spanLength: number;
					exactMatchCount: number;
					usedPrefix: boolean;
					matchedTerms: string[];
			  }
			| null = null;
		for (let startIndex = 0; startIndex < fieldTokens.length; startIndex++) {
			if (!allowGaps && startIndex + queryTerms.length > fieldTokens.length) {
				break;
			}
			let exactMatchCount = 0;
			let usedPrefix = false;
			const matchedTerms: string[] = [];
			let matchedAll = true;
			let currentFieldIndex = startIndex;
			let endIndex = startIndex - 1;
			for (let offset = 0; offset < queryTerms.length; offset++) {
				const queryTerm = queryTerms[offset];
				const matchIndex = allowGaps
					? this.findMetadataLaneTokenMatch(
							fieldTokens,
							queryTerm,
							prefixTerm,
							currentFieldIndex,
						)
					: currentFieldIndex < fieldTokens.length
						? currentFieldIndex
						: -1;
				if (matchIndex < 0 || matchIndex >= fieldTokens.length) {
					matchedAll = false;
					break;
				}
				const fieldTerm = fieldTokens[matchIndex];
				if (fieldTerm === queryTerm) {
					exactMatchCount += 1;
					matchedTerms.push(fieldTerm);
				} else if (queryTerm === prefixTerm && fieldTerm.startsWith(queryTerm)) {
					usedPrefix = true;
					matchedTerms.push(fieldTerm);
				} else {
					matchedAll = false;
					break;
				}
				endIndex = matchIndex;
				currentFieldIndex = matchIndex + 1;
			}
			if (!matchedAll) {
				continue;
			}
			const spanLength = Math.max(1, endIndex - startIndex + 1);
			if (
				!bestMatch ||
				exactMatchCount > bestMatch.exactMatchCount ||
				(exactMatchCount === bestMatch.exactMatchCount &&
					Number(usedPrefix) < Number(bestMatch.usedPrefix)) ||
				(exactMatchCount === bestMatch.exactMatchCount &&
					usedPrefix === bestMatch.usedPrefix &&
					spanLength < bestMatch.spanLength) ||
				(exactMatchCount === bestMatch.exactMatchCount &&
					usedPrefix === bestMatch.usedPrefix &&
					spanLength === bestMatch.spanLength &&
					startIndex < bestMatch.startIndex)
			) {
				bestMatch = {
					startIndex,
					spanLength,
					exactMatchCount,
					usedPrefix,
					matchedTerms,
				};
			}
		}
		return bestMatch;
	}

	private findMetadataLaneTokenMatch(
		fieldTokens: readonly string[],
		queryTerm: string,
		prefixTerm: string | null,
		startIndex: number,
	): number {
		for (let index = startIndex; index < fieldTokens.length; index++) {
			const fieldTerm = fieldTokens[index];
			if (fieldTerm === queryTerm) {
				return index;
			}
			if (queryTerm === prefixTerm && fieldTerm.startsWith(queryTerm)) {
				return index;
			}
		}
		return -1;
	}

	private computeMetadataLaneTier(
		laneField: MetadataLaneField,
		usedPrefix: boolean,
		planner: FileSearchQueryPlanner,
	): number {
		switch (laneField) {
			case "basename":
				return usedPrefix ? 7 : 8;
			case "aliases":
				return usedPrefix ? 6 : 7;
			case "folder_basename":
				return planner.queryKind === "path_like"
					? usedPrefix
						? 6
						: 7
					: usedPrefix
						? 5
						: 6;
			case "folder_aliases":
				return planner.queryKind === "path_like"
					? usedPrefix
						? 5
						: 6
					: usedPrefix
						? 4
						: 5;
			case "headings":
				return usedPrefix ? 3 : 4;
		}
	}

	private shouldRouteShortAnchorResults(
		results: ReadonlyArray<RankedMatchedFile>,
	): boolean {
		for (const result of results) {
			if (
				result.shortAnchorLaneTier >= 2 ||
				result.shortAnchorLaneScore >= FILE_SHORT_TITLE_ROUTE_THRESHOLD
			) {
				return true;
			}
		}
		return false;
	}

	private buildScriptProfile(text: string): ScriptProfile {
		return {
			hasLatin: /[a-z]/iu.test(text),
			hasHan: /\p{Script=Han}/u.test(text),
		};
	}

	private computeScriptFitScore(
		fileId: number,
		queryScriptProfile: ScriptProfile,
	): number {
		const fileScriptProfile = this.fileScriptProfiles.get(fileId);
		if (!fileScriptProfile) {
			return 0;
		}
		if (queryScriptProfile.hasLatin && !queryScriptProfile.hasHan) {
			if (fileScriptProfile.hasLatin && !fileScriptProfile.hasHan) {
				return 0.4;
			}
			if (fileScriptProfile.hasLatin) {
				return 0.15;
			}
			if (fileScriptProfile.hasHan) {
				return -0.2;
			}
		}
		if (queryScriptProfile.hasHan && !queryScriptProfile.hasLatin) {
			if (fileScriptProfile.hasHan && !fileScriptProfile.hasLatin) {
				return 0.4;
			}
			if (fileScriptProfile.hasHan) {
				return 0.15;
			}
			if (fileScriptProfile.hasLatin) {
				return -0.2;
			}
		}
		return 0;
	}

	private computePathLocaleFitScore(
		filePath: string,
		queryTerms: readonly string[],
		queryScriptProfile: ScriptProfile,
	): number {
		const pathLocale = this.detectPathLocale(filePath);
		if (!pathLocale) {
			return 0;
		}
		const preference = this.getQueryLocalePreference(
			queryTerms,
			queryScriptProfile,
		);
		if (!preference.locale) {
			return 0;
		}
		if (preference.explicit) {
			if (pathLocale === preference.locale) {
				return preference.locale === "zh" ? 0.65 : 0.45;
			}
			return preference.locale === "zh" ? -0.35 : -0.65;
		}
		if (pathLocale === preference.locale) {
			return 0.7;
		}
		return -0.95;
	}

	private getQueryLocalePreference(
		queryTerms: readonly string[],
		queryScriptProfile: ScriptProfile,
	): QueryLocalePreference {
		const normalizedTerms = new Set(queryTerms.map((term) => term.toLowerCase()));
		const hasExplicitZhHint =
			normalizedTerms.has("zh") ||
			normalizedTerms.has("zh-cn") ||
			normalizedTerms.has("cn");
		const hasExplicitEnHint = normalizedTerms.has("en");
		if (hasExplicitZhHint && !hasExplicitEnHint) {
			return { locale: "zh", explicit: true };
		}
		if (hasExplicitEnHint && !hasExplicitZhHint) {
			return { locale: "en", explicit: true };
		}
		if (queryScriptProfile.hasLatin && !queryScriptProfile.hasHan) {
			return { locale: "en", explicit: false };
		}
		if (queryScriptProfile.hasHan && !queryScriptProfile.hasLatin) {
			return { locale: "zh", explicit: false };
		}
		return { locale: null, explicit: false };
	}

	private detectPathLocale(filePath: string): "en" | "zh" | null {
		const normalizedPath = filePath.toLowerCase();
		if (
			/(^|\/)(zh|zh-cn)(\/|$)/u.test(normalizedPath) ||
			/(^|\/)tech-zh(\/|$)/u.test(normalizedPath)
		) {
			return "zh";
		}
		if (
			/(^|\/)en(\/|$)/u.test(normalizedPath) ||
			/(^|\/)tech-en(\/|$)/u.test(normalizedPath)
		) {
			return "en";
		}
		return null;
	}

	private areMirrorLocaleVariants(leftPath: string, rightPath: string): boolean {
		return (
			this.normalizeMirrorLocalePath(leftPath) ===
			this.normalizeMirrorLocalePath(rightPath)
		);
	}

	private normalizeMirrorLocalePath(filePath: string): string {
		return filePath
			.toLowerCase()
			.replace(/(^|\/)tech-(?:en|zh)(?=\/|$)/gu, "$1tech-__locale__")
			.replace(/(^|\/)(?:en|zh-cn|zh)(?=\/|$)/gu, "$1__locale__");
	}

	private computeShortAnchorLaneTier(params: {
		planner: FileSearchQueryPlanner | null;
		basenameAliasExactRatio: number;
		basenameAliasExpandedRatio: number;
		headingExactRatio: number;
		headingExpandedRatio: number;
	}): number {
		const {
			planner,
			basenameAliasExactRatio,
			basenameAliasExpandedRatio,
			headingExactRatio,
			headingExpandedRatio,
		} = params;
		if (planner?.queryKind !== "short_anchor") {
			return 0;
		}
		if (basenameAliasExactRatio >= 0.999) {
			return 5;
		}
		if (
			basenameAliasExactRatio > 0 &&
			basenameAliasExactRatio + basenameAliasExpandedRatio >= 0.999
		) {
			return 4;
		}
		if (basenameAliasExpandedRatio >= 0.999) {
			return 3;
		}
		if (
			headingExactRatio > 0 &&
			headingExactRatio + headingExpandedRatio >= 0.999
		) {
			return 2;
		}
		if (headingExpandedRatio >= 0.999) {
			return 1;
		}
		return 0;
	}

	private insertWordTerm(term: string) {
		const index = lowerBoundString(this.sortedWordTerms, term);
		if (this.sortedWordTerms[index] !== term) {
			this.sortedWordTerms.splice(index, 0, term);
		}
	}

	private removeWordTerm(term: string) {
		const index = lowerBoundString(this.sortedWordTerms, term);
		if (this.sortedWordTerms[index] === term) {
			this.sortedWordTerms.splice(index, 1);
		}
	}

	private insertCharTerm(term: string) {
		const index = lowerBoundString(this.sortedCharTerms, term);
		if (this.sortedCharTerms[index] !== term) {
			this.sortedCharTerms.splice(index, 0, term);
		}
	}

	private removeCharTerm(term: string) {
		const index = lowerBoundString(this.sortedCharTerms, term);
		if (this.sortedCharTerms[index] === term) {
			this.sortedCharTerms.splice(index, 1);
		}
	}

	private getUnionFieldMatches(
		state: FileCandidateState,
		fields: ReadonlyArray<SearchField>,
	): Set<number> {
		const union = new Set<number>();
		for (const field of fields) {
			for (const value of state.matchedQueryTermsByField.get(field) ?? []) {
				union.add(value);
			}
		}
		return union;
	}

	private getUnionExpandedFieldMatches(
		state: FileCandidateState,
		fields: ReadonlyArray<SearchField>,
	): Set<number> {
		const union = new Set<number>();
		for (const field of fields) {
			for (const value of state.matchedExpandedQueryTermsByField.get(field) ?? []) {
				union.add(value);
			}
		}
		return union;
	}

	private getMetadataFieldTokenCount(
		fileId: number,
		fields: ReadonlyArray<MetadataField>,
	): number {
		const metadataTokens = this.fileMetadataTokens.get(fileId);
		if (!metadataTokens) {
			return 0;
		}
		let count = 0;
		for (const field of fields) {
			count += metadataTokens[field]?.length ?? 0;
		}
		return count;
	}

	private createQueryScoringCache(): QueryScoringCache {
		return {
			positionsByPassageId: new Map<number, Map<number, number[]>>(),
			localWindowSetsByPassageId: new Map<number, QueryConditionedLocalWindowSet>(),
		};
	}

	private shouldUseLocalWindowScoring(params: {
		queryTerms: readonly string[];
		planner: FileSearchQueryPlanner | null;
		matchedQueryTermsCount: number;
	}): boolean {
		const { queryTerms, planner, matchedQueryTermsCount } = params;
		if (queryTerms.length <= 2 || matchedQueryTermsCount <= 1) {
			return false;
		}
		if (
			planner?.queryKind === "short_anchor" ||
			planner?.queryKind === "path_like"
		) {
			return false;
		}
		if (planner?.queryKind === "sentence_like") {
			return true;
		}
		return matchedQueryTermsCount >= 3;
	}

	private getCachedPassagePositionsByQueryTerm(params: {
		passage: PassageRecord;
		matchedQueryTerms: ReadonlySet<number>;
		matchedTermsByQueryTerm: ReadonlyMap<number, ReadonlySet<string>>;
		queryTerms: readonly string[];
		queryScoringCache: QueryScoringCache;
	}): Map<number, number[]> {
		const {
			passage,
			matchedQueryTerms,
			matchedTermsByQueryTerm,
			queryTerms,
			queryScoringCache,
		} = params;
		const cached = queryScoringCache.positionsByPassageId.get(passage.id);
		if (cached) {
			return cached;
		}
		const positionsByQueryTerm = this.collectPositionsByMatchedTerms(
			passage.tokenSequence,
			matchedQueryTerms,
			matchedTermsByQueryTerm,
			queryTerms,
		);
		queryScoringCache.positionsByPassageId.set(passage.id, positionsByQueryTerm);
		return positionsByQueryTerm;
	}

	private getLocalWindowSetForPassage(params: {
		passage: PassageRecord;
		matchedQueryTerms: ReadonlySet<number>;
		matchedTermsByQueryTerm: ReadonlyMap<number, ReadonlySet<string>>;
		exactMatchedQueryTerms: ReadonlySet<number>;
		queryTerms: readonly string[];
		planner: FileSearchQueryPlanner | null;
		queryTermWeights: QueryTermWeightMap;
		totalQueryWeight: number;
		queryScoringCache: QueryScoringCache;
		computeIfMissing: boolean;
	}): QueryConditionedLocalWindowSet {
		const {
			passage,
			matchedQueryTerms,
			matchedTermsByQueryTerm,
			exactMatchedQueryTerms,
			queryTerms,
			planner,
			queryTermWeights,
			totalQueryWeight,
			queryScoringCache,
			computeIfMissing,
		} = params;
		if (
			!this.shouldUseLocalWindowScoring({
				queryTerms,
				planner,
				matchedQueryTermsCount: matchedQueryTerms.size,
			})
		) {
			return EMPTY_LOCAL_WINDOW_SET;
		}
		const cached = queryScoringCache.localWindowSetsByPassageId.get(passage.id);
		if (cached) {
			return cached;
		}
		if (!computeIfMissing) {
			return EMPTY_LOCAL_WINDOW_SET;
		}
		const positionsByQueryTerm = this.getCachedPassagePositionsByQueryTerm({
			passage,
			matchedQueryTerms,
			matchedTermsByQueryTerm,
			queryTerms,
			queryScoringCache,
		});
		if (positionsByQueryTerm.size <= 1) {
			return EMPTY_LOCAL_WINDOW_SET;
		}
		const signals = this.computeQueryConditionedLocalWindowSet(
			positionsByQueryTerm,
			exactMatchedQueryTerms,
			planner,
			queryTermWeights,
			totalQueryWeight,
		);
		queryScoringCache.localWindowSetsByPassageId.set(passage.id, signals);
		return signals;
	}

	private getLocalWindowSignalsForPassage(params: {
		passage: PassageRecord;
		matchedQueryTerms: ReadonlySet<number>;
		matchedTermsByQueryTerm: ReadonlyMap<number, ReadonlySet<string>>;
		exactMatchedQueryTerms: ReadonlySet<number>;
		queryTerms: readonly string[];
		planner: FileSearchQueryPlanner | null;
		queryTermWeights: QueryTermWeightMap;
		totalQueryWeight: number;
		queryScoringCache: QueryScoringCache;
		computeIfMissing: boolean;
	}): LocalWindowSignals {
		return this.getLocalWindowSetForPassage(params).bestSignals;
	}

	private computePassageSetSignals(params: {
		state: FileCandidateState;
		queryTerms: readonly string[];
		planner: FileSearchQueryPlanner | null;
		queryTermWeights: QueryTermWeightMap;
		totalQueryWeight: number;
		queryScoringCache: QueryScoringCache;
	}): FilePassageSetSignals {
		const {
			state,
			queryTerms,
			planner,
			queryTermWeights,
			totalQueryWeight,
			queryScoringCache,
		} = params;
		const evidences = state.topPassageEvidences.slice(0, MAX_FILE_PASSAGE_EVIDENCES);
		if (evidences.length === 0) {
			return {
				score: 0,
				bestCoverageRatio: 0,
				unionCoverageRatio: 0,
				corroboratedCoverageRatio: 0,
				exactUnionCoverageRatio: 0,
				decisivePassageRatio: 0,
				anchorAgreementRatio: 0,
				fragmentationRatio: 0,
				bestWindowCoverageRatio: 0,
				bestWindowAnchorRatio: 0,
				bestWindowCompactnessRatio: 0,
				localExplanationCompetitionScore: 0,
				localExplanationUnionCoverageRatio: 0,
				localExplanationCorroboratedCoverageRatio: 0,
				localExplanationAnchorRatio: 0,
				localExplanationCompactnessRatio: 0,
			};
		}

		const bestEvidence = evidences[0];
		const secondScore = evidences[1]?.score ?? 0;
		const bestMatchedWeight = getSetWeight(
			bestEvidence.matchedQueryTerms,
			queryTermWeights,
		);
		const bestCoverageRatio = bestMatchedWeight / totalQueryWeight;
		const unionMatchedQueryTerms = new Set<number>();
		const corroboratedQueryTerms = new Set<number>();
		const exactUnionQueryTerms = new Set<number>();
		const evidenceMatchCounts = new Map<number, number>();
		const anchorTermWeight =
			planner && planner.anchorTermIndexes.size > 0
				? getSetWeight(planner.anchorTermIndexes, queryTermWeights)
				: 0;
		let supportingEvidenceRatio = 0;
		let diffuseEvidenceRatio = 0;
		let bestWindowCoverageRatio = 0;
		let bestWindowAnchorRatio = 0;
		let bestWindowCompactnessRatio = 0;
		const bestPassage = this.passageById.get(bestEvidence.passageId);
		const bestLocalWindowSet = bestPassage
			? this.getLocalWindowSetForPassage({
					passage: bestPassage,
					matchedQueryTerms: bestEvidence.matchedQueryTerms,
					matchedTermsByQueryTerm: bestEvidence.matchedTermsByQueryTerm,
					exactMatchedQueryTerms: bestEvidence.exactMatchedQueryTerms,
					queryTerms,
					planner,
					queryTermWeights,
					totalQueryWeight,
					queryScoringCache,
					computeIfMissing: false,
				})
			: EMPTY_LOCAL_WINDOW_SET;
		const bestLocalWindowSignals = bestLocalWindowSet.bestSignals;
		bestWindowCoverageRatio = bestLocalWindowSignals.coverageRatio;
		bestWindowAnchorRatio = bestLocalWindowSignals.anchorCoverageRatio;
		bestWindowCompactnessRatio = bestLocalWindowSignals.compactnessRatio;
		const fileLocalExplanationSignals = this.computeFileLocalExplanationSignals({
			evidences,
			queryTerms,
			planner,
			queryTermWeights,
			totalQueryWeight,
			queryScoringCache,
		});

		for (let evidenceIndex = 0; evidenceIndex < evidences.length; evidenceIndex++) {
			const evidence = evidences[evidenceIndex];
			for (const queryTermIndex of evidence.matchedQueryTerms) {
				unionMatchedQueryTerms.add(queryTermIndex);
				const nextCount = (evidenceMatchCounts.get(queryTermIndex) ?? 0) + 1;
				evidenceMatchCounts.set(queryTermIndex, nextCount);
				if (nextCount >= 2) {
					corroboratedQueryTerms.add(queryTermIndex);
				}
			}
			for (const queryTermIndex of evidence.exactMatchedQueryTerms) {
				exactUnionQueryTerms.add(queryTermIndex);
			}
			if (evidenceIndex === 0) {
				continue;
			}

			const evidenceMatchedWeight = getSetWeight(
				evidence.matchedQueryTerms,
				queryTermWeights,
			);
			if (evidenceMatchedWeight <= 0) {
				continue;
			}

			const overlapWeight = getOverlapWeight(
				evidence.matchedQueryTerms,
				bestEvidence.matchedQueryTerms,
				queryTermWeights,
			);
			const overlapRatio =
				overlapWeight /
				Math.max(
					0.000001,
					Math.min(bestMatchedWeight, evidenceMatchedWeight),
				);
			const anchorOverlapRatio =
				anchorTermWeight > 0 && planner
					? getOverlapWeight(
							evidence.matchedQueryTerms,
							planner.anchorTermIndexes,
							queryTermWeights,
						) / anchorTermWeight
					: 0;
			const evidenceScoreRatio =
				Math.min(1.25, evidence.score / Math.max(0.000001, bestEvidence.score));
			const rankDecay = Math.max(0.34, 1 - evidenceIndex * 0.18);
			const alignmentRatio = Math.min(
				1,
				overlapRatio * 0.78 + anchorOverlapRatio * 0.32,
			);
			const localWindowSignals =
				queryScoringCache.localWindowSetsByPassageId.get(evidence.passageId)
					?.bestSignals;
			const localWindowSupport =
				localWindowSignals?.coverageRatio ??
				Math.min(1, evidenceMatchedWeight / totalQueryWeight);
			const localWindowCompactness =
				localWindowSignals?.compactnessRatio ??
				Math.min(1, alignmentRatio * 0.9 + localWindowSupport * 0.35);
			supportingEvidenceRatio +=
				evidenceScoreRatio *
				alignmentRatio *
				Math.max(0.35, localWindowSupport * 0.8 + localWindowCompactness * 0.45) *
				rankDecay;
			diffuseEvidenceRatio +=
				evidenceScoreRatio *
				Math.max(
					0,
					(1 - alignmentRatio) * (1 - Math.min(1, localWindowCompactness * 0.85)),
				) *
				rankDecay;
		}

		const unionCoverageRatio =
			getSetWeight(unionMatchedQueryTerms, queryTermWeights) / totalQueryWeight;
		const corroboratedCoverageRatio =
			getSetWeight(corroboratedQueryTerms, queryTermWeights) / totalQueryWeight;
		const exactUnionCoverageRatio =
			getSetWeight(exactUnionQueryTerms, queryTermWeights) / totalQueryWeight;
		const decisivePassageRatio = Math.max(
			0,
			Math.min(
				1,
				(bestEvidence.score - secondScore * 0.92) /
					Math.max(0.000001, bestEvidence.score),
			),
		);
		const bestAnchorRatio =
			anchorTermWeight > 0 && planner
				? getOverlapWeight(
						bestEvidence.matchedQueryTerms,
						planner.anchorTermIndexes,
						queryTermWeights,
					) / anchorTermWeight
				: 0;
		const corroboratedAnchorRatio =
			anchorTermWeight > 0 && planner
				? getOverlapWeight(
						corroboratedQueryTerms,
						planner.anchorTermIndexes,
						queryTermWeights,
					) / anchorTermWeight
				: 0;
		const metadataAnchorRatio =
			anchorTermWeight > 0 && planner
				? getOverlapWeight(
						state.matchedMetadataQueryTerms,
						planner.anchorTermIndexes,
						queryTermWeights,
					) / anchorTermWeight
				: 0;
		const anchorAgreementRatio =
			anchorTermWeight > 0
				? Math.min(
						1,
						(bestAnchorRatio * 0.72 + corroboratedAnchorRatio * 0.28) *
							Math.max(0.4, metadataAnchorRatio),
					)
				: 0;
		const fragmentationRatio = Math.max(
			0,
			unionCoverageRatio -
				bestCoverageRatio -
				corroboratedCoverageRatio * 0.35,
		);
		const score =
			bestCoverageRatio * FILE_PASSAGE_SET_BEST_COVERAGE_BONUS +
			unionCoverageRatio * FILE_PASSAGE_SET_UNION_COVERAGE_BONUS +
			corroboratedCoverageRatio * FILE_PASSAGE_SET_CORROBORATED_COVERAGE_BONUS +
			exactUnionCoverageRatio * FILE_PASSAGE_SET_EXACT_COVERAGE_BONUS +
			decisivePassageRatio * FILE_PASSAGE_SET_DECISIVE_BONUS +
			bestWindowCoverageRatio * 0.92 +
			bestWindowAnchorRatio * 0.52 +
			bestWindowCompactnessRatio * 0.66 +
			Math.min(1.25, supportingEvidenceRatio) * FILE_PASSAGE_SET_SUPPORT_BONUS +
			anchorAgreementRatio * FILE_PASSAGE_SET_ANCHOR_AGREEMENT_BONUS -
			fragmentationRatio * FILE_PASSAGE_SET_FRAGMENTATION_PENALTY -
			Math.min(1.25, diffuseEvidenceRatio) *
				FILE_PASSAGE_SET_DIFFUSE_SUPPORT_PENALTY;

		return {
			score,
			bestCoverageRatio,
			unionCoverageRatio,
			corroboratedCoverageRatio,
			exactUnionCoverageRatio,
			decisivePassageRatio,
			anchorAgreementRatio,
			fragmentationRatio,
			bestWindowCoverageRatio,
			bestWindowAnchorRatio,
			bestWindowCompactnessRatio,
			localExplanationCompetitionScore:
				fileLocalExplanationSignals.competitionScore,
			localExplanationUnionCoverageRatio:
				fileLocalExplanationSignals.unionCoverageRatio,
			localExplanationCorroboratedCoverageRatio:
				fileLocalExplanationSignals.corroboratedCoverageRatio,
			localExplanationAnchorRatio:
				fileLocalExplanationSignals.anchorCoverageRatio,
			localExplanationCompactnessRatio:
				fileLocalExplanationSignals.compactnessRatio,
		};
	}

	private computeQueryConditionedLocalWindowSet(
		positionsByQueryTerm: ReadonlyMap<number, number[]>,
		exactMatchedQueryTerms: ReadonlySet<number>,
		planner: FileSearchQueryPlanner | null,
		queryTermWeights: QueryTermWeightMap,
		totalQueryWeight: number,
	): QueryConditionedLocalWindowSet {
		const occurrences: Array<{ position: number; queryTermIndex: number }> = [];
		for (const [queryTermIndex, positions] of positionsByQueryTerm) {
			for (const position of positions) {
				occurrences.push({ position, queryTermIndex });
			}
		}
		if (occurrences.length === 0) {
			return EMPTY_LOCAL_WINDOW_SET;
		}
		occurrences.sort((left, right) => left.position - right.position);
		const anchorWeight =
			planner && planner.anchorTermIndexes.size > 0
				? getSetWeight(planner.anchorTermIndexes, queryTermWeights)
				: 0;
		const maxWindowSpan = Math.min(
			LOCAL_WINDOW_MAX_SPAN_LIMIT,
			Math.max(
				LOCAL_WINDOW_BASE_SPAN,
				positionsByQueryTerm.size * LOCAL_WINDOW_SPAN_PER_TERM +
					LOCAL_WINDOW_BASE_SPAN,
			),
		);
		const explanations: LocalWindowExplanation[] = [];
		for (let leftIndex = 0; leftIndex < occurrences.length; leftIndex++) {
			const windowPositions = new Map<number, number[]>();
			for (let rightIndex = leftIndex; rightIndex < occurrences.length; rightIndex++) {
				const left = occurrences[leftIndex];
				const right = occurrences[rightIndex];
				const span = right.position - left.position + 1;
				if (span > maxWindowSpan) {
					break;
				}
				let termPositions = windowPositions.get(right.queryTermIndex);
				if (!termPositions) {
					termPositions = [];
					windowPositions.set(right.queryTermIndex, termPositions);
				}
				termPositions.push(right.position);
				const windowMatchedQueryTerms = new Set<number>(windowPositions.keys());
				const matchedWeight = getSetWeight(
					windowMatchedQueryTerms,
					queryTermWeights,
				);
				const coverageRatio = matchedWeight / totalQueryWeight;
				const exactCoverageRatio =
					getOverlapWeight(
						windowMatchedQueryTerms,
						exactMatchedQueryTerms,
						queryTermWeights,
					) / totalQueryWeight;
				const anchorCoverageRatio =
					anchorWeight > 0 && planner
						? getOverlapWeight(
								windowMatchedQueryTerms,
								planner.anchorTermIndexes,
								queryTermWeights,
							) / anchorWeight
						: 0;
				const compactnessRatio = Math.min(
					1.35,
					(matchedWeight / Math.max(1, span)) * 2.6,
				);
				const orderedRatio = computeOrderedRatio(windowPositions);
				const tightOrderedPairRatio =
					computeTightOrderedPairRatio(windowPositions);
				const rareTermLift = computeRareTermLift(
					windowPositions,
					queryTermWeights,
				);
				const score =
					coverageRatio * LOCAL_WINDOW_COVERAGE_WEIGHT +
					exactCoverageRatio * LOCAL_WINDOW_EXACT_WEIGHT +
					anchorCoverageRatio * LOCAL_WINDOW_ANCHOR_WEIGHT +
					compactnessRatio * LOCAL_WINDOW_COMPACTNESS_WEIGHT +
					orderedRatio * LOCAL_WINDOW_ORDER_WEIGHT +
					tightOrderedPairRatio * LOCAL_WINDOW_TIGHT_PAIR_WEIGHT +
					rareTermLift * LOCAL_WINDOW_RARE_TERM_WEIGHT;
				this.insertLocalWindowExplanation(
					explanations,
					{
						score,
						coverageRatio,
						exactCoverageRatio,
						anchorCoverageRatio,
						compactnessRatio,
						startPosition: left.position,
						endPosition: right.position,
						matchedQueryTerms: windowMatchedQueryTerms,
					},
					queryTermWeights,
				);
			}
		}
		return this.buildLocalWindowSet(
			explanations,
			queryTermWeights,
			totalQueryWeight,
		);
	}

	private insertLocalWindowExplanation(
		explanations: LocalWindowExplanation[],
		candidate: LocalWindowExplanation,
		queryTermWeights: QueryTermWeightMap,
	) {
		for (let index = 0; index < explanations.length; index++) {
			const existing = explanations[index];
			if (
				!this.areLocalWindowExplanationsDuplicate(
					existing,
					candidate,
					queryTermWeights,
				)
			) {
				continue;
			}
			if (this.isBetterLocalWindowExplanation(candidate, existing)) {
				explanations[index] = candidate;
			}
			explanations.sort((left, right) =>
				this.compareLocalWindowExplanations(left, right),
			);
			if (explanations.length > MAX_LOCAL_WINDOW_EXPLANATIONS_PER_PASSAGE) {
				explanations.length = MAX_LOCAL_WINDOW_EXPLANATIONS_PER_PASSAGE;
			}
			return;
		}
		explanations.push(candidate);
		explanations.sort((left, right) =>
			this.compareLocalWindowExplanations(left, right),
		);
		if (explanations.length > MAX_LOCAL_WINDOW_EXPLANATIONS_PER_PASSAGE) {
			explanations.length = MAX_LOCAL_WINDOW_EXPLANATIONS_PER_PASSAGE;
		}
	}

	private buildLocalWindowSet(
		explanations: readonly LocalWindowExplanation[],
		queryTermWeights: QueryTermWeightMap,
		totalQueryWeight: number,
	): QueryConditionedLocalWindowSet {
		if (explanations.length === 0) {
			return EMPTY_LOCAL_WINDOW_SET;
		}
		const unionMatchedQueryTerms = new Set<number>();
		const corroboratedQueryTerms = new Set<number>();
		const explanationMatchCounts = new Map<number, number>();
		let competitionScore = 0;
		let anchorCoverageRatio = 0;
		let compactnessRatio = 0;
		let decayWeightSum = 0;
		for (let index = 0; index < explanations.length; index++) {
			const explanation = explanations[index];
			const decay = index === 0 ? 1 : index === 1 ? 0.62 : 0.38;
			competitionScore += explanation.score * decay;
			anchorCoverageRatio += explanation.anchorCoverageRatio * decay;
			compactnessRatio += explanation.compactnessRatio * decay;
			decayWeightSum += decay;
			for (const queryTermIndex of explanation.matchedQueryTerms) {
				unionMatchedQueryTerms.add(queryTermIndex);
				const nextCount = (explanationMatchCounts.get(queryTermIndex) ?? 0) + 1;
				explanationMatchCounts.set(queryTermIndex, nextCount);
				if (nextCount >= 2) {
					corroboratedQueryTerms.add(queryTermIndex);
				}
			}
		}
		const unionCoverageRatio =
			getSetWeight(unionMatchedQueryTerms, queryTermWeights) / totalQueryWeight;
		const corroboratedCoverageRatio =
			getSetWeight(corroboratedQueryTerms, queryTermWeights) / totalQueryWeight;
		const weightedAnchorCoverageRatio =
			decayWeightSum > 0 ? anchorCoverageRatio / decayWeightSum : 0;
		const weightedCompactnessRatio =
			decayWeightSum > 0 ? compactnessRatio / decayWeightSum : 0;
		const bestSignals = explanations[0];
		return {
			bestSignals: {
				score: bestSignals.score,
				coverageRatio: bestSignals.coverageRatio,
				exactCoverageRatio: bestSignals.exactCoverageRatio,
				anchorCoverageRatio: bestSignals.anchorCoverageRatio,
				compactnessRatio: bestSignals.compactnessRatio,
			},
			explanations: [...explanations],
			competitionScore:
				competitionScore +
				unionCoverageRatio * 0.92 +
				corroboratedCoverageRatio * 0.74 +
				weightedAnchorCoverageRatio * 0.52 +
				weightedCompactnessRatio * 0.48,
			unionCoverageRatio,
			corroboratedCoverageRatio,
			anchorCoverageRatio: weightedAnchorCoverageRatio,
			compactnessRatio: weightedCompactnessRatio,
		};
	}

	private computeFileLocalExplanationSignals(params: {
		evidences: readonly FilePassageEvidence[];
		queryTerms: readonly string[];
		planner: FileSearchQueryPlanner | null;
		queryTermWeights: QueryTermWeightMap;
		totalQueryWeight: number;
		queryScoringCache: QueryScoringCache;
	}): {
		competitionScore: number;
		unionCoverageRatio: number;
		corroboratedCoverageRatio: number;
		anchorCoverageRatio: number;
		compactnessRatio: number;
	} {
		const {
			evidences,
			queryTerms,
			planner,
			queryTermWeights,
			totalQueryWeight,
			queryScoringCache,
		} = params;
		if (evidences.length === 0) {
			return {
				competitionScore: 0,
				unionCoverageRatio: 0,
				corroboratedCoverageRatio: 0,
				anchorCoverageRatio: 0,
				compactnessRatio: 0,
			};
		}
		const bestEvidenceScore = evidences[0]?.score ?? 0;
		const candidates: FileLocalExplanationCandidate[] = [];
		for (let evidenceIndex = 0; evidenceIndex < evidences.length; evidenceIndex++) {
			const evidence = evidences[evidenceIndex];
			const passage = this.passageById.get(evidence.passageId);
			if (!passage) {
				continue;
			}
			const localWindowSet = this.getLocalWindowSetForPassage({
				passage,
				matchedQueryTerms: evidence.matchedQueryTerms,
				matchedTermsByQueryTerm: evidence.matchedTermsByQueryTerm,
				exactMatchedQueryTerms: evidence.exactMatchedQueryTerms,
				queryTerms,
				planner,
				queryTermWeights,
				totalQueryWeight,
				queryScoringCache,
				computeIfMissing: false,
			});
			if (localWindowSet.explanations.length === 0) {
				continue;
			}
			const evidenceScoreRatio =
				bestEvidenceScore > 0
					? Math.min(
							1.2,
							evidence.score / Math.max(0.000001, bestEvidenceScore),
						)
					: 1;
			const evidenceRankDecay = Math.max(0.48, 1 - evidenceIndex * 0.16);
			for (
				let explanationIndex = 0;
				explanationIndex < localWindowSet.explanations.length;
				explanationIndex++
			) {
				const explanation = localWindowSet.explanations[explanationIndex];
				const explanationRankDecay =
					explanationIndex === 0
						? 1
						: explanationIndex === 1
							? 0.76
							: 0.58;
				candidates.push({
					...explanation,
					passageId: evidence.passageId,
					weightedScore:
						explanation.score *
						evidenceScoreRatio *
						evidenceRankDecay *
						explanationRankDecay,
				});
			}
		}
		if (candidates.length === 0) {
			return {
				competitionScore: 0,
				unionCoverageRatio: 0,
				corroboratedCoverageRatio: 0,
				anchorCoverageRatio: 0,
				compactnessRatio: 0,
			};
		}
		candidates.sort((left, right) => {
			if (right.weightedScore !== left.weightedScore) {
				return right.weightedScore - left.weightedScore;
			}
			return this.compareLocalWindowExplanations(left, right);
		});
		const selected: FileLocalExplanationCandidate[] = [];
		for (const candidate of candidates) {
			const duplicateIndex = selected.findIndex((existing) =>
				this.areFileLocalExplanationCandidatesDuplicate(
					existing,
					candidate,
					queryTermWeights,
				),
			);
			if (duplicateIndex >= 0) {
				if (
					candidate.weightedScore > selected[duplicateIndex].weightedScore ||
					(candidate.weightedScore === selected[duplicateIndex].weightedScore &&
						this.isBetterLocalWindowExplanation(
							candidate,
							selected[duplicateIndex],
						))
				) {
					selected[duplicateIndex] = candidate;
				}
				continue;
			}
			selected.push(candidate);
			if (selected.length >= MAX_FILE_LOCAL_EXPLANATIONS) {
				break;
			}
		}
		selected.sort((left, right) => {
			if (right.weightedScore !== left.weightedScore) {
				return right.weightedScore - left.weightedScore;
			}
			return this.compareLocalWindowExplanations(left, right);
		});
		const unionMatchedQueryTerms = new Set<number>();
		const corroboratedQueryTerms = new Set<number>();
		const explanationMatchCounts = new Map<number, number>();
		const explainedQueryTerms = new Set<number>();
		let competitionScore = 0;
		let anchorCoverageRatio = 0;
		let compactnessRatio = 0;
		let decayWeightSum = 0;
		for (let index = 0; index < selected.length; index++) {
			const explanation = selected[index];
			const decay = index === 0 ? 1 : index === 1 ? 0.68 : 0.42;
			const explanationWeight = getSetWeight(
				explanation.matchedQueryTerms,
				queryTermWeights,
			);
			const novelQueryTerms = new Set<number>();
			for (const queryTermIndex of explanation.matchedQueryTerms) {
				if (!explainedQueryTerms.has(queryTermIndex)) {
					novelQueryTerms.add(queryTermIndex);
				}
			}
			const noveltyRatio =
				explanationWeight > 0
					? getSetWeight(novelQueryTerms, queryTermWeights) / explanationWeight
					: 0;
			competitionScore +=
				explanation.weightedScore * decay * (0.34 + noveltyRatio * 0.66);
			anchorCoverageRatio += explanation.anchorCoverageRatio * decay;
			compactnessRatio += explanation.compactnessRatio * decay;
			decayWeightSum += decay;
			for (const queryTermIndex of explanation.matchedQueryTerms) {
				explainedQueryTerms.add(queryTermIndex);
				unionMatchedQueryTerms.add(queryTermIndex);
				const nextCount = (explanationMatchCounts.get(queryTermIndex) ?? 0) + 1;
				explanationMatchCounts.set(queryTermIndex, nextCount);
				if (nextCount >= 2) {
					corroboratedQueryTerms.add(queryTermIndex);
				}
			}
		}
		const unionCoverageRatio =
			getSetWeight(unionMatchedQueryTerms, queryTermWeights) / totalQueryWeight;
		const corroboratedCoverageRatio =
			getSetWeight(corroboratedQueryTerms, queryTermWeights) / totalQueryWeight;
		return {
			competitionScore:
				competitionScore +
				unionCoverageRatio * 1.05 +
				corroboratedCoverageRatio * 0.82,
			unionCoverageRatio,
			corroboratedCoverageRatio,
			anchorCoverageRatio:
				decayWeightSum > 0 ? anchorCoverageRatio / decayWeightSum : 0,
			compactnessRatio:
				decayWeightSum > 0 ? compactnessRatio / decayWeightSum : 0,
		};
	}

	private compareLocalWindowExplanations(
		left: LocalWindowExplanation,
		right: LocalWindowExplanation,
	): number {
		if (right.score !== left.score) {
			return right.score - left.score;
		}
		if (right.coverageRatio !== left.coverageRatio) {
			return right.coverageRatio - left.coverageRatio;
		}
		if (right.compactnessRatio !== left.compactnessRatio) {
			return right.compactnessRatio - left.compactnessRatio;
		}
		return left.startPosition - right.startPosition;
	}

	private isBetterLocalWindowExplanation(
		candidate: LocalWindowExplanation,
		existing: LocalWindowExplanation,
	): boolean {
		return this.compareLocalWindowExplanations(candidate, existing) < 0;
	}

	private areFileLocalExplanationCandidatesDuplicate(
		left: FileLocalExplanationCandidate,
		right: FileLocalExplanationCandidate,
		queryTermWeights: QueryTermWeightMap,
	): boolean {
		if (left.passageId !== right.passageId) {
			return false;
		}
		return this.areLocalWindowExplanationsDuplicate(
			left,
			right,
			queryTermWeights,
		);
	}

	private areLocalWindowExplanationsDuplicate(
		left: LocalWindowExplanation,
		right: LocalWindowExplanation,
		queryTermWeights: QueryTermWeightMap,
	): boolean {
		const spanOverlapRatio = this.computeLocalWindowSpanOverlapRatio(left, right);
		if (spanOverlapRatio < LOCAL_WINDOW_DUPLICATE_SPAN_OVERLAP_THRESHOLD) {
			return false;
		}
		const leftWeight = getSetWeight(left.matchedQueryTerms, queryTermWeights);
		const rightWeight = getSetWeight(right.matchedQueryTerms, queryTermWeights);
		if (leftWeight <= 0 || rightWeight <= 0) {
			return true;
		}
		const termOverlapRatio =
			getOverlapWeight(
				left.matchedQueryTerms,
				right.matchedQueryTerms,
				queryTermWeights,
			) / Math.max(0.000001, Math.min(leftWeight, rightWeight));
		return termOverlapRatio >= LOCAL_WINDOW_DUPLICATE_TERM_OVERLAP_THRESHOLD;
	}

	private computeLocalWindowSpanOverlapRatio(
		left: LocalWindowExplanation,
		right: LocalWindowExplanation,
	): number {
		const overlapStart = Math.max(left.startPosition, right.startPosition);
		const overlapEnd = Math.min(left.endPosition, right.endPosition);
		if (overlapEnd < overlapStart) {
			return 0;
		}
		const overlapLength = overlapEnd - overlapStart + 1;
		const leftLength = left.endPosition - left.startPosition + 1;
		const rightLength = right.endPosition - right.startPosition + 1;
		return overlapLength / Math.max(1, Math.min(leftLength, rightLength));
	}

	private computeShortTitleFastPathScore(params: {
		planner: FileSearchQueryPlanner | null;
		coverageRatio: number;
		contentCoverageRatio: number;
		basenameAliasExactRatio: number;
		basenameAliasExpandedRatio: number;
		headingExactRatio: number;
		headingExpandedRatio: number;
		basenameAliasCompactness: number;
		headingCompactness: number;
	}): number {
		const {
			planner,
			coverageRatio,
			contentCoverageRatio,
			basenameAliasExactRatio,
			basenameAliasExpandedRatio,
			headingExactRatio,
			headingExpandedRatio,
			basenameAliasCompactness,
			headingCompactness,
		} = params;
		if (planner?.queryKind !== "short_anchor") {
			return 0;
		}
		const fastPathScore =
			basenameAliasExactRatio * FILE_SHORT_TITLE_FAST_PATH_EXACT +
			basenameAliasExpandedRatio * FILE_SHORT_TITLE_FAST_PATH_PREFIX +
			headingExactRatio * FILE_SHORT_HEADING_FAST_PATH_EXACT +
			headingExpandedRatio * FILE_SHORT_HEADING_FAST_PATH_PREFIX +
			coverageRatio * FILE_SHORT_TITLE_FAST_PATH_COVERAGE +
			Math.min(1.35, basenameAliasCompactness) *
				FILE_SHORT_TITLE_FAST_PATH_COMPACTNESS +
			Math.min(1.35, headingCompactness) *
				FILE_SHORT_HEADING_FAST_PATH_COMPACTNESS +
			(contentCoverageRatio > 0
				? Math.min(1, contentCoverageRatio) * FILE_SHORT_TITLE_CONTENT_CONFIRM_BONUS
				: 0) +
			(basenameAliasExactRatio >= 0.999
				? FILE_SHORT_TITLE_ALL_TERMS_EXACT_BONUS +
					FILE_SHORT_TITLE_STRONG_MATCH_FLOOR
				: basenameAliasExactRatio + basenameAliasExpandedRatio >= 0.999
					? FILE_SHORT_TITLE_ALL_TERMS_PREFIX_BONUS +
						FILE_SHORT_TITLE_STRONG_MATCH_FLOOR
					: 0);
		return fastPathScore;
	}

	private prunePassageStates(
		passageStates: Map<number, PassageCandidateState>,
		keepCount: number,
	) {
		if (passageStates.size <= keepCount) {
			return;
		}
		const keptIds = new Set(
			Array.from(passageStates.entries())
				.sort((left, right) => {
					if (right[1].score !== left[1].score) {
						return right[1].score - left[1].score;
					}
					return left[0] - right[0];
				})
				.slice(0, keepCount)
				.map(([passageId]) => passageId),
		);
		for (const passageId of passageStates.keys()) {
			if (!keptIds.has(passageId)) {
				passageStates.delete(passageId);
			}
		}
	}

	private selectTopPassages(
		passageStates: Map<number, PassageCandidateState>,
		queryTerms: string[],
		rawQueryText: string,
		fileStates: Map<number, FileCandidateState>,
		planner: FileSearchQueryPlanner | null,
		queryTermWeights: QueryTermWeightMap,
		totalQueryWeight: number,
		queryScoringCache: QueryScoringCache,
	): Array<[number, PassageCandidateState]> {
		this.prunePassageStates(passageStates, PASSAGE_PRUNE_KEEP);
		if (queryTerms.length > 1) {
			const localityFrontier = Array.from(passageStates.entries())
				.sort((left, right) => {
					if (right[1].score !== left[1].score) {
						return right[1].score - left[1].score;
					}
					return left[0] - right[0];
				})
				.slice(0, MAX_LOCALITY_FRONTIER);
			for (const [passageId, passageState] of localityFrontier) {
				const passage = this.passageById.get(passageId);
				if (!passage) {
					continue;
				}
				passageState.score += this.computePassageLocalityScore(
					passage,
					passageState,
					queryTerms,
					planner,
					queryTermWeights,
					totalQueryWeight,
					queryScoringCache,
				);
			}
		}

		const verifierFrontier = Array.from(passageStates.entries())
			.sort((left, right) => {
				if (right[1].score !== left[1].score) {
					return right[1].score - left[1].score;
				}
				return left[0] - right[0];
			})
			.slice(0, MAX_VERIFIER_FRONTIER);

		if (queryTerms.length > 0) {
			for (const [passageId, passageState] of verifierFrontier) {
				const passage = this.passageById.get(passageId);
				if (!passage) {
					continue;
				}
				const fileState = fileStates.get(passage.fileId);
				passageState.score += this.computeVerifierScore(
					passage,
					passageState,
					queryTerms,
					rawQueryText,
					planner,
					queryTermWeights,
					totalQueryWeight,
					fileState,
					queryScoringCache,
				);
			}
		}

		return Array.from(passageStates.entries())
			.sort((left, right) => {
				if (right[1].score !== left[1].score) {
					return right[1].score - left[1].score;
				}
				return left[0] - right[0];
			})
			.slice(0, MAX_PASSAGE_FRONTIER);
	}

	private computeVerifierScore(
		passage: PassageRecord,
		passageState: PassageCandidateState,
		queryTerms: string[],
		rawQueryText: string,
		planner: FileSearchQueryPlanner | null,
		queryTermWeights: QueryTermWeightMap,
		totalQueryWeight: number,
		fileState: FileCandidateState | undefined,
		queryScoringCache: QueryScoringCache,
	): number {
		if (passage.tokenSequence.length === 0 || passageState.matchedQueryTerms.size === 0) {
			return 0;
		}

		const positionsByQueryTerm = this.getCachedPassagePositionsByQueryTerm({
			passage,
			matchedQueryTerms: passageState.matchedQueryTerms,
			matchedTermsByQueryTerm: passageState.matchedTermsByQueryTerm,
			queryTerms,
			queryScoringCache,
		});
		if (positionsByQueryTerm.size === 0) {
			return 0;
		}

		const coverage = positionsByQueryTerm.size / Math.max(1, queryTerms.length);
		const orderedRatio = computeOrderedRatio(positionsByQueryTerm);
		const tightOrderedPairRatio = computeTightOrderedPairRatio(positionsByQueryTerm);
		const coverWindow = computeMinimumCoverWindow(positionsByQueryTerm);
		const rareTermLift = computeRareTermLift(
			positionsByQueryTerm,
			queryTermWeights,
		);
		const exactQueryCoverage =
			countOverlap(
				passageState.exactMatchedQueryTerms,
				new Set(positionsByQueryTerm.keys()),
			) / Math.max(1, positionsByQueryTerm.size);
		const passageAnchorCoverage =
			planner && planner.anchorTermIndexes.size > 0
				? countOverlap(passageState.matchedQueryTerms, planner.anchorTermIndexes) /
					planner.anchorTermIndexes.size
				: 0;
		const metadataAnchorMatches =
			planner && fileState
				? countOverlap(fileState.matchedMetadataQueryTerms, planner.anchorTermIndexes)
				: 0;
		const basenameAliasAnchorMatches =
			planner && fileState
				? countOverlap(
						this.getUnionFieldMatches(fileState, ["basename", "aliases"]),
						planner.anchorTermIndexes,
					)
				: 0;
		const headingAnchorMatches =
			planner && fileState
				? countOverlap(
						this.getUnionFieldMatches(fileState, ["headings"]),
						planner.anchorTermIndexes,
					)
				: 0;
		const localWindowSignals = this.getLocalWindowSignalsForPassage({
			passage,
			matchedQueryTerms: passageState.matchedQueryTerms,
			matchedTermsByQueryTerm: passageState.matchedTermsByQueryTerm,
			exactMatchedQueryTerms: passageState.exactMatchedQueryTerms,
			queryTerms,
			planner,
			queryTermWeights,
			totalQueryWeight,
			queryScoringCache,
			computeIfMissing: true,
		});
		const exactPhraseHit = hasExactPhraseMatch(
			passage.text,
			passage.tokenSequence,
			queryTerms,
			positionsByQueryTerm,
			rawQueryText,
		);

		let score =
			coverage * VERIFIER_COVERAGE_WEIGHT +
			orderedRatio * VERIFIER_ORDER_WEIGHT +
			coverWindow.ratio * VERIFIER_COMPACTNESS_WEIGHT +
			rareTermLift * VERIFIER_RARE_TERM_WEIGHT +
			tightOrderedPairRatio * VERIFIER_TIGHT_PAIR_WEIGHT +
			exactQueryCoverage * VERIFIER_EXACT_QUERY_WEIGHT +
			localWindowSignals.score * VERIFIER_LOCAL_WINDOW_WEIGHT;
		if (exactPhraseHit) {
			score += VERIFIER_EXACT_PHRASE_BONUS;
		}
		if (
			Number.isFinite(coverWindow.span) &&
			coverWindow.span <= positionsByQueryTerm.size + 1
		) {
			score += VERIFIER_TIGHT_WINDOW_BONUS;
		}
		if (passageAnchorCoverage > 0) {
			score += passageAnchorCoverage * VERIFIER_PASSAGE_ANCHOR_BONUS;
		}
		if (metadataAnchorMatches > 0 && coverage > 0) {
			score +=
				metadataAnchorMatches *
				(planner?.queryKind === "path_like"
					? VERIFIER_METADATA_ANCHOR_BONUS * 1.2
					: VERIFIER_METADATA_ANCHOR_BONUS);
		}
		if (basenameAliasAnchorMatches > 0 && coverage > 0) {
			score += basenameAliasAnchorMatches * VERIFIER_BASENAME_ALIAS_ALIGNMENT_BONUS;
		} else if (headingAnchorMatches > 0 && coverage > 0) {
			score += headingAnchorMatches * VERIFIER_HEADING_ALIGNMENT_BONUS;
		}
		return score;
	}

	private computePassageLocalityScore(
		passage: PassageRecord,
		passageState: PassageCandidateState,
		queryTerms: string[],
		planner: FileSearchQueryPlanner | null,
		queryTermWeights: QueryTermWeightMap,
		totalQueryWeight: number,
		queryScoringCache: QueryScoringCache,
	): number {
		if (passage.tokenSequence.length === 0 || passageState.matchedQueryTerms.size <= 1) {
			return 0;
		}
		const positionsByQueryTerm = this.getCachedPassagePositionsByQueryTerm({
			passage,
			matchedQueryTerms: passageState.matchedQueryTerms,
			matchedTermsByQueryTerm: passageState.matchedTermsByQueryTerm,
			queryTerms,
			queryScoringCache,
		});
		if (positionsByQueryTerm.size <= 1) {
			return 0;
		}

		const coverage = positionsByQueryTerm.size / Math.max(1, queryTerms.length);
		const orderedRatio = computeOrderedRatio(positionsByQueryTerm);
		const tightOrderedPairRatio = computeTightOrderedPairRatio(positionsByQueryTerm);
		const coverWindow = computeMinimumCoverWindow(positionsByQueryTerm);
		const rareTermLift = computeRareTermLift(
			positionsByQueryTerm,
			queryTermWeights,
		);
		const exactQueryCoverage =
			countOverlap(
				passageState.exactMatchedQueryTerms,
				new Set(positionsByQueryTerm.keys()),
			) / Math.max(1, positionsByQueryTerm.size);
		const anchorCoverage =
			planner && planner.anchorTermIndexes.size > 0
				? countOverlap(passageState.matchedQueryTerms, planner.anchorTermIndexes) /
					planner.anchorTermIndexes.size
				: 0;
		const localWindowSignals = this.getLocalWindowSignalsForPassage({
			passage,
			matchedQueryTerms: passageState.matchedQueryTerms,
			matchedTermsByQueryTerm: passageState.matchedTermsByQueryTerm,
			exactMatchedQueryTerms: passageState.exactMatchedQueryTerms,
			queryTerms,
			planner,
			queryTermWeights,
			totalQueryWeight,
			queryScoringCache,
			computeIfMissing: true,
		});

		let score =
			coverage * PASSAGE_LOCALITY_COVERAGE_WEIGHT +
			orderedRatio * PASSAGE_LOCALITY_ORDER_WEIGHT +
			coverWindow.ratio * PASSAGE_LOCALITY_COMPACTNESS_WEIGHT +
			rareTermLift * PASSAGE_LOCALITY_RARE_TERM_WEIGHT +
			tightOrderedPairRatio * PASSAGE_LOCALITY_TIGHT_PAIR_WEIGHT +
			exactQueryCoverage * PASSAGE_LOCALITY_EXACT_QUERY_WEIGHT +
			anchorCoverage * PASSAGE_LOCALITY_ANCHOR_WEIGHT +
			localWindowSignals.score * PASSAGE_LOCALITY_LOCAL_WINDOW_WEIGHT;
		if (
			Number.isFinite(coverWindow.span) &&
			coverWindow.span <= positionsByQueryTerm.size + 1
		) {
			score += PASSAGE_LOCALITY_TIGHT_WINDOW_BONUS;
		}
		return score;
	}

	private collectPositionsByQueryTerm(
		tokenSequence: readonly string[],
		passageState: PassageCandidateState,
		queryTerms: readonly string[],
	): Map<number, number[]> {
		return this.collectPositionsByMatchedTerms(
			tokenSequence,
			passageState.matchedQueryTerms,
			passageState.matchedTermsByQueryTerm,
			queryTerms,
		);
	}

	private collectPositionsByMatchedTerms(
		tokenSequence: readonly string[],
		matchedQueryTerms: ReadonlySet<number>,
		matchedTermsByQueryTerm: ReadonlyMap<number, ReadonlySet<string>>,
		queryTerms: readonly string[],
	): Map<number, number[]> {
		const positionsByQueryTerm = new Map<number, number[]>();
		for (const queryTermIndex of matchedQueryTerms) {
			const acceptedTerms =
				matchedTermsByQueryTerm.get(queryTermIndex) ??
				new Set<string>([queryTerms[queryTermIndex]]);
			const positions: number[] = [];
			for (let index = 0; index < tokenSequence.length; index++) {
				if (acceptedTerms.has(tokenSequence[index])) {
					positions.push(index);
				}
			}
			if (positions.length > 0) {
				positionsByQueryTerm.set(queryTermIndex, positions);
			}
		}
		return positionsByQueryTerm;
	}
}

function buildTfMap(tokens: string[]): Map<string, number> {
	const tfMap = new Map<string, number>();
	for (const token of tokens) {
		tfMap.set(token, (tfMap.get(token) ?? 0) + 1);
	}
	return tfMap;
}

function sliceLongText(text: string, chunkSize: number): string[] {
	const chunks: string[] = [];
	let start = 0;
	while (start < text.length) {
		chunks.push(text.slice(start, start + chunkSize).trim());
		start += chunkSize;
	}
	return chunks.filter((chunk) => chunk.length > 0);
}

function lowerBoundString(values: string[], target: string): number {
	let lo = 0;
	let hi = values.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (values[mid].localeCompare(target) < 0) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

function computeMaxFuzzyDistance(queryTerm: string): number {
	if (queryTerm.length <= 3) {
		return 0;
	}
	return Math.min(
		WORD_MAX_FUZZY_EDITS,
		Math.max(1, Math.round(queryTerm.length * innerSetting.search.fuzzyProportion)),
	);
}

function computePrefixBoost(queryTerm: string, matchedTerm: string): number {
	return Math.max(
		0.55,
		Math.min(1, queryTerm.length / Math.max(queryTerm.length, matchedTerm.length)),
	);
}

function computeFuzzyBoost(distance: number): number {
	return Math.max(0.55, 1 - distance * 0.18);
}

function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
	if (a === b) {
		return 0;
	}
	if (Math.abs(a.length - b.length) > maxDistance) {
		return maxDistance + 1;
	}

	const prev = new Array<number>(b.length + 1);
	const curr = new Array<number>(b.length + 1);
	for (let index = 0; index <= b.length; index++) {
		prev[index] = index;
	}

	for (let i = 1; i <= a.length; i++) {
		curr[0] = i;
		let rowMin = curr[0];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(
				prev[j] + 1,
				curr[j - 1] + 1,
				prev[j - 1] + cost,
			);
			rowMin = Math.min(rowMin, curr[j]);
		}
		if (rowMin > maxDistance) {
			return maxDistance + 1;
		}
		for (let j = 0; j <= b.length; j++) {
			prev[j] = curr[j];
		}
	}

	return prev[b.length];
}

function countOverlap(
	left: ReadonlySet<number>,
	right: ReadonlySet<number>,
): number {
	let count = 0;
	for (const value of left) {
		if (right.has(value)) {
			count += 1;
		}
	}
	return count;
}

function getTotalQueryWeight(
	queryTerms: readonly string[],
	queryTermWeights: QueryTermWeightMap,
): number {
	let total = 0;
	for (let index = 0; index < queryTerms.length; index++) {
		total += queryTermWeights.get(index) ?? 1;
	}
	return Math.max(1, total);
}

function getSetWeight(
	source: ReadonlySet<number>,
	queryTermWeights: QueryTermWeightMap,
): number {
	let total = 0;
	for (const value of source) {
		total += queryTermWeights.get(value) ?? 1;
	}
	return total;
}

function getOverlapWeight(
	left: ReadonlySet<number>,
	right: ReadonlySet<number>,
	queryTermWeights: QueryTermWeightMap,
): number {
	let total = 0;
	for (const value of left) {
		if (right.has(value)) {
			total += queryTermWeights.get(value) ?? 1;
		}
	}
	return total;
}

function getSetDifferenceWeight(
	source: ReadonlySet<number>,
	excluded: ReadonlySet<number>,
	queryTermWeights: QueryTermWeightMap,
): number {
	let total = 0;
	for (const value of source) {
		if (!excluded.has(value)) {
			total += queryTermWeights.get(value) ?? 1;
		}
	}
	return total;
}

function buildQueryTermDecomposition(
	termStats: readonly FileSearchQueryTermStats[],
	planner: FileSearchQueryPlanner | null,
): QueryTermDecomposition {
	const activeStats = termStats.filter((stat) => stat.hasAnyMatch);
	const activeTermIndexes = new Set(activeStats.map((stat) => stat.index));
	if (!planner) {
		return {
			queryKind: null,
			activeTermIndexes,
			anchorTermIndexes: new Set<number>(),
			bodyTermIndexes: new Set(activeTermIndexes),
			noiseTermIndexes: new Set<number>(),
		};
	}

	const anchorTermIndexes = new Set<number>();
	for (const stat of activeStats) {
		if (planner.anchorTermIndexes.has(stat.index)) {
			anchorTermIndexes.add(stat.index);
		}
	}

	const noiseTermIndexes = new Set<number>();
	if (planner.queryKind !== "short_anchor") {
		for (const stat of activeStats) {
			if (
				planner.optionalTermIndexes.has(stat.index) &&
				!anchorTermIndexes.has(stat.index)
			) {
				noiseTermIndexes.add(stat.index);
			}
		}
	}

	const bodyTermIndexes = new Set<number>();
	for (const stat of activeStats) {
		if (
			!anchorTermIndexes.has(stat.index) &&
			!noiseTermIndexes.has(stat.index)
		) {
			bodyTermIndexes.add(stat.index);
		}
	}

	if (bodyTermIndexes.size === 0 && planner.queryKind !== "short_anchor") {
		const fallbackBodyStat = activeStats
			.filter((stat) => !anchorTermIndexes.has(stat.index))
			.sort((left, right) => {
				const leftBodyBias =
					left.matchedDocCount - left.matchedMetadataDocCount;
				const rightBodyBias =
					right.matchedDocCount - right.matchedMetadataDocCount;
				if (leftBodyBias !== rightBodyBias) {
					return rightBodyBias - leftBodyBias;
				}
				if (left.hasExactMatch !== right.hasExactMatch) {
					return left.hasExactMatch ? -1 : 1;
				}
				if (left.matchedDocCount !== right.matchedDocCount) {
					return left.matchedDocCount - right.matchedDocCount;
				}
				if (left.queryTerm.length !== right.queryTerm.length) {
					return right.queryTerm.length - left.queryTerm.length;
				}
				return left.index - right.index;
			})[0];
		if (fallbackBodyStat) {
			bodyTermIndexes.add(fallbackBodyStat.index);
			noiseTermIndexes.delete(fallbackBodyStat.index);
		}
	}

	return {
		queryKind: planner.queryKind,
		activeTermIndexes,
		anchorTermIndexes,
		bodyTermIndexes,
		noiseTermIndexes,
	};
}

function buildQueryTermWeightMap(
	termStats: readonly FileSearchQueryTermStats[],
	docCount: number,
	planner: FileSearchQueryPlanner | null,
	queryTermDecomposition: QueryTermDecomposition,
): QueryTermWeightMap {
	const weights = new Map<number, number>();
	for (const stat of termStats) {
		const baseWeight =
			stat.matchedDocCount > 0
				? Math.log((docCount + 1) / (stat.matchedDocCount + 1)) + 1
				: 0;
		const anchorBoost =
			planner?.anchorTermIndexes.has(stat.index)
				? queryTermDecomposition.queryKind === "short_anchor"
					? 0.42
					: 0.3
				: 0;
		const bodyBoost =
			queryTermDecomposition.bodyTermIndexes.has(stat.index) &&
			queryTermDecomposition.queryKind !== "short_anchor"
				? queryTermDecomposition.queryKind === "sentence_like"
					? 0.24
					: 0.16
				: 0;
		const noisePenalty = queryTermDecomposition.noiseTermIndexes.has(stat.index)
			? queryTermDecomposition.queryKind === "path_like"
				? 0.1
				: 0.18
			: 0;
		weights.set(
			stat.index,
			Math.max(0, baseWeight + anchorBoost + bodyBoost - noisePenalty),
		);
	}
	return weights;
}

function computeOrderedRatio(
	positionsByQueryTerm: ReadonlyMap<number, number[]>,
): number {
	const indexes = Array.from(positionsByQueryTerm.keys()).sort((a, b) => a - b);
	if (indexes.length <= 1) {
		return indexes.length;
	}
	let orderedPairs = 0;
	for (let index = 0; index < indexes.length - 1; index++) {
		const leftPositions = positionsByQueryTerm.get(indexes[index]) ?? [];
		const rightPositions = positionsByQueryTerm.get(indexes[index + 1]) ?? [];
		if (hasIncreasingPosition(leftPositions, rightPositions)) {
			orderedPairs += 1;
		}
	}
	return orderedPairs / Math.max(1, indexes.length - 1);
}

function computeTightOrderedPairRatio(
	positionsByQueryTerm: ReadonlyMap<number, number[]>,
	maxGap = 3,
): number {
	const indexes = Array.from(positionsByQueryTerm.keys()).sort((a, b) => a - b);
	if (indexes.length <= 1) {
		return indexes.length;
	}
	let tightPairs = 0;
	for (let index = 0; index < indexes.length - 1; index++) {
		const leftPositions = positionsByQueryTerm.get(indexes[index]) ?? [];
		const rightPositions = positionsByQueryTerm.get(indexes[index + 1]) ?? [];
		const minimumGap = computeMinimumPositiveGap(leftPositions, rightPositions);
		if (!Number.isFinite(minimumGap)) {
			continue;
		}
		if (minimumGap <= maxGap) {
			tightPairs += 1;
		} else if (minimumGap <= maxGap * 2) {
			tightPairs += 0.5;
		}
	}
	return tightPairs / Math.max(1, indexes.length - 1);
}

function hasIncreasingPosition(
	leftPositions: readonly number[],
	rightPositions: readonly number[],
): boolean {
	let rightIndex = 0;
	for (const left of leftPositions) {
		while (rightIndex < rightPositions.length && rightPositions[rightIndex] <= left) {
			rightIndex += 1;
		}
		if (rightIndex < rightPositions.length) {
			return true;
		}
	}
	return false;
}

function computeMinimumPositiveGap(
	leftPositions: readonly number[],
	rightPositions: readonly number[],
): number {
	let rightIndex = 0;
	let bestGap = Number.POSITIVE_INFINITY;
	for (const left of leftPositions) {
		while (rightIndex < rightPositions.length && rightPositions[rightIndex] <= left) {
			rightIndex += 1;
		}
		if (rightIndex < rightPositions.length) {
			bestGap = Math.min(bestGap, rightPositions[rightIndex] - left);
		}
	}
	return bestGap;
}

function computeMinimumCoverWindow(
	positionsByQueryTerm: ReadonlyMap<number, number[]>,
): { span: number; ratio: number } {
	const entries = Array.from(positionsByQueryTerm.values()).filter(
		(positions) => positions.length > 0,
	);
	if (entries.length <= 1) {
		return {
			span: entries.length,
			ratio: entries.length,
		};
	}

	const flattened = entries.flatMap((positions, termIndex) =>
		positions.map((position) => ({ position, termIndex })),
	);
	flattened.sort((left, right) => left.position - right.position);

	let bestSpan = Number.POSITIVE_INFINITY;
	const counts = new Map<number, number>();
	let coveredTerms = 0;
	let leftIndex = 0;
	for (let rightIndex = 0; rightIndex < flattened.length; rightIndex++) {
		const right = flattened[rightIndex];
		const nextCount = (counts.get(right.termIndex) ?? 0) + 1;
		counts.set(right.termIndex, nextCount);
		if (nextCount === 1) {
			coveredTerms += 1;
		}

		while (coveredTerms === entries.length && leftIndex <= rightIndex) {
			const left = flattened[leftIndex];
			bestSpan = Math.min(bestSpan, right.position - left.position + 1);
			const leftCount = (counts.get(left.termIndex) ?? 0) - 1;
			if (leftCount <= 0) {
				counts.delete(left.termIndex);
				coveredTerms -= 1;
			} else {
				counts.set(left.termIndex, leftCount);
			}
			leftIndex += 1;
		}
	}

	if (!Number.isFinite(bestSpan)) {
		return { span: Number.POSITIVE_INFINITY, ratio: 0 };
	}
	return {
		span: bestSpan,
		ratio: entries.length / Math.max(1, bestSpan),
	};
}

function computeRareTermLift(
	positionsByQueryTerm: ReadonlyMap<number, number[]>,
	queryTermWeights: QueryTermWeightMap,
): number {
	const allWeights = Array.from(queryTermWeights.values()).filter((value) => value > 0);
	if (allWeights.length === 0 || positionsByQueryTerm.size === 0) {
		return 0;
	}
	const matchedWeights = Array.from(positionsByQueryTerm.keys()).map(
		(index) => queryTermWeights.get(index) ?? 0,
	);
	const averageAll =
		allWeights.reduce((sum, value) => sum + value, 0) / allWeights.length;
	const averageMatched =
		matchedWeights.reduce((sum, value) => sum + value, 0) /
		Math.max(1, matchedWeights.length);
	return Math.max(0, averageMatched / Math.max(0.001, averageAll) - 1);
}

function hasExactPhraseMatch(
	passageText: string,
	tokenSequence: readonly string[],
	queryTerms: readonly string[],
	positionsByQueryTerm: ReadonlyMap<number, number[]>,
	rawQueryText: string,
): boolean {
	const orderedQueryIndexes = Array.from(positionsByQueryTerm.keys()).sort(
		(left, right) => left - right,
	);
	if (orderedQueryIndexes.length < 2) {
		return false;
	}
	const orderedQueryTerms = orderedQueryIndexes.map((index) => queryTerms[index]);
	const candidateStarts =
		positionsByQueryTerm.get(orderedQueryIndexes[0]) ?? [];

	for (const start of candidateStarts) {
		if (start > tokenSequence.length - orderedQueryTerms.length) {
			continue;
		}
		let matched = true;
		for (let offset = 0; offset < orderedQueryTerms.length; offset++) {
			if (tokenSequence[start + offset] !== orderedQueryTerms[offset]) {
				matched = false;
				break;
			}
		}
		if (matched) {
			return true;
		}
	}

	const normalizedRaw = rawQueryText.trim().toLocaleLowerCase();
	return normalizedRaw.length > 0
		? passageText.toLocaleLowerCase().includes(normalizedRaw)
		: false;
}
