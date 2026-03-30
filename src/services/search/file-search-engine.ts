import type { AsPlainObject, Options, SearchOptions } from "minisearch";
import MiniSearch from "minisearch";
import type {
	DocumentFields,
	DocumentWeight,
	FileSubItem,
	IndexedDocument,
	LineFields,
	MatchedFile,
} from "src/globals/search-types";
import {
	OuterSetting,
	innerSetting,
	type FileSearchBackend,
} from "src/globals/plugin-setting";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { CoverageLexicalFileSearchEngine } from "./coverage-lexical/coverage-lexical-engine";
import {
	createFileSearchQueryPlanner,
	type FileSearchQueryTermStats,
} from "./file-search-query-planner";
import { PassageFileSearchEngine } from "./passage-lexical/passage-file-search-engine";
import { Tokenizer } from "./tokenizer";

export type FileSearchRequest = {
	queryText: string;
	isPrefixMatch: boolean;
	isFuzzy: boolean;
	maxItemResults: number;
	maxDirectSubItemResults?: number;
	maxSubItemResults?: number;
};

export type SerializedFileSearchIndex =
	| AsPlainObject
	| SerializedBinaryCustomFileSearchIndex
	| SerializedPassageFileSearchSnapshot;

export type SerializedPassageIndexedDocument = Omit<IndexedDocument, "content"> & {
	generation?: number;
};

export type SerializedPassageFileSearchSnapshot = {
	__backend: "passage-bm25";
	__version: 3;
	__format: "structural-snapshot";
	documents: SerializedPassageIndexedDocument[];
};

export interface FileSearchEngine {
	readonly backend: FileSearchBackend;
	readonly supportsSerialization: boolean;
	reIndexAll(data: IndexedDocument[] | SerializedFileSearchIndex): Promise<boolean>;
	clearIndex(): void;
	addDocuments(documents: IndexedDocument[]): Promise<void>;
	deleteDocuments(paths: string[]): void;
	searchFiles(request: FileSearchRequest): Promise<MatchedFile[]>;
	getDirectSubItems?(
		queryText: string,
		path: string,
		maxSubItemResults: number,
	): FileSubItem[] | null;
	serialize(): SerializedFileSearchIndex | null;
	estimateIndexBytes?(): number | null;
	getIndexBreakdown?(): Record<string, unknown> | null;
	debugTermAvailability?(term: string): Record<string, unknown> | null;
}

@singleton()
export class FileSearchOptions {
	private readonly outerSetting = getInstance(OuterSetting);
	private readonly inSetting = innerSetting.search;
	private readonly tokenizer = getInstance(Tokenizer);
	private readonly tokenizeIndex = (text: string) =>
		this.tokenizer.tokenize(text, "index");
	private readonly tokenizeSearch = (text: string) =>
		this.tokenizer.tokenize(text, "search");

	readonly documentChunkSize: 100;
	readonly lineChunkSize: 500;
	readonly fileIndexOption: Options = {
		tokenize: this.tokenizeIndex,
		idField: "path",
		fields: [
			"basename",
			"aliases",
			"folder",
			"tags",
			"headings",
			"content",
		] as DocumentFields,
		storeFields: ["tags"] as DocumentFields,
		processTerm: (term) =>
			this.outerSetting.isCaseSensitive ? term : term.toLocaleLowerCase(),
	};
	readonly lineIndexOption: Options = {
		tokenize: this.tokenizeIndex,
		idField: "row",
		fields: ["text"] as LineFields,
	};

	buildFileSearchOption(request: FileSearchRequest): SearchOptions {
		return {
			tokenize: this.tokenizeSearch,
			prefix: (term) =>
				request.isPrefixMatch
					? term.length >= this.inSetting.minTermLengthForPrefixSearch
					: false,
			fuzzy: (term) =>
				request.isFuzzy
					? term.length <= 3
						? 0
						: this.inSetting.fuzzyProportion
					: false,
			boost: {
				basename: this.inSetting.weightFilename,
				aliases: this.inSetting.weightFilename,
				folder: this.inSetting.weightFolder,
				tags: this.inSetting.weightTagText,
				headings: this.inSetting.weightHeading,
			} as DocumentWeight,
			combineWith: "and",
		};
	}

	getLineSearchOption(): SearchOptions {
		return {
			prefix: (term) =>
				term.length >= this.inSetting.minTermLengthForPrefixSearch,
			fuzzy: (term) =>
				term.length <= 3 ? 0 : this.inSetting.fuzzyProportion,
			combineWith: "or",
		};
	}
}

@singleton()
export class MiniSearchFileEngine implements FileSearchEngine {
	readonly backend: FileSearchBackend = "minisearch";
	readonly supportsSerialization = true;
	private readonly option = getInstance(FileSearchOptions);
	private filesIndex = new MiniSearch(this.option.fileIndexOption);

	async reIndexAll(
		data: IndexedDocument[] | SerializedFileSearchIndex,
	): Promise<boolean> {
		this.clearIndex();

		if (Array.isArray(data)) {
			logger.trace("Indexing all documents...");
			await this.addDocuments(data);
			return true;
		}

		logger.trace("Loading indexed data...");
		try {
			if (!isSerializedMiniSearchFileIndex(data)) {
				return false;
			}
			this.filesIndex = MiniSearch.loadJS(
				data,
				this.option.fileIndexOption,
			);
			return true;
		} catch (e) {
			logger.error(e);
			return false;
		}
	}

	async addDocuments(documents: IndexedDocument[]) {
		const paths = documents.map((doc) => doc.path);
		const existingPaths = paths.filter((path) => this.filesIndex.has(path));
		if (existingPaths.length > 0) {
			this.filesIndex.discardAll(existingPaths);
		}
		await this.filesIndex.addAllAsync(documents, {
			chunkSize: this.option.documentChunkSize,
		});
		logger.debug(`updated/added ${documents.length} docs`);
	}

	clearIndex(): void {
		this.filesIndex.removeAll();
	}

	deleteDocuments(paths: string[]) {
		const docsToDiscard = paths.filter((path) => this.filesIndex.has(path));
		this.filesIndex.discardAll(docsToDiscard);
		logger.debug(`deleted ${docsToDiscard.length}`);
	}

	async searchFiles(request: FileSearchRequest): Promise<MatchedFile[]> {
		const minisearchResult = this.filesIndex.search(
			request.queryText,
			this.option.buildFileSearchOption(request),
		);
		return minisearchResult
			.slice(0, request.maxItemResults)
			.map((item) => ({
				path: item.id,
				queryTerms: item.queryTerms,
				matchedTerms: item.terms,
				score: item.score,
			}));
	}

	serialize(): SerializedFileSearchIndex | null {
		return this.filesIndex.toJSON();
	}
}

type FileSearchField =
	| "basename"
	| "aliases"
	| "folder"
	| "tags"
	| "headings"
	| "content";

type FieldStats = {
	docLengths: Map<number, number>;
	totalLength: number;
};

type QueryTermMatch = {
	matchedTerms: Array<{
		term: string;
		boost: number;
		kind: "exact" | "prefix" | "fuzzy";
		fields?: ReadonlyArray<FileSearchField>;
	}>;
};

type MatchedQueryTerm = QueryTermMatch["matchedTerms"][number];

type CandidateDocState = {
	score: number;
	matchedTerms: Set<string>;
	matchedQueryTerms: Set<number>;
	matchedMetadataQueryTerms: Set<number>;
	matchedExpandedMetadataQueryTerms: Set<number>;
	matchedQueryTermsByField: Map<FileSearchField, Set<number>>;
};

type SerializedFieldId = 0 | 1 | 2 | 3 | 4 | 5;

type SerializedBinaryCustomFileSearchIndex = {
	__backend: "custom-bm25";
	__version: 6;
	__encoding: "binary";
	data: ArrayBuffer;
};

const FILE_SEARCH_FIELDS: FileSearchField[] = [
	"basename",
	"aliases",
	"folder",
	"tags",
	"headings",
	"content",
];
const FILE_SEARCH_METADATA_FIELDS: ReadonlyArray<FileSearchField> = [
	"basename",
	"aliases",
	"folder",
	"tags",
	"headings",
];
const FILE_SEARCH_METADATA_FIELD_SET = new Set<FileSearchField>(
	FILE_SEARCH_METADATA_FIELDS,
);
const FILE_SEARCH_FIELD_IDS: Record<FileSearchField, SerializedFieldId> = {
	basename: 0,
	aliases: 1,
	folder: 2,
	tags: 3,
	headings: 4,
	content: 5,
};
const FILE_SEARCH_FIELDS_BY_ID: Record<SerializedFieldId, FileSearchField> = {
	0: "basename",
	1: "aliases",
	2: "folder",
	3: "tags",
	4: "headings",
	5: "content",
};

const FILE_SEARCH_FIELD_WEIGHTS: Record<FileSearchField, number> = {
	basename: innerSetting.search.weightFilename,
	aliases: innerSetting.search.weightFilename,
	folder: innerSetting.search.weightFolder,
	tags: innerSetting.search.weightTagText,
	headings: innerSetting.search.weightHeading,
	content: 1,
};

const FILE_SEARCH_BM25_K1 = 1.5;
const FILE_SEARCH_BM25_B = 0.75;
const FILE_SEARCH_PREFIX_EXPANSION_LIMIT = 128;
const FILE_SEARCH_FUZZY_EXPANSION_LIMIT = 96;
const FILE_SEARCH_MAX_FUZZY_EDITS = 2;
const FILE_SEARCH_FIELD_COORDINATION_BONUS = 0.9;
const FILE_SEARCH_METADATA_COORDINATION_BONUS = 1.8;
const FILE_SEARCH_METADATA_EXPANDED_MATCH_BONUS = 1.25;
const FILE_SEARCH_METADATA_FULL_FIELD_COVERAGE_BONUS = 2.4;
const FILE_SEARCH_PREFIX_EXACT_MATCH_BOOST = 0.72;
const FILE_SEARCH_FUZZY_WHEN_PREFIX_EXISTS_BOOST = 0.92;
const FILE_SEARCH_BINARY_MAGIC = [0x43, 0x53, 0x46, 0x42] as const;
const FILE_SEARCH_BINARY_FORMAT_VERSION = 1;

@singleton()
export class CustomFileSearchEngine implements FileSearchEngine {
	readonly backend: FileSearchBackend = "custom-bm25";
	readonly supportsSerialization = true;
	private readonly outerSetting = getInstance(OuterSetting);
	private readonly tokenizer = getInstance(Tokenizer);
	private readonly termPostings = new Map<
		string,
		Map<FileSearchField, Map<number, number>>
	>();
	private readonly sortedTerms: string[] = [];
	private readonly fieldStats: Record<FileSearchField, FieldStats> = {
		basename: { docLengths: new Map(), totalLength: 0 },
		aliases: { docLengths: new Map(), totalLength: 0 },
		folder: { docLengths: new Map(), totalLength: 0 },
		tags: { docLengths: new Map(), totalLength: 0 },
		headings: { docLengths: new Map(), totalLength: 0 },
		content: { docLengths: new Map(), totalLength: 0 },
	};
	private readonly docIdByPath = new Map<string, number>();
	private readonly pathByDocId = new Map<number, string>();
	private nextDocId = 1;

	async reIndexAll(
		data: IndexedDocument[] | SerializedFileSearchIndex,
	): Promise<boolean> {
		this.clearIndex();
		if (Array.isArray(data)) {
			await this.addDocuments(data);
			return true;
		}
		try {
			if (isSerializedBinaryCustomFileSearchIndex(data)) {
				this.deserializeBinary(data);
				return true;
			}
			return false;
		} catch (error) {
			logger.error(error);
			this.clearIndex();
			return false;
		}
	}

	async addDocuments(documents: IndexedDocument[]): Promise<void> {
		for (const document of documents) {
			this.indexDocument(document);
		}
		logger.debug(`custom file search indexed/updated ${documents.length} docs`);
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
		if (queryTerms.length === 0 || this.pathByDocId.size === 0) {
			return [];
		}

		const prefixTerm =
			request.isPrefixMatch &&
			queryTerms[queryTerms.length - 1].length >=
				innerSetting.search.minTermLengthForPrefixSearch
				? queryTerms[queryTerms.length - 1]
				: null;

		const termMatches = queryTerms.map((queryTerm) =>
			this.resolveMatchedTerms(
				queryTerm,
				prefixTerm === queryTerm,
				request.isFuzzy,
			),
		);
		if (termMatches.every((match) => match.matchedTerms.length === 0)) {
			return [];
		}

		const candidateStates = new Map<number, CandidateDocState>();
		const termStats: FileSearchQueryTermStats[] = [];

		// Collect candidate evidence once, then let the planner decide whether
		// strict all-term matching is enough or whether a relaxed pass is warranted.
		for (let queryTermIndex = 0; queryTermIndex < termMatches.length; queryTermIndex++) {
			const match = termMatches[queryTermIndex];
			const docsMatchedForTerm = new Set<number>();
			const metadataDocsMatchedForTerm = new Set<number>();

			for (const matchedTerm of match.matchedTerms) {
				const fieldMap = this.termPostings.get(matchedTerm.term);
				if (!fieldMap) continue;

				for (const field of FILE_SEARCH_FIELDS) {
					if (matchedTerm.fields && !matchedTerm.fields.includes(field)) {
						continue;
					}
					const postings = fieldMap.get(field);
					if (!postings || postings.size === 0) continue;

					const idf = this.computeIdf(postings.size);
					const avgFieldLength = this.averageFieldLength(field);
					for (const [docId, tf] of postings) {
						const docLength =
							this.fieldStats[field].docLengths.get(docId) ?? 0;
						const tfNorm = this.computeTfNorm(
							tf,
							docLength,
							avgFieldLength,
						);
						const fieldWeight = FILE_SEARCH_FIELD_WEIGHTS[field];
						let candidateState = candidateStates.get(docId);
						if (!candidateState) {
							candidateState = {
								score: 0,
								matchedTerms: new Set<string>(),
								matchedQueryTerms: new Set<number>(),
								matchedMetadataQueryTerms: new Set<number>(),
								matchedExpandedMetadataQueryTerms: new Set<number>(),
								matchedQueryTermsByField: new Map<FileSearchField, Set<number>>(),
							};
							candidateStates.set(docId, candidateState);
						}
						candidateState.score +=
							fieldWeight * idf * tfNorm * matchedTerm.boost;
						candidateState.matchedTerms.add(matchedTerm.term);
						candidateState.matchedQueryTerms.add(queryTermIndex);

						let fieldMatches = candidateState.matchedQueryTermsByField.get(field);
						if (!fieldMatches) {
							fieldMatches = new Set<number>();
							candidateState.matchedQueryTermsByField.set(field, fieldMatches);
						}
						fieldMatches.add(queryTermIndex);
						if (FILE_SEARCH_METADATA_FIELDS.includes(field)) {
							candidateState.matchedMetadataQueryTerms.add(queryTermIndex);
							metadataDocsMatchedForTerm.add(docId);
							if (matchedTerm.kind !== "exact") {
								candidateState.matchedExpandedMetadataQueryTerms.add(
									queryTermIndex,
								);
							}
						}
						docsMatchedForTerm.add(docId);
					}
				}
			}

			termStats.push({
				index: queryTermIndex,
				queryTerm: queryTerms[queryTermIndex],
				matchedDocCount: docsMatchedForTerm.size,
				matchedMetadataDocCount: metadataDocsMatchedForTerm.size,
				hasAnyMatch: docsMatchedForTerm.size > 0,
				hasExactMatch: match.matchedTerms.some((term) => term.kind === "exact"),
			});
		}

		const planner = createFileSearchQueryPlanner({
			rawQueryText: request.queryText,
			queryTerms,
			termStats,
			docCount: this.pathByDocId.size,
		});
		const effectiveQueryTermCount = Math.max(1, planner.activeTermCount);
		const strictResults: MatchedFile[] = [];
		const relaxedResults: MatchedFile[] = [];

		for (const [docId, candidateState] of candidateStates) {
			this.applyFieldCoordinationBonus(candidateState, effectiveQueryTermCount);
			if (planner.matches(candidateState, "strict")) {
				strictResults.push(
					this.createMatchedFile(
						docId,
						queryTerms,
						candidateState,
						planner.computeScoreBonus(candidateState, "strict"),
					),
				);
			}
			if (planner.matches(candidateState, "relaxed")) {
				relaxedResults.push(
					this.createMatchedFile(
						docId,
						queryTerms,
						candidateState,
						planner.computeScoreBonus(candidateState, "relaxed"),
					),
				);
			}
		}

		const strictSorted = this.sortMatchedFiles(strictResults);
		if (
			!planner.shouldUseRelaxedResults(
				strictSorted.length,
				request.maxItemResults,
			)
		) {
			return strictSorted.slice(0, request.maxItemResults);
		}

		return this.sortMatchedFiles(relaxedResults).slice(0, request.maxItemResults);
	}

	serialize(): SerializedFileSearchIndex | null {
		return this.serializeBinary();
	}

	private clear() {
		this.termPostings.clear();
		this.sortedTerms.length = 0;
		this.docIdByPath.clear();
		this.pathByDocId.clear();
		this.nextDocId = 1;
		for (const field of FILE_SEARCH_FIELDS) {
			this.fieldStats[field].docLengths.clear();
			this.fieldStats[field].totalLength = 0;
		}
	}

	private serializeBinary(): SerializedBinaryCustomFileSearchIndex {
		const writer = new BinaryWriter();
		writer.writeBytes(FILE_SEARCH_BINARY_MAGIC);
		writer.writeVarUint(FILE_SEARCH_BINARY_FORMAT_VERSION);
		writer.writeVarUint(this.nextDocId);

		const docs = Array.from(this.pathByDocId.entries()).sort((a, b) => a[0] - b[0]);
		writer.writeVarUint(docs.length);
		let prevDocId = 0;
		for (const [docId, path] of docs) {
			writer.writeVarUint(docId - prevDocId);
			writer.writeString(path);
			prevDocId = docId;
		}

		for (const field of FILE_SEARCH_FIELDS) {
			writer.writeVarUint(this.fieldStats[field].totalLength);
			const docLengths = Array.from(this.fieldStats[field].docLengths.entries()).sort(
				(a, b) => a[0] - b[0],
			);
			writer.writeVarUint(docLengths.length);
			prevDocId = 0;
			for (const [docId, docLength] of docLengths) {
				writer.writeVarUint(docId - prevDocId);
				writer.writeVarUint(docLength);
				prevDocId = docId;
			}
		}

		writer.writeVarUint(this.sortedTerms.length);
		let prevTerm = "";
		for (const term of this.sortedTerms) {
			const prefixLength = countSharedPrefix(prevTerm, term);
			writer.writeVarUint(prefixLength);
			writer.writeString(term.slice(prefixLength));

			const fieldMap = this.termPostings.get(term);
			const metadataEntries = FILE_SEARCH_METADATA_FIELDS.flatMap((field) => {
				const postingMap = fieldMap?.get(field);
				if (!postingMap || postingMap.size === 0) {
					return [];
				}
				return [[
					FILE_SEARCH_FIELD_IDS[field],
					Array.from(postingMap.entries()).sort((a, b) => a[0] - b[0]),
				] as [SerializedFieldId, Array<[number, number]>]];
			});
			writer.writeVarUint(metadataEntries.length);
			for (const [fieldId, postingEntries] of metadataEntries) {
				writer.writeVarUint(fieldId);
				writer.writeVarUint(postingEntries.length);
				prevDocId = 0;
				for (const [docId, tf] of postingEntries) {
					writer.writeVarUint(docId - prevDocId);
					writer.writeVarUint(tf);
					prevDocId = docId;
				}
			}

			const contentDocIds = Array.from(fieldMap?.get("content")?.keys() ?? []).sort(
				(a, b) => a - b,
			);
			writer.writeVarUint(contentDocIds.length);
			prevDocId = 0;
			for (const docId of contentDocIds) {
				writer.writeVarUint(docId - prevDocId);
				prevDocId = docId;
			}

			prevTerm = term;
		}

		return {
			__backend: "custom-bm25",
			__version: 6,
			__encoding: "binary",
			data: writer.toArrayBuffer(),
		};
	}

	private deserializeBinary(data: SerializedBinaryCustomFileSearchIndex) {
		const reader = new BinaryReader(data.data);
		reader.expectBytes(FILE_SEARCH_BINARY_MAGIC);
		const formatVersion = reader.readVarUint();
		if (formatVersion !== FILE_SEARCH_BINARY_FORMAT_VERSION) {
			throw new Error(
				`Unsupported custom file search binary format version: ${formatVersion}`,
			);
		}

		this.nextDocId = reader.readVarUint();
		const docCount = reader.readVarUint();
		let prevDocId = 0;
		for (let i = 0; i < docCount; i++) {
			const docId = prevDocId + reader.readVarUint();
			const path = reader.readString();
			this.pathByDocId.set(docId, path);
			this.docIdByPath.set(path, docId);
			prevDocId = docId;
		}

		for (const field of FILE_SEARCH_FIELDS) {
			this.fieldStats[field].totalLength = reader.readVarUint();
			const docLengthCount = reader.readVarUint();
			const docLengths = new Map<number, number>();
			prevDocId = 0;
			for (let i = 0; i < docLengthCount; i++) {
				const docId = prevDocId + reader.readVarUint();
				const docLength = reader.readVarUint();
				docLengths.set(docId, docLength);
				prevDocId = docId;
			}
			this.fieldStats[field].docLengths = docLengths;
		}

		const termCount = reader.readVarUint();
		let prevTerm = "";
		for (let i = 0; i < termCount; i++) {
			const prefixLength = reader.readVarUint();
			const suffix = reader.readString();
			const term = prevTerm.slice(0, prefixLength) + suffix;
			const fieldMap = new Map<FileSearchField, Map<number, number>>();

			const metadataFieldCount = reader.readVarUint();
			for (let fieldIndex = 0; fieldIndex < metadataFieldCount; fieldIndex++) {
				const fieldId = reader.readVarUint() as SerializedFieldId;
				const postingCount = reader.readVarUint();
				const postings = new Map<number, number>();
				prevDocId = 0;
				for (let postingIndex = 0; postingIndex < postingCount; postingIndex++) {
					const docId = prevDocId + reader.readVarUint();
					const tf = reader.readVarUint();
					postings.set(docId, tf);
					prevDocId = docId;
				}
				fieldMap.set(FILE_SEARCH_FIELDS_BY_ID[fieldId], postings);
			}

			const contentPostingCount = reader.readVarUint();
			if (contentPostingCount > 0) {
				const postings = new Map<number, number>();
				prevDocId = 0;
				for (let postingIndex = 0; postingIndex < contentPostingCount; postingIndex++) {
					const docId = prevDocId + reader.readVarUint();
					postings.set(docId, 1);
					prevDocId = docId;
				}
				fieldMap.set("content", postings);
			}

			this.termPostings.set(term, fieldMap);
			this.sortedTerms.push(term);
			prevTerm = term;
		}
	}

	private indexDocument(document: IndexedDocument) {
		const existingDocId = this.docIdByPath.get(document.path);
		if (existingDocId !== undefined) {
			this.removeDocument(document.path);
		}

		const docId = this.nextDocId++;
		this.docIdByPath.set(document.path, docId);
		this.pathByDocId.set(docId, document.path);

		for (const field of FILE_SEARCH_FIELDS) {
			const text = document[field] ?? "";
			const tokens = this.getFieldTokens(field, text);
			this.fieldStats[field].docLengths.set(docId, tokens.length);
			this.fieldStats[field].totalLength += tokens.length;

			const tfMap = new Map<string, number>();
			for (const token of tokens) {
				tfMap.set(token, (tfMap.get(token) ?? 0) + 1);
			}

			for (const [term, tf] of tfMap) {
				let fieldMap = this.termPostings.get(term);
				if (!fieldMap) {
					fieldMap = new Map();
					this.termPostings.set(term, fieldMap);
					this.insertTermIntoLexicon(term);
				}
				let postings = fieldMap.get(field);
				if (!postings) {
					postings = new Map();
					fieldMap.set(field, postings);
				}
				postings.set(docId, tf);
			}
		}
	}

	private removeDocument(path: string) {
		const docId = this.docIdByPath.get(path);
		if (docId === undefined) return;

		for (const field of FILE_SEARCH_FIELDS) {
			const docLength = this.fieldStats[field].docLengths.get(docId) ?? 0;
			this.fieldStats[field].docLengths.delete(docId);
			this.fieldStats[field].totalLength -= docLength;
		}

		for (const [, fieldMap] of this.termPostings) {
			for (const field of FILE_SEARCH_FIELDS) {
				const postings = fieldMap.get(field);
				if (!postings) continue;
				postings.delete(docId);
				if (postings.size === 0) {
					fieldMap.delete(field);
				}
			}
		}

		for (const [term, fieldMap] of this.termPostings) {
			if (fieldMap.size === 0) {
				this.termPostings.delete(term);
				this.removeTermFromLexicon(term);
			}
		}

		this.docIdByPath.delete(path);
		this.pathByDocId.delete(docId);
	}

	private resolveMatchedTerms(
		queryTerm: string,
		allowPrefix: boolean,
		allowFuzzy: boolean,
	): QueryTermMatch {
		const prefixTerms = allowPrefix ? this.expandPrefixTerms(queryTerm) : [];
		const hasLongerPrefixAlternatives = prefixTerms.some(
			(term) => term !== queryTerm,
		);
		const matchedTerms = new Map<
			string,
			MatchedQueryTerm
		>();
		if (this.termPostings.has(queryTerm)) {
			matchedTerms.set(queryTerm, {
				term: queryTerm,
				boost:
					allowPrefix && hasLongerPrefixAlternatives
						? FILE_SEARCH_PREFIX_EXACT_MATCH_BOOST
						: 1,
				kind: "exact",
			});
		}

		if (allowPrefix) {
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
						(prefixTerms.length > 0
							? FILE_SEARCH_FUZZY_WHEN_PREFIX_EXISTS_BOOST
							: 1),
					kind: "fuzzy",
					fields:
						prefixTerms.length > 0
							? FILE_SEARCH_METADATA_FIELDS
							: undefined,
				});
			}
		}
		if (matchedTerms.size > 0) {
			return {
				matchedTerms: Array.from(matchedTerms.values()),
			};
		}
		return {
			matchedTerms: [],
		};
	}

	private averageFieldLength(field: FileSearchField): number {
		const docCount = this.pathByDocId.size || 1;
		return this.fieldStats[field].totalLength / docCount || 1;
	}

	private getFieldTokens(field: FileSearchField, text: string): string[] {
		const tokens =
			field === "content"
				? this.tokenizer.tokenize(text, "index")
				: this.tokenizer.tokenizeSequence(text, "index");
		return tokens.map((term) => this.normalizeTerm(term));
	}

	private normalizeTerm(term: string): string {
		return this.outerSetting.isCaseSensitive
			? term
			: term.toLocaleLowerCase();
	}

	private computeIdf(df: number): number {
		const docCount = this.pathByDocId.size;
		return Math.log((docCount - df + 0.5) / (df + 0.5) + 1);
	}

	private computeTfNorm(tf: number, dl: number, avgdl: number): number {
		const normalizedAvg = avgdl || 1;
		return (
			(tf * (FILE_SEARCH_BM25_K1 + 1)) /
			(tf +
				FILE_SEARCH_BM25_K1 *
					(1 - FILE_SEARCH_BM25_B + FILE_SEARCH_BM25_B * (dl / normalizedAvg)))
		);
	}

	private insertTermIntoLexicon(term: string) {
		const idx = lowerBoundString(this.sortedTerms, term);
		if (this.sortedTerms[idx] !== term) {
			this.sortedTerms.splice(idx, 0, term);
		}
	}

	private removeTermFromLexicon(term: string) {
		const idx = lowerBoundString(this.sortedTerms, term);
		if (this.sortedTerms[idx] === term) {
			this.sortedTerms.splice(idx, 1);
		}
	}

	private expandPrefixTerms(prefix: string): string[] {
		const terms: string[] = [];
		let idx = lowerBoundString(this.sortedTerms, prefix);
		while (idx < this.sortedTerms.length) {
			const term = this.sortedTerms[idx];
			if (!term.startsWith(prefix)) {
				break;
			}
			terms.push(term);
			if (terms.length >= FILE_SEARCH_PREFIX_EXPANSION_LIMIT) {
				break;
			}
			idx++;
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
		for (const term of this.sortedTerms) {
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

		candidates.sort((a, b) => {
			if (a.distance !== b.distance) {
				return a.distance - b.distance;
			}
			const lengthDeltaA = Math.abs(a.term.length - queryTerm.length);
			const lengthDeltaB = Math.abs(b.term.length - queryTerm.length);
			if (lengthDeltaA !== lengthDeltaB) {
				return lengthDeltaA - lengthDeltaB;
			}
			const sharedPrefixA = countSharedPrefix(queryTerm, a.term);
			const sharedPrefixB = countSharedPrefix(queryTerm, b.term);
			if (sharedPrefixA !== sharedPrefixB) {
				return sharedPrefixB - sharedPrefixA;
			}
			if (a.term.length !== b.term.length) {
				return a.term.length - b.term.length;
			}
			return a.term.localeCompare(b.term);
		});

		return candidates.slice(0, FILE_SEARCH_FUZZY_EXPANSION_LIMIT);
	}

	private applyFieldCoordinationBonus(
		candidateState: CandidateDocState,
		queryTermCount: number,
	) {
		let bestBonus = 0;
		for (const field of FILE_SEARCH_FIELDS) {
			const matches = candidateState.matchedQueryTermsByField.get(field);
			if (!matches || matches.size === 0) continue;
			const coverage = matches.size / Math.max(1, queryTermCount);
			const bonus =
				FILE_SEARCH_FIELD_WEIGHTS[field] *
				coverage *
				matches.size *
				FILE_SEARCH_FIELD_COORDINATION_BONUS;
			bestBonus = Math.max(bestBonus, bonus);
			if (
				FILE_SEARCH_METADATA_FIELDS.includes(field) &&
				matches.size === queryTermCount
			) {
				bestBonus +=
					FILE_SEARCH_FIELD_WEIGHTS[field] *
					FILE_SEARCH_METADATA_FULL_FIELD_COVERAGE_BONUS;
			}
		}

		const metadataMatches = candidateState.matchedMetadataQueryTerms;
		if (metadataMatches && metadataMatches.size > 0) {
			const metadataCoverage =
				metadataMatches.size / Math.max(1, queryTermCount);
			bestBonus = Math.max(
				bestBonus,
				FILE_SEARCH_METADATA_COORDINATION_BONUS *
					metadataCoverage *
					metadataMatches.size,
			);
		}
		const expandedMetadataMatches =
			candidateState.matchedExpandedMetadataQueryTerms;
		if (expandedMetadataMatches && expandedMetadataMatches.size > 0) {
			const expandedMetadataCoverage =
				expandedMetadataMatches.size / Math.max(1, queryTermCount);
			bestBonus +=
				FILE_SEARCH_METADATA_EXPANDED_MATCH_BONUS *
				expandedMetadataCoverage *
				expandedMetadataMatches.size;
		}

		candidateState.score += bestBonus;
	}

	private createMatchedFile(
		docId: number,
		queryTerms: string[],
		candidateState: CandidateDocState,
		scoreBonus: number,
	): MatchedFile {
		return {
			path: this.pathByDocId.get(docId)!,
			queryTerms,
			matchedTerms: Array.from(candidateState.matchedTerms),
			score: candidateState.score + scoreBonus,
		};
	}

	private sortMatchedFiles(results: MatchedFile[]): MatchedFile[] {
		return results.sort((left, right) => {
			const leftScore = left.score ?? 0;
			const rightScore = right.score ?? 0;
			if (rightScore !== leftScore) {
				return rightScore - leftScore;
			}
			return left.path.localeCompare(right.path);
		});
	}
}

@singleton()
export class FileSearchEngineFactory {
	private readonly setting = getInstance(OuterSetting);
	private readonly miniSearch = getInstance(MiniSearchFileEngine);
	private readonly custom = getInstance(CustomFileSearchEngine);
	private readonly passage = getInstance(PassageFileSearchEngine);
	private readonly coverageLexical = getInstance(CoverageLexicalFileSearchEngine);

	getActiveEngine(): FileSearchEngine {
		if (this.setting.fileSearchBackend === "coverage-lexical") {
			return this.coverageLexical;
		}
		if (this.setting.fileSearchBackend === "passage-bm25") {
			return this.passage;
		}
		if (this.setting.fileSearchBackend === "custom-bm25") {
			return this.custom;
		}
		return this.miniSearch;
	}
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
		FILE_SEARCH_MAX_FUZZY_EDITS,
		Math.max(1, Math.round(queryTerm.length * innerSetting.search.fuzzyProportion)),
	);
}

function computePrefixBoost(queryTerm: string, matchedTerm: string): number {
	return Math.max(0.55, Math.min(1, queryTerm.length / Math.max(queryTerm.length, matchedTerm.length)));
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
	for (let j = 0; j <= b.length; j++) {
		prev[j] = j;
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

const fileSearchTextEncoder = new TextEncoder();
const fileSearchTextDecoder = new TextDecoder();

class BinaryWriter {
	private readonly chunks: Uint8Array[] = [];
	private totalLength = 0;

	writeBytes(bytes: ReadonlyArray<number> | Uint8Array) {
		const chunk = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
		this.chunks.push(chunk);
		this.totalLength += chunk.length;
	}

	writeVarUint(value: number) {
		let current = value >>> 0;
		const out: number[] = [];
		do {
			let byte = current & 0x7f;
			current >>>= 7;
			if (current !== 0) {
				byte |= 0x80;
			}
			out.push(byte);
		} while (current !== 0);
		this.writeBytes(out);
	}

	writeString(value: string) {
		const encoded = fileSearchTextEncoder.encode(value);
		this.writeVarUint(encoded.length);
		this.writeBytes(encoded);
	}

	toArrayBuffer(): ArrayBuffer {
		const output = new Uint8Array(this.totalLength);
		let offset = 0;
		for (const chunk of this.chunks) {
			output.set(chunk, offset);
			offset += chunk.length;
		}
		return output.buffer.slice(0);
	}
}

class BinaryReader {
	private readonly bytes: Uint8Array;
	private offset = 0;

	constructor(data: ArrayBuffer) {
		this.bytes = new Uint8Array(data);
	}

	expectBytes(expected: ReadonlyArray<number>) {
		for (const value of expected) {
			if (this.readByte() !== value) {
				throw new Error("Invalid custom file search binary header");
			}
		}
	}

	readVarUint(): number {
		let result = 0;
		let shift = 0;
		while (shift < 35) {
			const byte = this.readByte();
			result |= (byte & 0x7f) << shift;
			if ((byte & 0x80) === 0) {
				return result >>> 0;
			}
			shift += 7;
		}
		throw new Error("Invalid varint in custom file search binary");
	}

	readString(): string {
		const length = this.readVarUint();
		const start = this.offset;
		const end = start + length;
		if (end > this.bytes.length) {
			throw new Error("Unexpected EOF while reading custom file search string");
		}
		this.offset = end;
		return fileSearchTextDecoder.decode(this.bytes.subarray(start, end));
	}

	private readByte(): number {
		if (this.offset >= this.bytes.length) {
			throw new Error("Unexpected EOF while reading custom file search binary");
		}
		return this.bytes[this.offset++];
	}
}

function countSharedPrefix(prev: string, current: string): number {
	const limit = Math.min(prev.length, current.length);
	let index = 0;
	while (index < limit && prev[index] === current[index]) {
		index++;
	}
	return index;
}

function isSerializedBinaryCustomFileSearchIndex(
	data: SerializedFileSearchIndex,
): data is SerializedBinaryCustomFileSearchIndex {
	return (
		typeof data === "object" &&
		data !== null &&
		(data as Record<string, unknown>).__backend === "custom-bm25" &&
		(data as Record<string, unknown>).__version === 6 &&
		(data as Record<string, unknown>).__encoding === "binary" &&
		(data as Record<string, unknown>).data instanceof ArrayBuffer
	);
}

function isSerializedPassageFileSearchSnapshot(
	data: SerializedFileSearchIndex,
): data is SerializedPassageFileSearchSnapshot {
	return (
		typeof data === "object" &&
		data !== null &&
		(data as Record<string, unknown>).__backend === "passage-bm25" &&
		(data as Record<string, unknown>).__version === 3 &&
		(data as Record<string, unknown>).__format === "structural-snapshot" &&
		Array.isArray((data as Record<string, unknown>).documents)
	);
}

function isSerializedMiniSearchFileIndex(
	data: SerializedFileSearchIndex,
): data is AsPlainObject {
	return (
		typeof data === "object" &&
		data !== null &&
		!isSerializedBinaryCustomFileSearchIndex(data) &&
		!isSerializedPassageFileSearchSnapshot(data)
	);
}
