import type { BaseIndexedFileRef } from "src/globals/search-types";
import type {
	CoverageLexicalV2CandidateCascadeHanBackstopStats,
	CoverageLexicalV2CandidateCascadePostingField,
	CoverageLexicalV2CandidateCascadeStorageReader,
} from "../candidate-cascade";
import {
	getCoverageLexicalV2CandidateCascadeMatchQuality,
	isCoverageLexicalV2LatinCandidateCascadeTerm,
} from "../candidate-cascade/coverage-lexical-candidate-match";
import {
	createCoverageLexicalV2CanonicalTermPool,
	clearCoverageLexicalV2CanonicalTermPool,
	decodeCoverageLexicalV2CanonicalTerm,
	estimateCoverageLexicalV2CanonicalTermPoolBytes,
	findCoverageLexicalV2CanonicalTermId,
	getCoverageLexicalV2CanonicalTermCount,
	internCoverageLexicalV2CanonicalTerm,
	restoreCoverageLexicalV2CanonicalTermPool,
	serializeCoverageLexicalV2CanonicalTermPool,
	type CoverageLexicalV2CanonicalTermPool,
} from "./coverage-lexical-v2-canonical-term-pool";
import {
	COVERAGE_LEXICAL_V2_HAN_SEGMENT_SEPARATOR_ID,
	createCoverageLexicalV2HanSymbolPool,
	clearCoverageLexicalV2HanSymbolPool,
	findCoverageLexicalV2HanSymbolId,
	getOrCreateCoverageLexicalV2HanSymbolId,
	restoreCoverageLexicalV2HanSymbolPool,
	serializeCoverageLexicalV2HanSymbolPool,
	type CoverageLexicalV2HanSymbolPool,
} from "./coverage-lexical-v2-han-symbol-pool";
import {
	buildCoverageLexicalV2ResidentSegment,
	decodeCoverageLexicalV2ResidentAdaptivePosting,
	decodeCoverageLexicalV2ResidentBodyPosting,
	decodeCoverageLexicalV2ResidentSegmentPosting,
	estimateCoverageLexicalV2ResidentSegmentBytes,
} from "./coverage-lexical-v2-index-store-codec";
import {
	COVERAGE_LEXICAL_V2_INDEX_STORE_SCHEMA_VERSION,
	type CoverageLexicalV2CanonicalTermId,
	type CoverageLexicalV2FieldTermLists,
	type CoverageLexicalV2FieldTermIdLists,
	type CoverageLexicalV2HanBigramId,
	type CoverageLexicalV2HanGateBloomWord,
	type CoverageLexicalV2HanSymbolId,
	type CoverageLexicalV2IndexStoreDocumentState,
	type CoverageLexicalV2IndexStoreOverlayState,
	type CoverageLexicalV2IndexStorePersistedDocManifest,
	type CoverageLexicalV2PersistedJournalDocument,
	type CoverageLexicalV2IndexStoreReaderOptions,
	type CoverageLexicalV2IndexStoreResidentSegment,
	type CoverageLexicalV2IndexStoreRuntimeDocManifest,
	type CoverageLexicalV2IndexStoreSnapshotDocument,
	type CoverageLexicalV2IndexStoreSnapshotState,
	type CoverageLexicalV2MetadataBigramLists,
	type CoverageLexicalV2MetadataBigramIdLists,
	type CoverageLexicalV2MetadataPostingField,
	type CoverageLexicalV2PreparedDocument,
	type CoverageLexicalV2RuntimeMemoryBreakdown,
} from "./coverage-lexical-v2-index-store-types";
import {
	buildCoverageLexicalV2PreparedStreamingSubsequence,
	collectCoverageLexicalV2NumericBigramMatchIndices,
	containsCoverageLexicalV2NumericSubsequence,
	encodeCoverageLexicalV2NumericTokenTape,
	type CoverageLexicalV2PreparedStreamingSubsequence,
	type CoverageLexicalV2TokenRange,
} from "./coverage-lexical-v2-shared-token-ids";

type CoverageLexicalV2InternalDocumentState = CoverageLexicalV2IndexStoreDocumentState;

type CoverageLexicalV2MutableStringPostingDelta<Field extends string> = Record<
	Field,
	Map<string, number[]>
>;

type CoverageLexicalV2MutableNumericPostingDelta<Field extends string> = Record<
	Field,
	Map<CoverageLexicalV2CanonicalTermId, number[]>
>;

type CoverageLexicalV2MutableOverlayState = {
	exactAddsByField: CoverageLexicalV2MutableNumericPostingDelta<
		CoverageLexicalV2CandidateCascadePostingField
	>;
	exactRemovalsByField: CoverageLexicalV2MutableNumericPostingDelta<
		CoverageLexicalV2CandidateCascadePostingField
	>;
	metadataHanAddsByField: CoverageLexicalV2MutableStringPostingDelta<
		CoverageLexicalV2MetadataPostingField
	>;
	metadataHanRemovalsByField: CoverageLexicalV2MutableStringPostingDelta<
		CoverageLexicalV2MetadataPostingField
	>;
};

type CoverageLexicalV2RuntimeMemoryBreakdownOptions = {
	bodyTokensHotBytes?: number;
	bodyTokensHotVsSidecarBytes?: number;
};

const COVERAGE_LEXICAL_V2_POSTING_FIELDS = [
	"basename",
	"aliases",
	"headings",
	"folder",
	"tag",
	"body",
] as const satisfies readonly CoverageLexicalV2CandidateCascadePostingField[];

const COVERAGE_LEXICAL_V2_METADATA_FIELDS = [
	"basename",
	"aliases",
	"headings",
	"folder",
	"tag",
] as const satisfies readonly CoverageLexicalV2MetadataPostingField[];

const textEncoder = new TextEncoder();
const AUTO_COMPACTION_MUTATION_CAP = 48;
const EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST = Object.freeze(
	[],
) as readonly string[];
const EMPTY_COVERAGE_LEXICAL_V2_NUMBER_LIST = Object.freeze(
	[],
) as readonly number[];
const EMPTY_COVERAGE_LEXICAL_V2_FIELD_TERM_LISTS = Object.freeze({
	basename: EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST,
	aliases: EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST,
	headings: EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST,
	folder: EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST,
	tag: EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST,
	body: EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST,
}) as CoverageLexicalV2FieldTermLists;
const EMPTY_COVERAGE_LEXICAL_V2_FIELD_TERM_ID_LISTS = Object.freeze({
	basename: EMPTY_COVERAGE_LEXICAL_V2_NUMBER_LIST,
	aliases: EMPTY_COVERAGE_LEXICAL_V2_NUMBER_LIST,
	headings: EMPTY_COVERAGE_LEXICAL_V2_NUMBER_LIST,
	folder: EMPTY_COVERAGE_LEXICAL_V2_NUMBER_LIST,
	tag: EMPTY_COVERAGE_LEXICAL_V2_NUMBER_LIST,
	body: EMPTY_COVERAGE_LEXICAL_V2_NUMBER_LIST,
}) as CoverageLexicalV2FieldTermIdLists;
const EMPTY_COVERAGE_LEXICAL_V2_METADATA_BIGRAM_LISTS = Object.freeze({
	basename: EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST,
	aliases: EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST,
	headings: EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST,
	folder: EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST,
	tag: EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST,
}) as CoverageLexicalV2MetadataBigramLists;
const EMPTY_COVERAGE_LEXICAL_V2_METADATA_BIGRAM_ID_LISTS = Object.freeze({
	basename: EMPTY_COVERAGE_LEXICAL_V2_NUMBER_LIST,
	aliases: EMPTY_COVERAGE_LEXICAL_V2_NUMBER_LIST,
	headings: EMPTY_COVERAGE_LEXICAL_V2_NUMBER_LIST,
	folder: EMPTY_COVERAGE_LEXICAL_V2_NUMBER_LIST,
	tag: EMPTY_COVERAGE_LEXICAL_V2_NUMBER_LIST,
}) as CoverageLexicalV2MetadataBigramIdLists;
const EMPTY_COVERAGE_LEXICAL_V2_NUMBER_SEGMENT_LIST = Object.freeze(
	[],
) as readonly (readonly number[])[];
const MISSING_COVERAGE_LEXICAL_V2_HAN_SYMBOL_ID = -1;
const COVERAGE_LEXICAL_V2_HAN_BIGRAM_HASH_OFFSET_BASIS = 2166136261;
const COVERAGE_LEXICAL_V2_HAN_BIGRAM_HASH_PRIME = 16777619;
const COVERAGE_LEXICAL_V2_HAN_GATE_BLOOM_WORD_COUNT = 16;
const COVERAGE_LEXICAL_V2_HAN_GATE_BLOOM_HASH_COUNT = 3;
const EMPTY_COVERAGE_LEXICAL_V2_HAN_GATE_BLOOM_WORDS = Object.freeze(
	new Array<number>(COVERAGE_LEXICAL_V2_HAN_GATE_BLOOM_WORD_COUNT).fill(0),
) as readonly CoverageLexicalV2HanGateBloomWord[];

export class CoverageLexicalV2IndexStore {
	private nextDocumentId = 0;
	private readonly documentById: Array<CoverageLexicalV2InternalDocumentState | undefined> =
		[];
	private readonly documentIdByPath = new Map<string, number>();
	private readonly bodyHanSegmentDocIds: number[] = [];
	private readonly exactTermRefCounts = new Map<number, number>();
	private readonly metadataHanBigramRefCounts = new Map<number, number>();
	private readonly residentSegments: CoverageLexicalV2IndexStoreResidentSegment[] = [];
	private readonly overlay: CoverageLexicalV2MutableOverlayState =
		createCoverageLexicalV2MutableOverlayState();
	private readonly canonicalTermPool: CoverageLexicalV2CanonicalTermPool =
		createCoverageLexicalV2CanonicalTermPool();
	private readonly hanSymbolPool: CoverageLexicalV2HanSymbolPool =
		createCoverageLexicalV2HanSymbolPool();
	private latinExpansionTermIdsCache: CoverageLexicalV2CanonicalTermId[] = [];
	private latinExpansionTermsDirty = true;
	private overlayMutationCount = 0;
	private bodyTokenSidecarEstimatedBytes = 0;
	private bodyHanSegmentExactSidecarEstimatedBytes = 0;
	private preparedHanBackstopCache:
		| {
				key: string;
				symbolIds: readonly CoverageLexicalV2HanSymbolId[];
				hasMissingSymbols: boolean;
				bigramIndexByKey: ReadonlyMap<string, number>;
				preparedSubsequence: CoverageLexicalV2PreparedStreamingSubsequence;
		  }
		| null = null;

	clear(): void {
		this.nextDocumentId = 0;
		this.documentById.length = 0;
		this.documentIdByPath.clear();
		this.bodyHanSegmentDocIds.length = 0;
		this.exactTermRefCounts.clear();
		this.metadataHanBigramRefCounts.clear();
		this.residentSegments.length = 0;
		clearCoverageLexicalV2MutableOverlayState(this.overlay);
		clearCoverageLexicalV2CanonicalTermPool(this.canonicalTermPool);
		clearCoverageLexicalV2HanSymbolPool(this.hanSymbolPool);
		this.latinExpansionTermIdsCache = [];
		this.latinExpansionTermsDirty = true;
		this.overlayMutationCount = 0;
		this.bodyTokenSidecarEstimatedBytes = 0;
		this.bodyHanSegmentExactSidecarEstimatedBytes = 0;
		this.preparedHanBackstopCache = null;
	}

	getIndexedDocumentCount(): number {
		return this.documentIdByPath.size;
	}

	hasPath(path: string): boolean {
		return this.documentIdByPath.has(path);
	}

	getDocumentId(path: string): number | undefined {
		return this.documentIdByPath.get(path);
	}

	getDocumentPath(docId: number): string | undefined {
		return this.documentById[docId]?.path;
	}

	getDocumentGeneration(docId: number): number | undefined {
		return this.documentById[docId]?.generation;
	}

	getBodyHanSegmentExactSidecarMetadata(
		docId: number,
	): CoverageLexicalV2IndexStoreRuntimeDocManifest["bodyHanSegmentExactSidecar"] | null {
		return this.documentById[docId]?.manifest.bodyHanSegmentExactSidecar ?? null;
	}

	getIndexedRefs(): BaseIndexedFileRef[] {
		return this.documentById.flatMap((documentState) =>
			documentState ? [{ ...documentState.indexedRef }] : [],
		);
	}

	getStructuralInvalidityReason():
		| "snapshot_corrupted"
		| "doc_registry_conflict"
		| "manifest_missing"
		| null {
		const seenPaths = new Set<string>();
		for (let docId = 0; docId < this.documentById.length; docId += 1) {
			const documentState = this.documentById[docId];
			if (!documentState) {
				continue;
			}
			if (documentState.docId !== docId) {
				return "doc_registry_conflict";
			}
			if (seenPaths.has(documentState.path)) {
				return "doc_registry_conflict";
			}
			seenPaths.add(documentState.path);
			const manifest = documentState.manifest;
			if (
				!manifest ||
				manifest.hasBodyHanSegments !==
					(manifest.bodyHanSegmentExactSidecar.segmentCount > 0) ||
				!Array.isArray(manifest.bodyHanGateBloomWords) ||
				manifest.bodyHanGateBloomWords.length !==
					COVERAGE_LEXICAL_V2_HAN_GATE_BLOOM_WORD_COUNT ||
				!Number.isFinite(manifest.bodyHanSegmentExactSidecar.estimatedBytes) ||
				manifest.bodyHanSegmentExactSidecar.estimatedBytes < 0 ||
				!Number.isFinite(manifest.bodyHanSegmentExactSidecar.segmentCount) ||
				manifest.bodyHanSegmentExactSidecar.segmentCount < 0 ||
				!Number.isFinite(manifest.bodyTokenSidecar.estimatedBytes) ||
				manifest.bodyTokenSidecar.estimatedBytes < 0 ||
				!Number.isFinite(manifest.bodyTokenSidecar.tokenCount) ||
				manifest.bodyTokenSidecar.tokenCount < 0
			) {
				return "manifest_missing";
			}
		}

		try {
			for (const segment of this.residentSegments) {
				for (const fieldSegment of Object.values(segment.metadataHanByField)) {
					for (const termId of iterateCoverageLexicalV2AdaptiveSegmentTermIds(
						fieldSegment,
					)) {
						void decodeCoverageLexicalV2ResidentSegmentPosting(fieldSegment, termId);
					}
				}
				for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
					const fieldSegment = segment.exactByField[field];
					for (const termId of iterateCoverageLexicalV2AdaptiveSegmentTermIds(
						fieldSegment,
					)) {
						void decodeCoverageLexicalV2ResidentAdaptivePosting(
							fieldSegment,
							termId,
						);
					}
				}
				for (const termId of iterateCoverageLexicalV2AdaptiveSegmentTermIds(
					segment.exactByField.body,
				)) {
					void decodeCoverageLexicalV2ResidentBodyPosting(
						segment.exactByField.body,
						termId,
					);
				}
			}
		} catch {
			return "snapshot_corrupted";
		}

		return null;
	}

	replaceDocument(
		document: CoverageLexicalV2PreparedDocument,
		previousPath?: string,
	): number {
		const recycledDocId = previousPath
			? this.documentIdByPath.get(previousPath)
			: undefined;
		const existingDocId = this.documentIdByPath.get(document.path);
		let docId = recycledDocId ?? existingDocId;

		if (
			previousPath &&
			previousPath !== document.path &&
			existingDocId !== undefined &&
			existingDocId !== recycledDocId
		) {
			this.deleteDocumentById(existingDocId);
		}

		if (docId !== undefined) {
			this.removeDocumentStateById(docId);
		} else {
			docId = this.nextDocumentId;
			this.nextDocumentId += 1;
		}

		const stored = this.buildInternalDocumentState(docId, document);
		this.documentById[docId] = stored;
		this.documentIdByPath.set(document.path, docId);
		if (previousPath && previousPath !== document.path) {
			this.documentIdByPath.delete(previousPath);
		}
		this.applyDocumentAddition(stored);
		this.syncBodyHanSegmentDocId(docId, stored.manifest.hasBodyHanSegments);
		this.bodyTokenSidecarEstimatedBytes +=
			stored.manifest.bodyTokenSidecar.estimatedBytes;
		this.bodyHanSegmentExactSidecarEstimatedBytes +=
			stored.manifest.bodyHanSegmentExactSidecar.estimatedBytes;
		this.latinExpansionTermsDirty = true;
		return docId;
	}

	replacePersistedJournalDocument(
		document: CoverageLexicalV2PersistedJournalDocument,
		previousPath?: string,
	): number {
		const recycledDocId = previousPath
			? this.documentIdByPath.get(previousPath)
			: undefined;
		const existingDocId = this.documentIdByPath.get(document.path);
		let docId = recycledDocId ?? existingDocId;

		if (
			previousPath &&
			previousPath !== document.path &&
			existingDocId !== undefined &&
			existingDocId !== recycledDocId
		) {
			this.deleteDocumentById(existingDocId);
		}

		if (docId !== undefined) {
			this.removeDocumentStateById(docId);
		} else {
			docId = this.nextDocumentId;
			this.nextDocumentId += 1;
		}

		const stored = this.buildInternalDocumentStateFromPersistedJournal(
			docId,
			document,
		);
		this.documentById[docId] = stored;
		this.documentIdByPath.set(document.path, docId);
		if (previousPath && previousPath !== document.path) {
			this.documentIdByPath.delete(previousPath);
		}
		this.applyDocumentAddition(stored);
		this.syncBodyHanSegmentDocId(docId, stored.manifest.hasBodyHanSegments);
		this.bodyTokenSidecarEstimatedBytes +=
			stored.manifest.bodyTokenSidecar.estimatedBytes;
		this.bodyHanSegmentExactSidecarEstimatedBytes +=
			stored.manifest.bodyHanSegmentExactSidecar.estimatedBytes;
		this.latinExpansionTermsDirty = true;
		return docId;
	}

	deleteDocument(path: string): void {
		const docId = this.documentIdByPath.get(path);
		if (docId === undefined) {
			return;
		}
		this.deleteDocumentById(docId);
	}

	compactOverlayIntoSegment(force = false): boolean {
		const exactPostings = createCoverageLexicalV2MutableExactPostingMaps();
		const metadataPostings = createCoverageLexicalV2MutableMetadataPostingMaps();

		for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
			for (const [termId, docIds] of this.overlay.exactAddsByField[field]) {
				if (docIds.length > 0) {
					exactPostings[field].set(termId, [...docIds]);
				}
			}
		}
		for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
			for (const [bigram, docIds] of this.overlay.metadataHanAddsByField[field]) {
				if (docIds.length > 0) {
					metadataPostings[field].set(bigram, [...docIds]);
				}
			}
		}

		const docCount = countCoverageLexicalV2PostingMapsDocumentCount(
			exactPostings,
			metadataPostings,
		);
		if (!force && docCount === 0 && this.overlayMutationCount < AUTO_COMPACTION_MUTATION_CAP) {
			return false;
		}

		if (docCount > 0) {
			this.residentSegments.push(
				buildCoverageLexicalV2ResidentSegment({
					id: `segment:${Date.now()}:${this.residentSegments.length}`,
					createdAt: Date.now(),
					docCount,
					exactByField: exactPostings,
					metadataHanByField: metadataPostings,
					getCanonicalTermId: (term) => this.findCanonicalTermId(term),
				}),
			);
		}

		clearCoverageLexicalV2MutableOverlayAdditions(this.overlay);
		this.overlayMutationCount = countCoverageLexicalV2MutableOverlayMutationCount(
			this.overlay,
		);
		return docCount > 0;
	}

	restoreSnapshot(snapshot: CoverageLexicalV2IndexStoreSnapshotState): void {
		if (
			snapshot.schemaVersion !== COVERAGE_LEXICAL_V2_INDEX_STORE_SCHEMA_VERSION
		) {
			throw new Error("Unsupported coverage lexical V2 index-store snapshot");
		}

		this.clear();
		this.nextDocumentId = snapshot.nextDocumentId;
		restoreCoverageLexicalV2CanonicalTermPool(
			this.canonicalTermPool,
			snapshot.canonicalTermPool,
		);
		restoreCoverageLexicalV2HanSymbolPool(
			this.hanSymbolPool,
			snapshot.hanSymbolPool,
		);
		this.residentSegments.push(
			...snapshot.segments.map(cloneCoverageLexicalV2ResidentSegment),
		);
		restoreCoverageLexicalV2MutableOverlayState(this.overlay, snapshot.overlay);
		this.overlayMutationCount = countCoverageLexicalV2MutableOverlayMutationCount(
			this.overlay,
		);

		const documents = [...snapshot.documents].sort((left, right) => left.docId - right.docId);
		for (const document of documents) {
			if (
				document.docId < 0 ||
				!Number.isInteger(document.docId) ||
				this.documentById[document.docId] ||
				this.documentIdByPath.has(document.path)
			) {
				throw new Error("Invalid coverage lexical V2 document registry");
			}
			const documentState =
				this.buildInternalDocumentStateFromSnapshotDocument(document);
			this.documentById[documentState.docId] = documentState;
			this.documentIdByPath.set(documentState.path, documentState.docId);
			this.syncBodyHanSegmentDocId(
				documentState.docId,
				documentState.manifest.hasBodyHanSegments,
			);
			incrementCoverageLexicalV2TermRefCounts(
				this.exactTermRefCounts,
				documentState.manifest.exactTermIdsByField,
			);
			incrementCoverageLexicalV2BigramRefCounts(
				this.metadataHanBigramRefCounts,
				documentState.manifest.metadataHanBigramIdsByField,
			);
			this.bodyTokenSidecarEstimatedBytes +=
				documentState.manifest.bodyTokenSidecar.estimatedBytes;
			this.bodyHanSegmentExactSidecarEstimatedBytes +=
				documentState.manifest.bodyHanSegmentExactSidecar.estimatedBytes;
		}

		const minimumNextDocumentId =
			documents.length === 0 ? 0 : documents[documents.length - 1].docId + 1;
		this.nextDocumentId = Math.max(this.nextDocumentId, minimumNextDocumentId);
		this.latinExpansionTermsDirty = true;
	}

	buildSnapshotState(): CoverageLexicalV2IndexStoreSnapshotState {
		return {
			schemaVersion: COVERAGE_LEXICAL_V2_INDEX_STORE_SCHEMA_VERSION,
			nextDocumentId: this.nextDocumentId,
			snapshotCreatedAt: Date.now(),
			canonicalTermPool: serializeCoverageLexicalV2CanonicalTermPool(
				this.canonicalTermPool,
			),
			hanSymbolPool: serializeCoverageLexicalV2HanSymbolPool(this.hanSymbolPool),
			documents: this.documentById.flatMap((documentState) =>
				documentState ? [toCoverageLexicalV2SnapshotDocument(documentState)] : [],
			),
			segments: this.residentSegments.map(cloneCoverageLexicalV2ResidentSegment),
			overlay: serializeCoverageLexicalV2MutableOverlayState(this.overlay),
		};
	}

	createStorageReader(
		options: CoverageLexicalV2IndexStoreReaderOptions,
	): CoverageLexicalV2CandidateCascadeStorageReader {
		return {
			readerKind: "v2_runtime",
			getDocumentRecord: (docId) => this.documentById[docId]?.record ?? null,
			getBodyHanSegmentDocIds: () => this.bodyHanSegmentDocIds,
			getPostingMatches: (field, term) => this.getExactPostingMatches(field, term),
			getMetadataHanBigramPostingMatches: (field, bigram) =>
				field === "body"
					? undefined
					: this.getMetadataHanBigramPostingMatches(field, bigram),
			getBodyHanBackstopGateStats: (docId, bigrams) =>
				this.getBodyHanBackstopGateStats(docId, bigrams),
			prefetchBodyHanExact: options.prefetchBodyHanExact,
			getBodyHanExactBackstopStats: options.getBodyHanExactBackstopStats,
			collectLatinPrefixTerms: (queryTerm, cap) =>
				this.collectLatinPrefixTerms(queryTerm, cap),
			collectLatinFuzzyTerms: (queryTerm, cap, fuzzyProportion) =>
				this.collectLatinFuzzyTerms(queryTerm, cap, fuzzyProportion),
			getBodyTokenSequence: options.getBodyTokenSequence,
			prefetchBodyTokenSequences: options.prefetchBodyTokenSequences,
			tokenizeText: options.tokenizeText,
		};
	}

	estimateIndexBytes(
		options: CoverageLexicalV2RuntimeMemoryBreakdownOptions = {},
	): number {
		return this.buildIndexBreakdown(options).estimatedBytes.residentHot.total;
	}

	buildIndexBreakdown(
		options: CoverageLexicalV2RuntimeMemoryBreakdownOptions = {},
	): CoverageLexicalV2RuntimeMemoryBreakdown {
		let exactIncidence = 0;
		let metadataHanGate = 0;
		let documentView = 0;
		let bodyHanSegments = this.bodyHanSegmentDocIds.length * 4;
		let pathMirrors = 0;
		let manifestMirrors = 0;
		const canonicalTermLexiconBytes = estimateCoverageLexicalV2CanonicalTermPoolBytes(
			this.canonicalTermPool,
		);

		for (const segment of this.residentSegments) {
			const estimated = estimateCoverageLexicalV2ResidentSegmentBytes(segment);
			exactIncidence += estimated.exactIncidence;
			metadataHanGate += estimated.metadataHanGate;
		}
		exactIncidence += estimateCoverageLexicalV2MutableNumericPostingDeltaBytes(
			this.overlay.exactAddsByField,
		);
		exactIncidence += estimateCoverageLexicalV2MutableNumericPostingDeltaBytes(
			this.overlay.exactRemovalsByField,
		);
		metadataHanGate += estimateCoverageLexicalV2MutableStringPostingDeltaBytes(
			this.overlay.metadataHanAddsByField,
		);
		metadataHanGate += estimateCoverageLexicalV2MutableStringPostingDeltaBytes(
			this.overlay.metadataHanRemovalsByField,
		);

		for (const documentState of this.documentById) {
			if (!documentState) {
				continue;
			}
			documentView += estimateCoverageLexicalV2DocumentViewBytes(documentState);
			bodyHanSegments +=
				documentState.manifest.bodyHanGateBloomWords.length * 4;
			pathMirrors += estimateCoverageLexicalV2DocumentPathMirrorBytes(
				documentState,
			);
			manifestMirrors += estimateCoverageLexicalV2DocumentManifestMirrorBytes(
				documentState,
			);
		}

		const latinExpansionTermIds = this.getLatinExpansionTermIds();
		const latinExpansionLexicon = estimateCoverageLexicalV2LatinExpansionBytes(
			latinExpansionTermIds,
		);
		const bodyTokensHot = Math.max(0, options.bodyTokensHotBytes ?? 0);
		const bodyTokensHotVsSidecar = Math.max(
			0,
			options.bodyTokensHotVsSidecarBytes ?? 0,
		);
		const residentHotTotal =
			exactIncidence +
			metadataHanGate +
			documentView +
			bodyHanSegments +
			canonicalTermLexiconBytes +
			latinExpansionLexicon +
			bodyTokensHot;
		const coldOwnedTotal =
			this.bodyTokenSidecarEstimatedBytes +
			this.bodyHanSegmentExactSidecarEstimatedBytes;
		const overlapDiagnosticsTotal =
			bodyTokensHotVsSidecar + pathMirrors + manifestMirrors;

		return {
			documentCount: this.getIndexedDocumentCount(),
			nextDocumentId: this.nextDocumentId,
			exactTermCount: countCoverageLexicalV2PositiveRefCounts(
				this.exactTermRefCounts,
			),
			metadataHanBigramCount: countCoverageLexicalV2PositiveRefCounts(
				this.metadataHanBigramRefCounts,
			),
			latinExpansionTermCount: latinExpansionTermIds.length,
			segmentCount: this.residentSegments.length,
			estimatedBytes: {
				residentHot: {
					total: residentHotTotal,
					postings: {
						exactIncidence,
						metadataHanGate,
					},
					documents: {
						view: documentView,
					},
					verification: {
						bodyHanSegments,
					},
					lexicon: {
						canonicalTerms: canonicalTermLexiconBytes,
						latinExpansion: latinExpansionLexicon,
					},
					caches: {
						bodyTokensHot,
					},
				},
				coldOwned: {
					total: coldOwnedTotal,
					bodyTokensSidecar: this.bodyTokenSidecarEstimatedBytes,
					bodyHanSegmentExactSidecar:
						this.bodyHanSegmentExactSidecarEstimatedBytes,
				},
				overlapDiagnostics: {
					total: overlapDiagnosticsTotal,
					bodyTokensHotVsSidecar,
					pathMirrors,
					manifestMirrors,
				},
				combinedOwnedTotal: residentHotTotal + coldOwnedTotal,
			},
		};
	}

	private getExactPostingMatches(
		field: CoverageLexicalV2CandidateCascadePostingField,
		term: string,
	): readonly number[] | undefined {
		const termId = this.findCanonicalTermId(term);
		if (termId === undefined) {
			return undefined;
		}
		if ((this.exactTermRefCounts.get(termId) ?? 0) <= 0) {
			return undefined;
		}
		if (field === "body") {
			return this.collectPostingMatches(
				this.residentSegments.map((segment) =>
					decodeCoverageLexicalV2ResidentBodyPosting(
						segment.exactByField.body,
						termId,
					),
				),
				this.overlay.exactAddsByField.body.get(termId),
				this.overlay.exactRemovalsByField.body.get(termId),
			);
		}
		return this.collectPostingMatches(
			this.residentSegments.map((segment) =>
				decodeCoverageLexicalV2ResidentAdaptivePosting(
					segment.exactByField[field],
					termId,
				),
			),
			this.overlay.exactAddsByField[field].get(termId),
			this.overlay.exactRemovalsByField[field].get(termId),
		);
	}

	private getMetadataHanBigramPostingMatches(
		field: CoverageLexicalV2MetadataPostingField,
		bigram: string,
	): readonly number[] | undefined {
		const termId = this.findCanonicalTermId(bigram);
		if (termId === undefined) {
			return undefined;
		}
		if ((this.metadataHanBigramRefCounts.get(termId) ?? 0) <= 0) {
			return undefined;
		}
		return this.collectPostingMatches(
			this.residentSegments.map((segment) =>
				decodeCoverageLexicalV2ResidentSegmentPosting(
					segment.metadataHanByField[field],
					termId,
				),
			),
			this.overlay.metadataHanAddsByField[field].get(bigram),
			this.overlay.metadataHanRemovalsByField[field].get(bigram),
		);
	}

	getBodyHanBackstopGateStats(
		docId: number,
		bigrams: readonly string[],
	): CoverageLexicalV2CandidateCascadeHanBackstopStats | null {
		const bodyHanGateBloomWords =
			this.documentById[docId]?.manifest.bodyHanGateBloomWords;
		if (
			!bodyHanGateBloomWords ||
			bodyHanGateBloomWords.length !== COVERAGE_LEXICAL_V2_HAN_GATE_BLOOM_WORD_COUNT
		) {
			return null;
		}
		const matchedBigramIndices = new Set<number>();
		for (let index = 0; index < bigrams.length; index += 1) {
			const bigramId = encodeCoverageLexicalV2HanBigramId(bigrams[index]);
			if (
				bigramId !== undefined &&
				mightContainCoverageLexicalV2HanBigramId(
					bodyHanGateBloomWords,
					bigramId,
				)
			) {
				matchedBigramIndices.add(index);
			}
		}
		if (matchedBigramIndices.size === 0) {
			return null;
		}
		return {
			longestContiguousBigramChain: computeCoverageLexicalV2HanBackstopLongestChain(
				matchedBigramIndices,
			),
			matchedBigramCount: matchedBigramIndices.size,
			bigramCoverageRatio:
				bigrams.length > 0 ? matchedBigramIndices.size / bigrams.length : 0,
		};
	}

	buildBodyHanExactBackstopStatsFromSymbolIds(
		bodyHanSymbolIds: readonly number[] | Uint32Array,
		normalizedText: string,
		bigrams: readonly string[],
	): CoverageLexicalV2CandidateCascadeHanBackstopStats | null {
		const symbolIds = Array.from(bodyHanSymbolIds);
		if (symbolIds.length === 0) {
			return null;
		}
		const preparedQuery = this.prepareHanBackstopQuery(normalizedText, bigrams);
		if (
			preparedQuery.symbolIds.length === 0 ||
			(preparedQuery.hasMissingSymbols &&
				preparedQuery.bigramIndexByKey.size === 0)
		) {
			return null;
		}
		if (
			!preparedQuery.hasMissingSymbols &&
			containsCoverageLexicalV2NumericSubsequence(
				symbolIds,
				preparedQuery.symbolIds,
			)
		) {
			return {
				longestContiguousBigramChain: bigrams.length,
				matchedBigramCount: bigrams.length,
				bigramCoverageRatio: bigrams.length > 0 ? 1 : 0,
			};
		}
		if (bigrams.length === 0) {
			return null;
		}
		const matchedBigramIndices = collectCoverageLexicalV2NumericBigramMatchIndices(
			symbolIds,
			preparedQuery.symbolIds,
		);
		if (matchedBigramIndices.size === 0) {
			return null;
		}
		return {
			longestContiguousBigramChain: computeCoverageLexicalV2HanBackstopLongestChain(
				matchedBigramIndices,
			),
			matchedBigramCount: matchedBigramIndices.size,
			bigramCoverageRatio:
				bigrams.length > 0 ? matchedBigramIndices.size / bigrams.length : 0,
		};
	}

	private prepareHanBackstopQuery(
		normalizedText: string,
		bigrams: readonly string[],
	): {
		symbolIds: readonly CoverageLexicalV2HanSymbolId[];
		hasMissingSymbols: boolean;
		bigramIndexByKey: ReadonlyMap<string, number>;
		preparedSubsequence: CoverageLexicalV2PreparedStreamingSubsequence;
	} {
		const cacheKey = normalizedText + "\u0001" + bigrams.join("\u0002");
		if (this.preparedHanBackstopCache?.key === cacheKey) {
			return this.preparedHanBackstopCache;
		}
		const symbolIds = toCoverageLexicalV2HanSymbolIds(
			normalizedText,
			this.hanSymbolPool,
		);
		const hasMissingSymbols = symbolIds.includes(
			MISSING_COVERAGE_LEXICAL_V2_HAN_SYMBOL_ID,
		);
		const bigramIndexByKey = new Map<string, number>();
		for (let index = 0; index < symbolIds.length - 1; index += 1) {
			const left = symbolIds[index];
			const right = symbolIds[index + 1];
			if (
				left <= COVERAGE_LEXICAL_V2_HAN_SEGMENT_SEPARATOR_ID ||
				right <= COVERAGE_LEXICAL_V2_HAN_SEGMENT_SEPARATOR_ID
			) {
				continue;
			}
			bigramIndexByKey.set(
				String(left) + ":" + String(right),
				index,
			);
		}
		const exactNeedle = hasMissingSymbols
			? EMPTY_COVERAGE_LEXICAL_V2_NUMBER_LIST
			: symbolIds;
		const prepared = {
			key: cacheKey,
			symbolIds,
			hasMissingSymbols,
			bigramIndexByKey,
			preparedSubsequence: buildCoverageLexicalV2PreparedStreamingSubsequence(
				exactNeedle,
			),
		};
		this.preparedHanBackstopCache = prepared;
		return prepared;
	}

	private buildInternalDocumentState(
		docId: number,
		document: CoverageLexicalV2PreparedDocument,
	): CoverageLexicalV2InternalDocumentState {
		this.ensureCanonicalTermIds(document.exactTermsByField);
		this.ensureCanonicalBigramIds(document.metadataHanBigramsByField);
		const encodedHan = encodeCoverageLexicalV2HanSegmentsToSymbolIds(
			document.bodyHanSegments,
			(codePoint) =>
				getOrCreateCoverageLexicalV2HanSymbolId(this.hanSymbolPool, codePoint),
		);
		const stableDeterministicKey =
			document.record.stableDeterministicKey ?? document.path;
		const indexedRef: BaseIndexedFileRef = {
			...document.indexedRef,
			path: document.path,
			generation: document.indexedRef.generation ?? document.generation,
		};
		return {
			docId,
			path: document.path,
			generation: document.generation,
			indexedRef,
			record: {
				...document.record,
				path: document.path,
				stableDeterministicKey,
			},
			manifest: {
				exactTermIdsByField: mapCoverageLexicalV2FieldTermsToIds(
					document.exactTermsByField,
					(term) => this.getOrCreateCanonicalTermId(term),
				),
				metadataHanBigramIdsByField: mapCoverageLexicalV2MetadataBigramsToIds(
					document.metadataHanBigramsByField,
					(bigram) => this.getOrCreateCanonicalTermId(bigram),
				),
				bodyHanGateBloomWords: buildCoverageLexicalV2HanGateBloomWords(
					document.bodyHanSegments,
				),
				hasBodyHanSegments: encodedHan.segmentCount > 0,
				bodyHanSegmentExactSidecar: {
					generation: document.generation ?? indexedRef.generation,
					size: indexedRef.size,
					segmentCount: encodedHan.segmentCount,
					estimatedBytes: estimateCoverageLexicalV2EncodedHanSegmentExactBytes(
						encodedHan.symbolIds,
					),
				},
				bodyTokenSidecar: {
					generation: document.generation ?? indexedRef.generation,
					size: indexedRef.size,
					tokenCount: document.bodyTokens.length,
					estimatedBytes: estimateCoverageLexicalV2BodyTokenIdSequenceBytes(
						this.getOrCreateBodyTokenIds(document.bodyTokens),
					),
				},
			},
		};
	}

	private buildInternalDocumentStateFromPersistedJournal(
		docId: number,
		document: CoverageLexicalV2PersistedJournalDocument,
	): CoverageLexicalV2InternalDocumentState {
		const stableDeterministicKey =
			document.record.stableDeterministicKey ?? document.path;
		return {
			docId,
			path: document.path,
			generation: document.generation,
			indexedRef: {
				...document.indexedRef,
				path: document.path,
				generation: document.indexedRef.generation ?? document.generation,
			},
			record: {
				...document.record,
				path: document.path,
				stableDeterministicKey,
			},
			manifest: {
				exactTermIdsByField: cloneCoverageLexicalV2FieldTermIdLists(
					document.exactTermIdsByField,
				),
				metadataHanBigramIdsByField:
					cloneCoverageLexicalV2MetadataBigramIdLists(
						document.metadataHanBigramIdsByField,
					),
				bodyHanGateBloomWords: cloneCoverageLexicalV2NumberList(
					document.bodyHanGateBloomWords,
				),
				hasBodyHanSegments:
					document.bodyHanSegmentExactSidecar.segmentCount > 0,
				bodyHanSegmentExactSidecar: {
					generation: document.bodyHanSegmentExactSidecar.generation,
					size: document.bodyHanSegmentExactSidecar.size,
					segmentCount: document.bodyHanSegmentExactSidecar.segmentCount,
					estimatedBytes: document.bodyHanSegmentExactSidecar.estimatedBytes,
				},
				bodyTokenSidecar: {
					generation: document.bodyTokenSidecar.generation,
					size: document.bodyTokenSidecar.size,
					tokenCount: document.bodyTokenSidecar.tokenCount,
					estimatedBytes: document.bodyTokenSidecar.estimatedBytes,
				},
			},
		};
	}

	private buildInternalDocumentStateFromSnapshotDocument(
		document: CoverageLexicalV2IndexStoreSnapshotDocument,
	): CoverageLexicalV2InternalDocumentState {
		return {
			docId: document.docId,
			path: document.path,
			generation: document.generation,
			indexedRef: { ...document.indexedRef },
			record: { ...document.record },
			manifest: normalizeCoverageLexicalV2PersistedDocManifest(document.manifest),
		};
	}

	private ensureCanonicalTermIds(fieldTerms: CoverageLexicalV2FieldTermLists): void {
		for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
			for (const term of fieldTerms[field]) {
				this.getOrCreateCanonicalTermId(term);
			}
		}
	}

	private ensureCanonicalBigramIds(
		bigramsByField: CoverageLexicalV2MetadataBigramLists,
	): void {
		for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
			for (const bigram of bigramsByField[field]) {
				this.getOrCreateCanonicalTermId(bigram);
			}
		}
	}

	private getOrCreateCanonicalTermId(term: string): CoverageLexicalV2CanonicalTermId {
		return internCoverageLexicalV2CanonicalTerm(this.canonicalTermPool, term);
	}

	private findCanonicalTermId(
		term: string,
	): CoverageLexicalV2CanonicalTermId | undefined {
		return findCoverageLexicalV2CanonicalTermId(this.canonicalTermPool, term);
	}

	private decodeCanonicalTerm(termId: CoverageLexicalV2CanonicalTermId): string {
		return decodeCoverageLexicalV2CanonicalTerm(this.canonicalTermPool, termId);
	}

	getOrCreateBodyTokenIds(tokens: readonly string[]): Uint32Array {
		const ids = new Uint32Array(tokens.length);
		for (let index = 0; index < tokens.length; index += 1) {
			ids[index] = this.getOrCreateCanonicalTermId(tokens[index]);
		}
		return ids;
	}

	getOrCreateBodyHanSegmentExactSymbolIds(segments: readonly string[]): {
		symbolIds: Uint32Array;
		segmentCount: number;
	} {
		return encodeCoverageLexicalV2HanSegmentsToSymbolIds(
			segments,
			(codePoint) =>
				getOrCreateCoverageLexicalV2HanSymbolId(this.hanSymbolPool, codePoint),
		);
	}

	decodeBodyTokenIds(tokenIds: readonly number[] | Uint32Array): string[] {
		return Array.from(tokenIds).map(
			(tokenId) => this.decodeCanonicalTerm(tokenId),
		);
	}

	buildPersistedJournalDocument(
		docId: number,
	): CoverageLexicalV2PersistedJournalDocument | null {
		const document = this.documentById[docId];
		if (!document) {
			return null;
		}
		return {
			path: document.path,
			generation: document.generation,
			indexedRef: { ...document.indexedRef },
			record: { ...document.record },
			exactTermIdsByField: cloneCoverageLexicalV2FieldTermIdLists(
				document.manifest.exactTermIdsByField,
			),
			metadataHanBigramIdsByField:
				cloneCoverageLexicalV2MetadataBigramIdLists(
					document.manifest.metadataHanBigramIdsByField,
				),
			bodyHanGateBloomWords: cloneCoverageLexicalV2NumberList(
				document.manifest.bodyHanGateBloomWords,
			),
			bodyHanSegmentExactSidecar: {
				generation: document.manifest.bodyHanSegmentExactSidecar.generation,
				size: document.manifest.bodyHanSegmentExactSidecar.size,
				segmentCount: document.manifest.bodyHanSegmentExactSidecar.segmentCount,
				estimatedBytes: document.manifest.bodyHanSegmentExactSidecar.estimatedBytes,
			},
			bodyTokenSidecar: {
				path: document.path,
				generation: document.manifest.bodyTokenSidecar.generation,
				size: document.manifest.bodyTokenSidecar.size,
				tokenCount: document.manifest.bodyTokenSidecar.tokenCount,
				estimatedBytes: document.manifest.bodyTokenSidecar.estimatedBytes,
			},
		};
	}

	private decodeOverlayMetadataBigramIdList(
		values: readonly CoverageLexicalV2CanonicalTermId[],
	): readonly string[] {
		return values.length === 0
			? EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST
			: values.map((termId) => this.decodeCanonicalTerm(termId));
	}

	private collectPostingMatches(
		segmentMatches: readonly (readonly number[] | undefined)[],
		additions: readonly number[] | undefined,
		removals: readonly number[] | undefined,
	): readonly number[] | undefined {
		const docIds = new Set<number>();
		for (const matches of segmentMatches) {
			for (const docId of matches ?? []) {
				docIds.add(docId);
			}
		}
		for (const docId of additions ?? []) {
			docIds.add(docId);
		}
		for (const docId of removals ?? []) {
			docIds.delete(docId);
		}
		if (docIds.size === 0) {
			return undefined;
		}
		return [...docIds].sort((left, right) => left - right);
	}

	private collectLatinPrefixTerms(
		queryTerm: string,
		cap: number,
	): readonly string[] {
		if (cap <= 0 || !isCoverageLexicalV2LatinCandidateCascadeTerm(queryTerm)) {
			return [];
		}
		const terms = this.getLatinExpansionTermIds();
		const canonicalTermLexicon = buildCoverageLexicalV2CanonicalTermLexicon(
			this.canonicalTermPool,
		);
		const matches: string[] = [];
		let index = lowerBoundCoverageLexicalV2IndexStoreLatinTermIds(
			terms,
			canonicalTermLexicon,
			queryTerm,
		);
		while (index < terms.length && matches.length < cap) {
			const candidateTerm = canonicalTermLexicon[terms[index] ?? -1] ?? "";
			if (!candidateTerm.startsWith(queryTerm)) {
				break;
			}
			if (
				getCoverageLexicalV2CandidateCascadeMatchQuality(queryTerm, candidateTerm, {
					includePrefix: true,
				}) === "prefix"
			) {
				matches.push(candidateTerm);
			}
			index += 1;
		}
		return matches;
	}

	private collectLatinFuzzyTerms(
		queryTerm: string,
		cap: number,
		fuzzyProportion: number,
	): readonly string[] {
		if (cap <= 0 || !isCoverageLexicalV2LatinCandidateCascadeTerm(queryTerm)) {
			return [];
		}
		const matches: string[] = [];
		for (const termId of this.getLatinExpansionTermIds()) {
			if (matches.length >= cap) {
				break;
			}
			const candidateTerm = this.decodeCanonicalTerm(termId);
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

	private getLatinExpansionTermIds(): readonly CoverageLexicalV2CanonicalTermId[] {
		if (!this.latinExpansionTermsDirty) {
			return this.latinExpansionTermIdsCache;
		}
		const nextTerms = [...this.exactTermRefCounts.entries()]
			.filter(([, refCount]) => refCount > 0)
			.map(([termId]) => termId)
			.filter((termId) =>
				isCoverageLexicalV2LatinCandidateCascadeTerm(
					this.decodeCanonicalTerm(termId),
				),
			)
			.sort((left, right) =>
				compareCoverageLexicalV2IndexStoreStrings(
					this.decodeCanonicalTerm(left),
					this.decodeCanonicalTerm(right),
				),
			);
		this.latinExpansionTermIdsCache = nextTerms;
		this.latinExpansionTermsDirty = false;
		return this.latinExpansionTermIdsCache;
	}

	private deleteDocumentById(docId: number): void {
		this.removeDocumentStateById(docId);
		this.documentById[docId] = undefined;
	}

	private removeDocumentStateById(docId: number): void {
		const existing = this.documentById[docId];
		if (!existing) {
			return;
		}
		this.applyDocumentRemoval(existing);
		this.syncBodyHanSegmentDocId(docId, false);
		this.bodyTokenSidecarEstimatedBytes = Math.max(
			0,
			this.bodyTokenSidecarEstimatedBytes -
				existing.manifest.bodyTokenSidecar.estimatedBytes,
		);
		this.bodyHanSegmentExactSidecarEstimatedBytes = Math.max(
			0,
			this.bodyHanSegmentExactSidecarEstimatedBytes -
				existing.manifest.bodyHanSegmentExactSidecar.estimatedBytes,
		);
		this.documentIdByPath.delete(existing.path);
		this.documentById[docId] = undefined;
		this.latinExpansionTermsDirty = true;
	}

	private applyDocumentAddition(documentState: CoverageLexicalV2InternalDocumentState): void {
		incrementCoverageLexicalV2TermRefCounts(
			this.exactTermRefCounts,
			documentState.manifest.exactTermIdsByField,
		);
		incrementCoverageLexicalV2BigramRefCounts(
			this.metadataHanBigramRefCounts,
			documentState.manifest.metadataHanBigramIdsByField,
		);
		for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
			for (const termId of documentState.manifest.exactTermIdsByField[field]) {
				applyCoverageLexicalV2OverlayPostingDelta(
					this.overlay.exactAddsByField[field],
					this.overlay.exactRemovalsByField[field],
					termId,
					documentState.docId,
				);
				this.overlayMutationCount += 1;
			}
		}
		for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
			for (const bigram of this.decodeOverlayMetadataBigramIdList(
				documentState.manifest.metadataHanBigramIdsByField[field],
			)) {
				applyCoverageLexicalV2OverlayPostingDelta(
					this.overlay.metadataHanAddsByField[field],
					this.overlay.metadataHanRemovalsByField[field],
					bigram,
					documentState.docId,
				);
				this.overlayMutationCount += 1;
			}
		}
	}

	private applyDocumentRemoval(documentState: CoverageLexicalV2InternalDocumentState): void {
		decrementCoverageLexicalV2TermRefCounts(
			this.exactTermRefCounts,
			documentState.manifest.exactTermIdsByField,
		);
		decrementCoverageLexicalV2BigramRefCounts(
			this.metadataHanBigramRefCounts,
			documentState.manifest.metadataHanBigramIdsByField,
		);
		for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
			for (const termId of documentState.manifest.exactTermIdsByField[field]) {
				applyCoverageLexicalV2OverlayPostingTombstone(
					this.overlay.exactAddsByField[field],
					this.overlay.exactRemovalsByField[field],
					termId,
					documentState.docId,
				);
				this.overlayMutationCount += 1;
			}
		}
		for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
			for (const bigram of this.decodeOverlayMetadataBigramIdList(
				documentState.manifest.metadataHanBigramIdsByField[field],
			)) {
				applyCoverageLexicalV2OverlayPostingTombstone(
					this.overlay.metadataHanAddsByField[field],
					this.overlay.metadataHanRemovalsByField[field],
					bigram,
					documentState.docId,
				);
				this.overlayMutationCount += 1;
			}
		}
	}

	private syncBodyHanSegmentDocId(docId: number, shouldExist: boolean): void {
		const currentIndex = this.bodyHanSegmentDocIds.indexOf(docId);
		if (shouldExist) {
			if (currentIndex >= 0) {
				return;
			}
			insertCoverageLexicalV2SortedNumber(this.bodyHanSegmentDocIds, docId);
			return;
		}
		if (currentIndex >= 0) {
			this.bodyHanSegmentDocIds.splice(currentIndex, 1);
		}
	}
}

export function toCoverageLexicalV2PreparedDocument(
	document: CoverageLexicalV2IndexStoreSnapshotDocument,
	decodeTerm: (termId: CoverageLexicalV2CanonicalTermId) => string = () => "",
): CoverageLexicalV2PreparedDocument {
	return {
		path: document.path,
		generation: document.generation,
		indexedRef: { ...document.indexedRef },
		record: { ...document.record },
		exactTermsByField: decodeCoverageLexicalV2FieldTermIdLists(
			document.manifest.exactTermIdsByField,
			decodeTerm,
		),
		metadataHanBigramsByField: decodeCoverageLexicalV2MetadataBigramIdLists(
			document.manifest.metadataHanBigramIdsByField,
			decodeTerm,
		),
		bodyHanSegments: EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST,
		bodyTokens: [],
	};
}

function toCoverageLexicalV2SnapshotDocument(
	document: CoverageLexicalV2InternalDocumentState,
): CoverageLexicalV2IndexStoreSnapshotDocument {
	return {
		docId: document.docId,
		path: document.path,
		generation: document.generation,
		indexedRef: { ...document.indexedRef },
		record: { ...document.record },
		manifest: buildCoverageLexicalV2PersistedDocManifest(document),
	};
}

function buildCoverageLexicalV2RuntimeDocManifest(
	document: CoverageLexicalV2PreparedDocument,
	indexedRef: BaseIndexedFileRef,
): CoverageLexicalV2IndexStoreRuntimeDocManifest {
		return {
			exactTermIdsByField: mapCoverageLexicalV2FieldTermsToIds(
				document.exactTermsByField,
			(term) => {
				throw new Error(
					`Cannot build runtime doc manifest without canonical term ids for "${term}"`,
				);
			},
		),
		metadataHanBigramIdsByField: mapCoverageLexicalV2MetadataBigramsToIds(
			document.metadataHanBigramsByField,
			(bigram) => {
				throw new Error(
					`Cannot build runtime doc manifest without canonical bigram ids for "${bigram}"`,
				);
			},
		),
		bodyHanGateBloomWords: buildCoverageLexicalV2HanGateBloomWords(
			document.bodyHanSegments,
		),
		hasBodyHanSegments: document.bodyHanSegments.length > 0,
		bodyHanSegmentExactSidecar: {
			generation: document.generation ?? indexedRef.generation,
			size: indexedRef.size,
			segmentCount: document.bodyHanSegments.length,
			estimatedBytes: estimateCoverageLexicalV2BodyHanSegmentExactBytes(
				document.bodyHanSegments,
			),
		},
		bodyTokenSidecar: {
			generation: document.generation ?? indexedRef.generation,
			size: indexedRef.size,
			tokenCount: document.bodyTokens.length,
			estimatedBytes: estimateCoverageLexicalV2BodyTokenSequenceBytes(
				document.bodyTokens,
			),
		},
	};
}

function normalizeCoverageLexicalV2PersistedDocManifest(
	manifest: CoverageLexicalV2IndexStorePersistedDocManifest,
): CoverageLexicalV2IndexStoreRuntimeDocManifest {
	return {
		exactTermIdsByField: cloneCoverageLexicalV2FieldTermIdLists(
			manifest.exactTermIdsByField,
		),
		metadataHanBigramIdsByField: cloneCoverageLexicalV2MetadataBigramIdLists(
			manifest.metadataHanBigramIdsByField,
		),
		bodyHanGateBloomWords: cloneCoverageLexicalV2NumberList(
			manifest.bodyHanGateBloomWords,
		),
		hasBodyHanSegments: manifest.hasBodyHanSegments,
		bodyHanSegmentExactSidecar: {
			generation: manifest.bodyHanSegmentExactSidecar.generation,
			size: manifest.bodyHanSegmentExactSidecar.size,
			segmentCount: manifest.bodyHanSegmentExactSidecar.segmentCount,
			estimatedBytes: manifest.bodyHanSegmentExactSidecar.estimatedBytes,
		},
		bodyTokenSidecar: {
			generation: manifest.bodyTokenSidecar.generation,
			size: manifest.bodyTokenSidecar.size,
			tokenCount: manifest.bodyTokenSidecar.tokenCount,
			estimatedBytes: manifest.bodyTokenSidecar.estimatedBytes,
		},
	};
}

function buildCoverageLexicalV2PersistedDocManifest(
	document: CoverageLexicalV2InternalDocumentState,
): CoverageLexicalV2IndexStorePersistedDocManifest {
	return {
		exactTermIdsByField: cloneCoverageLexicalV2FieldTermIdLists(
			document.manifest.exactTermIdsByField,
		),
		metadataHanBigramIdsByField: cloneCoverageLexicalV2MetadataBigramIdLists(
			document.manifest.metadataHanBigramIdsByField,
		),
		bodyHanGateBloomWords: cloneCoverageLexicalV2NumberList(
			document.manifest.bodyHanGateBloomWords,
		),
		hasBodyHanSegments: document.manifest.hasBodyHanSegments,
		bodyHanSegmentExactSidecar: {
			generation: document.manifest.bodyHanSegmentExactSidecar.generation,
			size: document.manifest.bodyHanSegmentExactSidecar.size,
			segmentCount: document.manifest.bodyHanSegmentExactSidecar.segmentCount,
			estimatedBytes: document.manifest.bodyHanSegmentExactSidecar.estimatedBytes,
		},
		bodyTokenSidecar: {
			path: document.path,
			generation: document.manifest.bodyTokenSidecar.generation,
			size: document.manifest.bodyTokenSidecar.size,
			tokenCount: document.manifest.bodyTokenSidecar.tokenCount,
			estimatedBytes: document.manifest.bodyTokenSidecar.estimatedBytes,
		},
	};
}

function cloneCoverageLexicalV2FieldTermLists(
	fieldTerms: CoverageLexicalV2FieldTermLists,
): CoverageLexicalV2FieldTermLists {
	if (areCoverageLexicalV2FieldTermListsEmpty(fieldTerms)) {
		return EMPTY_COVERAGE_LEXICAL_V2_FIELD_TERM_LISTS;
	}
	return {
		basename: cloneCoverageLexicalV2StringList(fieldTerms.basename),
		aliases: cloneCoverageLexicalV2StringList(fieldTerms.aliases),
		headings: cloneCoverageLexicalV2StringList(fieldTerms.headings),
		folder: cloneCoverageLexicalV2StringList(fieldTerms.folder),
		tag: cloneCoverageLexicalV2StringList(fieldTerms.tag),
		body: cloneCoverageLexicalV2StringList(fieldTerms.body),
	};
}

function mapCoverageLexicalV2FieldTermsToIds(
	fieldTerms: CoverageLexicalV2FieldTermLists,
	getOrCreateTermId: (term: string) => CoverageLexicalV2CanonicalTermId,
): CoverageLexicalV2FieldTermIdLists {
	if (areCoverageLexicalV2FieldTermListsEmpty(fieldTerms)) {
		return EMPTY_COVERAGE_LEXICAL_V2_FIELD_TERM_ID_LISTS;
	}
	return {
		basename: mapCoverageLexicalV2StringListToIds(
			fieldTerms.basename,
			getOrCreateTermId,
		),
		aliases: mapCoverageLexicalV2StringListToIds(
			fieldTerms.aliases,
			getOrCreateTermId,
		),
		headings: mapCoverageLexicalV2StringListToIds(
			fieldTerms.headings,
			getOrCreateTermId,
		),
		folder: mapCoverageLexicalV2StringListToIds(
			fieldTerms.folder,
			getOrCreateTermId,
		),
		tag: mapCoverageLexicalV2StringListToIds(fieldTerms.tag, getOrCreateTermId),
		body: mapCoverageLexicalV2StringListToIds(fieldTerms.body, getOrCreateTermId),
	};
}

function decodeCoverageLexicalV2FieldTermIdLists(
	fieldTerms: CoverageLexicalV2FieldTermIdLists,
	decodeTerm: (termId: CoverageLexicalV2CanonicalTermId) => string,
): CoverageLexicalV2FieldTermLists {
	if (areCoverageLexicalV2FieldTermIdListsEmpty(fieldTerms)) {
		return EMPTY_COVERAGE_LEXICAL_V2_FIELD_TERM_LISTS;
	}
	return {
		basename: decodeCoverageLexicalV2TermIdList(fieldTerms.basename, decodeTerm),
		aliases: decodeCoverageLexicalV2TermIdList(fieldTerms.aliases, decodeTerm),
		headings: decodeCoverageLexicalV2TermIdList(fieldTerms.headings, decodeTerm),
		folder: decodeCoverageLexicalV2TermIdList(fieldTerms.folder, decodeTerm),
		tag: decodeCoverageLexicalV2TermIdList(fieldTerms.tag, decodeTerm),
		body: decodeCoverageLexicalV2TermIdList(fieldTerms.body, decodeTerm),
	};
}

function cloneCoverageLexicalV2FieldTermIdLists(
	fieldTerms: CoverageLexicalV2FieldTermIdLists,
): CoverageLexicalV2FieldTermIdLists {
	if (areCoverageLexicalV2FieldTermIdListsEmpty(fieldTerms)) {
		return EMPTY_COVERAGE_LEXICAL_V2_FIELD_TERM_ID_LISTS;
	}
	return {
		basename: cloneCoverageLexicalV2NumberList(fieldTerms.basename),
		aliases: cloneCoverageLexicalV2NumberList(fieldTerms.aliases),
		headings: cloneCoverageLexicalV2NumberList(fieldTerms.headings),
		folder: cloneCoverageLexicalV2NumberList(fieldTerms.folder),
		tag: cloneCoverageLexicalV2NumberList(fieldTerms.tag),
		body: cloneCoverageLexicalV2NumberList(fieldTerms.body),
	};
}

function cloneCoverageLexicalV2MetadataBigramLists(
	bigramsByField: CoverageLexicalV2MetadataBigramLists,
): CoverageLexicalV2MetadataBigramLists {
	if (areCoverageLexicalV2MetadataBigramListsEmpty(bigramsByField)) {
		return EMPTY_COVERAGE_LEXICAL_V2_METADATA_BIGRAM_LISTS;
	}
	return {
		basename: cloneCoverageLexicalV2StringList(bigramsByField.basename),
		aliases: cloneCoverageLexicalV2StringList(bigramsByField.aliases),
		headings: cloneCoverageLexicalV2StringList(bigramsByField.headings),
		folder: cloneCoverageLexicalV2StringList(bigramsByField.folder),
		tag: cloneCoverageLexicalV2StringList(bigramsByField.tag),
	};
}

function mapCoverageLexicalV2MetadataBigramsToIds(
	bigramsByField: CoverageLexicalV2MetadataBigramLists,
	getOrCreateTermId: (bigram: string) => CoverageLexicalV2CanonicalTermId,
): CoverageLexicalV2MetadataBigramIdLists {
	if (areCoverageLexicalV2MetadataBigramListsEmpty(bigramsByField)) {
		return EMPTY_COVERAGE_LEXICAL_V2_METADATA_BIGRAM_ID_LISTS;
	}
	return {
		basename: mapCoverageLexicalV2StringListToIds(
			bigramsByField.basename,
			getOrCreateTermId,
		),
		aliases: mapCoverageLexicalV2StringListToIds(
			bigramsByField.aliases,
			getOrCreateTermId,
		),
		headings: mapCoverageLexicalV2StringListToIds(
			bigramsByField.headings,
			getOrCreateTermId,
		),
		folder: mapCoverageLexicalV2StringListToIds(
			bigramsByField.folder,
			getOrCreateTermId,
		),
		tag: mapCoverageLexicalV2StringListToIds(
			bigramsByField.tag,
			getOrCreateTermId,
		),
	};
}

function decodeCoverageLexicalV2MetadataBigramIdLists(
	bigramsByField: CoverageLexicalV2MetadataBigramIdLists,
	decodeTerm: (termId: CoverageLexicalV2CanonicalTermId) => string,
): CoverageLexicalV2MetadataBigramLists {
	if (areCoverageLexicalV2MetadataBigramIdListsEmpty(bigramsByField)) {
		return EMPTY_COVERAGE_LEXICAL_V2_METADATA_BIGRAM_LISTS;
	}
	return {
		basename: decodeCoverageLexicalV2TermIdList(
			bigramsByField.basename,
			decodeTerm,
		),
		aliases: decodeCoverageLexicalV2TermIdList(
			bigramsByField.aliases,
			decodeTerm,
		),
		headings: decodeCoverageLexicalV2TermIdList(
			bigramsByField.headings,
			decodeTerm,
		),
		folder: decodeCoverageLexicalV2TermIdList(
			bigramsByField.folder,
			decodeTerm,
		),
		tag: decodeCoverageLexicalV2TermIdList(bigramsByField.tag, decodeTerm),
	};
}

function cloneCoverageLexicalV2MetadataBigramIdLists(
	bigramsByField: CoverageLexicalV2MetadataBigramIdLists,
): CoverageLexicalV2MetadataBigramIdLists {
	if (areCoverageLexicalV2MetadataBigramIdListsEmpty(bigramsByField)) {
		return EMPTY_COVERAGE_LEXICAL_V2_METADATA_BIGRAM_ID_LISTS;
	}
	return {
		basename: cloneCoverageLexicalV2NumberList(bigramsByField.basename),
		aliases: cloneCoverageLexicalV2NumberList(bigramsByField.aliases),
		headings: cloneCoverageLexicalV2NumberList(bigramsByField.headings),
		folder: cloneCoverageLexicalV2NumberList(bigramsByField.folder),
		tag: cloneCoverageLexicalV2NumberList(bigramsByField.tag),
	};
}

function cloneCoverageLexicalV2StringList(
	values: readonly string[],
): readonly string[] {
	return values.length === 0
		? EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST
		: [...values];
}

function cloneCoverageLexicalV2NumberList(
	values: readonly CoverageLexicalV2CanonicalTermId[],
): readonly CoverageLexicalV2CanonicalTermId[] {
	return values.length === 0
		? EMPTY_COVERAGE_LEXICAL_V2_NUMBER_LIST
		: [...values];
}

function areCoverageLexicalV2FieldTermListsEmpty(
	fieldTerms: CoverageLexicalV2FieldTermLists,
): boolean {
	return COVERAGE_LEXICAL_V2_POSTING_FIELDS.every(
		(field) => fieldTerms[field].length === 0,
	);
}

function areCoverageLexicalV2FieldTermIdListsEmpty(
	fieldTerms: CoverageLexicalV2FieldTermIdLists,
): boolean {
	return COVERAGE_LEXICAL_V2_POSTING_FIELDS.every(
		(field) => fieldTerms[field].length === 0,
	);
}

function areCoverageLexicalV2MetadataBigramListsEmpty(
	bigramsByField: CoverageLexicalV2MetadataBigramLists,
): boolean {
	return COVERAGE_LEXICAL_V2_METADATA_FIELDS.every(
		(field) => bigramsByField[field].length === 0,
	);
}

function areCoverageLexicalV2MetadataBigramIdListsEmpty(
	bigramsByField: CoverageLexicalV2MetadataBigramIdLists,
): boolean {
	return COVERAGE_LEXICAL_V2_METADATA_FIELDS.every(
		(field) => bigramsByField[field].length === 0,
	);
}

function createCoverageLexicalV2MutableExactPostingMaps(): CoverageLexicalV2MutableNumericPostingDelta<
	CoverageLexicalV2CandidateCascadePostingField
> {
	return {
		basename: new Map(),
		aliases: new Map(),
		headings: new Map(),
		folder: new Map(),
		tag: new Map(),
		body: new Map(),
	};
}

function createCoverageLexicalV2MutableMetadataPostingMaps(): CoverageLexicalV2MutableStringPostingDelta<
	CoverageLexicalV2MetadataPostingField
> {
	return {
		basename: new Map(),
		aliases: new Map(),
		headings: new Map(),
		folder: new Map(),
		tag: new Map(),
	};
}

function createCoverageLexicalV2MutableOverlayState(): CoverageLexicalV2MutableOverlayState {
	return {
		exactAddsByField: createCoverageLexicalV2MutableExactPostingMaps(),
		exactRemovalsByField: createCoverageLexicalV2MutableExactPostingMaps(),
		metadataHanAddsByField: createCoverageLexicalV2MutableMetadataPostingMaps(),
		metadataHanRemovalsByField: createCoverageLexicalV2MutableMetadataPostingMaps(),
	};
}

function clearCoverageLexicalV2MutableOverlayState(
	overlay: CoverageLexicalV2MutableOverlayState,
): void {
	for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
		overlay.exactAddsByField[field].clear();
		overlay.exactRemovalsByField[field].clear();
	}
	for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
		overlay.metadataHanAddsByField[field].clear();
		overlay.metadataHanRemovalsByField[field].clear();
	}
}

function clearCoverageLexicalV2MutableOverlayAdditions(
	overlay: CoverageLexicalV2MutableOverlayState,
): void {
	for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
		overlay.exactAddsByField[field].clear();
	}
	for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
		overlay.metadataHanAddsByField[field].clear();
	}
}

function serializeCoverageLexicalV2MutableOverlayState(
	overlay: CoverageLexicalV2MutableOverlayState,
): CoverageLexicalV2IndexStoreOverlayState {
	return {
		exactAddsByField: serializeCoverageLexicalV2MutableNumericPostingDelta(
			overlay.exactAddsByField,
			COVERAGE_LEXICAL_V2_POSTING_FIELDS,
		),
		exactRemovalsByField: serializeCoverageLexicalV2MutableNumericPostingDelta(
			overlay.exactRemovalsByField,
			COVERAGE_LEXICAL_V2_POSTING_FIELDS,
		),
		metadataHanAddsByField: serializeCoverageLexicalV2MutableStringPostingDelta(
			overlay.metadataHanAddsByField,
			COVERAGE_LEXICAL_V2_METADATA_FIELDS,
		),
		metadataHanRemovalsByField: serializeCoverageLexicalV2MutableStringPostingDelta(
			overlay.metadataHanRemovalsByField,
			COVERAGE_LEXICAL_V2_METADATA_FIELDS,
		),
	};
}

function restoreCoverageLexicalV2MutableOverlayState(
	target: CoverageLexicalV2MutableOverlayState,
	overlay: CoverageLexicalV2IndexStoreOverlayState,
): void {
	clearCoverageLexicalV2MutableOverlayState(target);
	restoreCoverageLexicalV2MutableNumericPostingDelta(
		target.exactAddsByField,
		overlay.exactAddsByField,
		COVERAGE_LEXICAL_V2_POSTING_FIELDS,
	);
	restoreCoverageLexicalV2MutableNumericPostingDelta(
		target.exactRemovalsByField,
		overlay.exactRemovalsByField,
		COVERAGE_LEXICAL_V2_POSTING_FIELDS,
	);
	restoreCoverageLexicalV2MutableStringPostingDelta(
		target.metadataHanAddsByField,
		overlay.metadataHanAddsByField,
		COVERAGE_LEXICAL_V2_METADATA_FIELDS,
	);
	restoreCoverageLexicalV2MutableStringPostingDelta(
		target.metadataHanRemovalsByField,
		overlay.metadataHanRemovalsByField,
		COVERAGE_LEXICAL_V2_METADATA_FIELDS,
	);
}

function serializeCoverageLexicalV2MutableNumericPostingDelta<Field extends string>(
	postingsByField: CoverageLexicalV2MutableNumericPostingDelta<Field>,
	fields: readonly Field[],
): Record<Field, Readonly<Record<string, readonly number[]>>> {
	const serialized = {} as Record<Field, Readonly<Record<string, readonly number[]>>>;
	for (const field of fields) {
		const out: Record<string, readonly number[]> = {};
		for (const [termId, docIds] of postingsByField[field]) {
			if (docIds.length > 0) {
				out[String(termId)] = [...docIds];
			}
		}
		serialized[field] = out;
	}
	return serialized;
}

function restoreCoverageLexicalV2MutableNumericPostingDelta<Field extends string>(
	target: CoverageLexicalV2MutableNumericPostingDelta<Field>,
	source: Record<Field, Readonly<Record<string, readonly number[]>>>,
	fields: readonly Field[],
): void {
	for (const field of fields) {
		const targetMap = target[field];
		for (const [termIdKey, docIds] of Object.entries(source[field] ?? {})) {
			const termId = Number(termIdKey);
			if (!Number.isInteger(termId) || termId < 0) {
				continue;
			}
			targetMap.set(
				termId,
				[...docIds].sort((left, right) => left - right),
			);
		}
	}
}

function serializeCoverageLexicalV2MutableStringPostingDelta<Field extends string>(
	postingsByField: CoverageLexicalV2MutableStringPostingDelta<Field>,
	fields: readonly Field[],
): Record<Field, Readonly<Record<string, readonly number[]>>> {
	const serialized = {} as Record<Field, Readonly<Record<string, readonly number[]>>>;
	for (const field of fields) {
		const out: Record<string, readonly number[]> = {};
		for (const [term, docIds] of postingsByField[field]) {
			if (docIds.length > 0) {
				out[term] = [...docIds];
			}
		}
		serialized[field] = out;
	}
	return serialized;
}

function restoreCoverageLexicalV2MutableStringPostingDelta<Field extends string>(
	target: CoverageLexicalV2MutableStringPostingDelta<Field>,
	source: Record<Field, Readonly<Record<string, readonly number[]>>>,
	fields: readonly Field[],
): void {
	for (const field of fields) {
		const targetMap = target[field];
		for (const [term, docIds] of Object.entries(source[field] ?? {})) {
			targetMap.set(
				term,
				[...docIds].sort((left, right) => left - right),
			);
		}
	}
}

function cloneCoverageLexicalV2ResidentSegment(
	segment: CoverageLexicalV2IndexStoreResidentSegment,
): CoverageLexicalV2IndexStoreResidentSegment {
	return {
		id: segment.id,
		createdAt: segment.createdAt,
		docCount: segment.docCount,
		exactByField: {
			basename: cloneCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(
				segment.exactByField.basename,
			),
			aliases: cloneCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(
				segment.exactByField.aliases,
			),
			headings: cloneCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(
				segment.exactByField.headings,
			),
			folder: cloneCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(
				segment.exactByField.folder,
			),
			tag: cloneCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(
				segment.exactByField.tag,
			),
			body: cloneCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(
				segment.exactByField.body,
			),
		},
		metadataHanByField: {
			basename: cloneCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(
				segment.metadataHanByField.basename,
			),
			aliases: cloneCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(
				segment.metadataHanByField.aliases,
			),
			headings: cloneCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(
				segment.metadataHanByField.headings,
			),
			folder: cloneCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(
				segment.metadataHanByField.folder,
			),
			tag: cloneCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(
				segment.metadataHanByField.tag,
			),
		},
	};
}

function cloneCoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment(segment: {
	singletonTermIds: readonly number[] | Uint8Array | Uint16Array | Uint32Array;
	singletonDocIds: readonly number[] | Uint8Array | Uint16Array | Uint32Array;
	smallTermIds: readonly number[] | Uint8Array | Uint16Array | Uint32Array;
	smallDocStarts: readonly number[] | Uint8Array | Uint16Array | Uint32Array;
	smallDocIds: readonly number[] | Uint8Array | Uint16Array | Uint32Array;
	deltaTermIds: readonly number[] | Uint8Array | Uint16Array | Uint32Array;
	deltaTapeStarts: readonly number[] | Uint8Array | Uint16Array | Uint32Array;
	postingTape: readonly number[] | Uint8Array | Uint16Array | Uint32Array;
}) {
	return {
		singletonTermIds: Array.from(segment.singletonTermIds),
		singletonDocIds: Array.from(segment.singletonDocIds),
		smallTermIds: Array.from(segment.smallTermIds),
		smallDocStarts: Array.from(segment.smallDocStarts),
		smallDocIds: Array.from(segment.smallDocIds),
		deltaTermIds: Array.from(segment.deltaTermIds),
		deltaTapeStarts: Array.from(segment.deltaTapeStarts),
		postingTape: Array.from(segment.postingTape),
	};
}

function applyCoverageLexicalV2OverlayPostingDelta<
	Key extends string | CoverageLexicalV2CanonicalTermId,
>(
	additions: Map<Key, number[]>,
	removals: Map<Key, number[]>,
	term: Key,
	docId: number,
): void {
	const removalDocIds = removals.get(term);
	if (removalDocIds) {
		removeCoverageLexicalV2Number(removalDocIds, docId);
		if (removalDocIds.length === 0) {
			removals.delete(term);
		}
	}

	const additionDocIds = additions.get(term) ?? [];
	insertCoverageLexicalV2SortedNumber(additionDocIds, docId);
	if (additionDocIds.length > 0) {
		additions.set(term, additionDocIds);
	}
}

function* iterateCoverageLexicalV2AdaptiveSegmentTermIds(segment: {
	singletonTermIds: readonly number[] | Uint8Array | Uint16Array | Uint32Array;
	smallTermIds: readonly number[] | Uint8Array | Uint16Array | Uint32Array;
	deltaTermIds: readonly number[] | Uint8Array | Uint16Array | Uint32Array;
}): Iterable<number> {
	yield* segment.singletonTermIds;
	yield* segment.smallTermIds;
	yield* segment.deltaTermIds;
}

function applyCoverageLexicalV2OverlayPostingTombstone<
	Key extends string | CoverageLexicalV2CanonicalTermId,
>(
	additions: Map<Key, number[]>,
	removals: Map<Key, number[]>,
	term: Key,
	docId: number,
): void {
	const additionDocIds = additions.get(term);
	if (additionDocIds) {
		removeCoverageLexicalV2Number(additionDocIds, docId);
		if (additionDocIds.length === 0) {
			additions.delete(term);
		}
	}

	const removalDocIds = removals.get(term) ?? [];
	insertCoverageLexicalV2SortedNumber(removalDocIds, docId);
	if (removalDocIds.length > 0) {
		removals.set(term, removalDocIds);
	}
}

function incrementCoverageLexicalV2TermRefCounts(
	refCounts: Map<CoverageLexicalV2CanonicalTermId, number>,
	fieldTerms: CoverageLexicalV2FieldTermIdLists,
): void {
	for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
		for (const term of fieldTerms[field]) {
			refCounts.set(term, (refCounts.get(term) ?? 0) + 1);
		}
	}
}

function decrementCoverageLexicalV2TermRefCounts(
	refCounts: Map<CoverageLexicalV2CanonicalTermId, number>,
	fieldTerms: CoverageLexicalV2FieldTermIdLists,
): void {
	for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
		for (const term of fieldTerms[field]) {
			const next = (refCounts.get(term) ?? 0) - 1;
			if (next > 0) {
				refCounts.set(term, next);
			} else {
				refCounts.delete(term);
			}
		}
	}
}

function incrementCoverageLexicalV2BigramRefCounts(
	refCounts: Map<CoverageLexicalV2CanonicalTermId, number>,
	bigramsByField: CoverageLexicalV2MetadataBigramIdLists,
): void {
	for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
		for (const bigram of bigramsByField[field]) {
			refCounts.set(bigram, (refCounts.get(bigram) ?? 0) + 1);
		}
	}
}

function decrementCoverageLexicalV2BigramRefCounts(
	refCounts: Map<CoverageLexicalV2CanonicalTermId, number>,
	bigramsByField: CoverageLexicalV2MetadataBigramIdLists,
): void {
	for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
		for (const bigram of bigramsByField[field]) {
			const next = (refCounts.get(bigram) ?? 0) - 1;
			if (next > 0) {
				refCounts.set(bigram, next);
			} else {
				refCounts.delete(bigram);
			}
		}
	}
}

function countCoverageLexicalV2PostingMapsDocumentCount(
	exactPostings: CoverageLexicalV2MutableNumericPostingDelta<
		CoverageLexicalV2CandidateCascadePostingField
	>,
	metadataPostings: CoverageLexicalV2MutableStringPostingDelta<
		CoverageLexicalV2MetadataPostingField
	>,
): number {
	const docIds = new Set<number>();
	for (const field of COVERAGE_LEXICAL_V2_POSTING_FIELDS) {
		for (const posting of exactPostings[field].values()) {
			for (const docId of posting) {
				docIds.add(docId);
			}
		}
	}
	for (const field of COVERAGE_LEXICAL_V2_METADATA_FIELDS) {
		for (const posting of metadataPostings[field].values()) {
			for (const docId of posting) {
				docIds.add(docId);
			}
		}
	}
	return docIds.size;
}

function countCoverageLexicalV2MutableOverlayMutationCount(
	overlay: CoverageLexicalV2MutableOverlayState,
): number {
	return (
		countCoverageLexicalV2MutablePostingDeltaEntries(overlay.exactAddsByField) +
		countCoverageLexicalV2MutablePostingDeltaEntries(overlay.exactRemovalsByField) +
		countCoverageLexicalV2MutablePostingDeltaEntries(
			overlay.metadataHanAddsByField,
		) +
		countCoverageLexicalV2MutablePostingDeltaEntries(
			overlay.metadataHanRemovalsByField,
		)
	);
}

function countCoverageLexicalV2MutablePostingDeltaEntries<Field extends string, Key>(
	postingsByField:
		| CoverageLexicalV2MutableNumericPostingDelta<Field>
		| CoverageLexicalV2MutableStringPostingDelta<Field>,
): number {
	let total = 0;
	for (const map of Object.values(postingsByField) as Array<Map<Key, number[]>>) {
		for (const docIds of map.values()) {
			total += docIds.length;
		}
	}
	return total;
}

function estimateCoverageLexicalV2MutableNumericPostingDeltaBytes<Field extends string>(
	postingsByField: CoverageLexicalV2MutableNumericPostingDelta<Field>,
): number {
	let total = 0;
	for (const map of Object.values(postingsByField) as Array<
		Map<CoverageLexicalV2CanonicalTermId, number[]>
	>) {
		for (const docIds of map.values()) {
			total += 16;
			total += docIds.length * 4;
		}
	}
	return total;
}

function estimateCoverageLexicalV2MutableStringPostingDeltaBytes<Field extends string>(
	postingsByField: CoverageLexicalV2MutableStringPostingDelta<Field>,
): number {
	let total = 0;
	for (const map of Object.values(postingsByField) as Array<Map<string, number[]>>) {
		for (const [term, docIds] of map) {
			total += estimateCoverageLexicalV2StringBytes(term);
			total += 16;
			total += docIds.length * 4;
		}
	}
	return total;
}

function estimateCoverageLexicalV2DocumentViewBytes(
	documentState: CoverageLexicalV2InternalDocumentState,
): number {
	const ownedStrings = new Set<string>();
	const addOwnedStringBytes = (value: string): number => {
		if (value.length === 0 || ownedStrings.has(value)) {
			return 0;
		}
		ownedStrings.add(value);
		return estimateCoverageLexicalV2StringBytes(value);
	};
	return (
		addOwnedStringBytes(documentState.path) +
		addOwnedStringBytes(documentState.indexedRef.path) +
		addOwnedStringBytes(documentState.record.path) +
		addOwnedStringBytes(
			documentState.record.stableDeterministicKey ?? documentState.path,
		) +
		addOwnedStringBytes(documentState.record.basenameText) +
		addOwnedStringBytes(documentState.record.aliasesText) +
		addOwnedStringBytes(documentState.record.headingsText) +
		addOwnedStringBytes(documentState.record.folderText) +
		addOwnedStringBytes(documentState.record.tagsText) +
		64
	);
}

function estimateCoverageLexicalV2DocumentPathMirrorBytes(
	documentState: CoverageLexicalV2InternalDocumentState,
): number {
	let total = 0;
	if (documentState.record.path === documentState.path) {
		total += estimateCoverageLexicalV2StringBytes(documentState.record.path);
	}
	if (documentState.indexedRef.path === documentState.path) {
		total += estimateCoverageLexicalV2StringBytes(documentState.indexedRef.path);
	}
	return total;
}

function estimateCoverageLexicalV2DocumentManifestMirrorBytes(
	documentState: CoverageLexicalV2InternalDocumentState,
): number {
	const stableDeterministicKey =
		documentState.record.stableDeterministicKey ?? documentState.path;
	return stableDeterministicKey === documentState.path
		? estimateCoverageLexicalV2StringBytes(
				stableDeterministicKey,
		  )
		: 0;
}

function estimateCoverageLexicalV2BodyHanSegmentExactBytes(
	bodyHanSegments: readonly string[],
): number {
	const { symbolIds } = encodeCoverageLexicalV2HanSegmentsToSymbolIds(
		bodyHanSegments,
		(codePoint) => codePoint,
	);
	return estimateCoverageLexicalV2EncodedHanSegmentExactBytes(symbolIds);
}

function estimateCoverageLexicalV2EncodedHanSegmentExactBytes(
	bodyHanSymbolIds: readonly number[] | Uint32Array,
): number {
	return encodeCoverageLexicalV2NumericTokenTape(
		Array.from(bodyHanSymbolIds),
	).length;
}

function estimateCoverageLexicalV2LatinExpansionBytes(
	termIds: readonly CoverageLexicalV2CanonicalTermId[],
): number {
	return termIds.length * 4;
}

export function estimateCoverageLexicalV2BodyTokenSequenceBytes(
	bodyTokens: readonly string[],
): number {
	let total = 0;
	for (const token of bodyTokens) {
		total += estimateCoverageLexicalV2StringBytes(token) + 4;
	}
	return total;
}

export function estimateCoverageLexicalV2BodyTokenIdSequenceBytes(
	bodyTokenIds: readonly number[] | Uint32Array,
): number {
	return bodyTokenIds.length * 4;
}

function mapCoverageLexicalV2LocalTokenTapeSegmentsToGlobalIds(
	localLexicon: readonly string[],
	localTokenTape: readonly number[],
	ranges: readonly CoverageLexicalV2TokenRange[],
	getOrCreateGlobalTokenId: (token: string) => number,
): readonly (readonly number[])[] {
	if (ranges.length === 0) {
		return EMPTY_COVERAGE_LEXICAL_V2_NUMBER_SEGMENT_LIST;
	}
	const out: number[][] = [];
	for (const range of ranges) {
		const segment: number[] = [];
		for (let index = range.start; index < range.end; index += 1) {
			const token = localLexicon[localTokenTape[index] ?? -1];
			if (token == null) {
				continue;
			}
			segment.push(getOrCreateGlobalTokenId(token));
		}
		if (segment.length > 0) {
			out.push(segment);
		}
	}
	return out.length === 0 ? EMPTY_COVERAGE_LEXICAL_V2_NUMBER_SEGMENT_LIST : out;
}

function compareCoverageLexicalV2HanBackstopStats(
	left: CoverageLexicalV2CandidateCascadeHanBackstopStats,
	right: CoverageLexicalV2CandidateCascadeHanBackstopStats,
): number {
	if (left.longestContiguousBigramChain !== right.longestContiguousBigramChain) {
		return right.longestContiguousBigramChain - left.longestContiguousBigramChain;
	}
	if (left.matchedBigramCount !== right.matchedBigramCount) {
		return right.matchedBigramCount - left.matchedBigramCount;
	}
	if (left.bigramCoverageRatio !== right.bigramCoverageRatio) {
		return right.bigramCoverageRatio - left.bigramCoverageRatio;
	}
	return 0;
}

function computeCoverageLexicalV2HanBackstopLongestChain(
	matchedBigramIndices: ReadonlySet<number>,
): number {
	const sorted = [...matchedBigramIndices].sort((left, right) => left - right);
	let longest = 0;
	let current = 0;
	let previous = Number.NaN;
	for (const bigramIndex of sorted) {
		if (!Number.isFinite(previous) || bigramIndex === previous + 1) {
			current += 1;
		} else {
			current = 1;
		}
		if (current > longest) {
			longest = current;
		}
		previous = bigramIndex;
	}
	return longest;
}

function countCoverageLexicalV2PositiveRefCounts(
	refCounts: ReadonlyMap<CoverageLexicalV2CanonicalTermId, number>,
): number {
	let total = 0;
	for (const count of refCounts.values()) {
		if (count > 0) {
			total += 1;
		}
	}
	return total;
}

function insertCoverageLexicalV2SortedNumber(values: number[], target: number): void {
	const index = lowerBoundCoverageLexicalV2IndexStoreNumber(values, target);
	if (values[index] === target) {
		return;
	}
	values.splice(index, 0, target);
}

function removeCoverageLexicalV2Number(values: number[], target: number): void {
	const index = lowerBoundCoverageLexicalV2IndexStoreNumber(values, target);
	if (values[index] === target) {
		values.splice(index, 1);
	}
}

function lowerBoundCoverageLexicalV2IndexStoreNumber(
	values: readonly number[],
	target: number,
): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (values[middle] < target) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

function lowerBoundCoverageLexicalV2IndexStoreString(
	values: readonly string[],
	target: string,
): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (values[middle] < target) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

function lowerBoundCoverageLexicalV2IndexStoreLatinTermIds(
	values: readonly CoverageLexicalV2CanonicalTermId[],
	lexicon: readonly string[],
	target: string,
): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if ((lexicon[values[middle]] ?? "") < target) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

function mapCoverageLexicalV2StringListToIds(
	values: readonly string[],
	getOrCreateTermId: (term: string) => CoverageLexicalV2CanonicalTermId,
): readonly CoverageLexicalV2CanonicalTermId[] {
	return values.length === 0
		? EMPTY_COVERAGE_LEXICAL_V2_NUMBER_LIST
		: values.map((value) => getOrCreateTermId(value));
}

function decodeCoverageLexicalV2TermIdList(
	values: readonly CoverageLexicalV2CanonicalTermId[],
	decodeTerm: (termId: CoverageLexicalV2CanonicalTermId) => string,
): readonly string[] {
	return values.length === 0
		? EMPTY_COVERAGE_LEXICAL_V2_STRING_LIST
		: values.map((value) => decodeTerm(value));
}

function buildCoverageLexicalV2CanonicalTermLexicon(
	pool: CoverageLexicalV2CanonicalTermPool,
): string[] {
	const lexicon: string[] = [];
	const termCount = getCoverageLexicalV2CanonicalTermCount(pool);
	for (let termId = 0; termId < termCount; termId += 1) {
		lexicon.push(decodeCoverageLexicalV2CanonicalTerm(pool, termId));
	}
	return lexicon;
}

function compareCoverageLexicalV2IndexStoreStrings(
	left: string,
	right: string,
): number {
	return left.localeCompare(right);
}

function estimateCoverageLexicalV2StringBytes(value: string): number {
	return textEncoder.encode(value).length;
}

function toCoverageLexicalV2HanSymbolIds(
	text: string,
	pool: CoverageLexicalV2HanSymbolPool,
): CoverageLexicalV2HanSymbolId[] {
	const symbolIds: CoverageLexicalV2HanSymbolId[] = [];
	for (const token of Array.from(text)) {
		const codePoint = token.codePointAt(0);
		if (codePoint === undefined) {
			continue;
		}
		symbolIds.push(
			findCoverageLexicalV2HanSymbolId(pool, codePoint) ??
				MISSING_COVERAGE_LEXICAL_V2_HAN_SYMBOL_ID,
		);
	}
	return symbolIds;
}

function encodeCoverageLexicalV2HanSegmentsToSymbolIds(
	segments: readonly string[],
	getOrCreateHanSymbolId: (codePoint: number) => CoverageLexicalV2HanSymbolId,
): {
	symbolIds: Uint32Array;
	segmentCount: number;
} {
	if (segments.length === 0) {
		return {
			symbolIds: new Uint32Array(0),
			segmentCount: 0,
		};
	}
	const encoded: CoverageLexicalV2HanSymbolId[] = [];
	let segmentCount = 0;
	for (const segment of segments) {
		const symbolIds: CoverageLexicalV2HanSymbolId[] = [];
		for (const token of Array.from(segment)) {
			const codePoint = token.codePointAt(0);
			if (codePoint === undefined) {
				continue;
			}
			symbolIds.push(getOrCreateHanSymbolId(codePoint));
		}
		if (symbolIds.length === 0) {
			continue;
		}
		segmentCount += 1;
		if (encoded.length > 0) {
			encoded.push(COVERAGE_LEXICAL_V2_HAN_SEGMENT_SEPARATOR_ID);
		}
		encoded.push(...symbolIds);
	}
	if (encoded.length === 0) {
		return {
			symbolIds: new Uint32Array(0),
			segmentCount: 0,
		};
	}
	return {
		symbolIds: Uint32Array.from(encoded),
		segmentCount,
	};
}

function encodeCoverageLexicalV2HanBigramId(
	bigram: string,
): CoverageLexicalV2HanBigramId | undefined {
	const chars = Array.from(bigram);
	if (chars.length !== 2) {
		return undefined;
	}
	const leftCodePoint = chars[0]?.codePointAt(0);
	const rightCodePoint = chars[1]?.codePointAt(0);
	if (leftCodePoint === undefined || rightCodePoint === undefined) {
		return undefined;
	}
	let hash = COVERAGE_LEXICAL_V2_HAN_BIGRAM_HASH_OFFSET_BASIS;
	hash = Math.imul(hash ^ leftCodePoint, COVERAGE_LEXICAL_V2_HAN_BIGRAM_HASH_PRIME);
	hash = Math.imul(
		hash ^ rightCodePoint,
		COVERAGE_LEXICAL_V2_HAN_BIGRAM_HASH_PRIME,
	);
	return hash >>> 0;
}

function buildCoverageLexicalV2HanGateBloomWords(
	segments: readonly string[],
): readonly CoverageLexicalV2HanGateBloomWord[] {
	if (segments.length === 0) {
		return EMPTY_COVERAGE_LEXICAL_V2_HAN_GATE_BLOOM_WORDS;
	}
	const words = new Array<number>(COVERAGE_LEXICAL_V2_HAN_GATE_BLOOM_WORD_COUNT).fill(0);
	for (const segment of segments) {
		const chars = Array.from(segment);
		for (let index = 0; index < chars.length - 1; index += 1) {
			const bigramId = encodeCoverageLexicalV2HanBigramId(
				chars[index] + chars[index + 1],
			);
			if (bigramId === undefined) {
				continue;
			}
			addCoverageLexicalV2HanBigramIdToBloom(words, bigramId);
		}
	}
	return words.every((word) => word === 0)
		? EMPTY_COVERAGE_LEXICAL_V2_HAN_GATE_BLOOM_WORDS
		: words;
}

function addCoverageLexicalV2HanBigramIdToBloom(
	words: number[],
	bigramId: CoverageLexicalV2HanBigramId,
): void {
	for (let seed = 0; seed < COVERAGE_LEXICAL_V2_HAN_GATE_BLOOM_HASH_COUNT; seed += 1) {
		const mixed = mixCoverageLexicalV2HanBigramIdForBloom(bigramId, seed);
		const wordIndex = mixed & (COVERAGE_LEXICAL_V2_HAN_GATE_BLOOM_WORD_COUNT - 1);
		const bitIndex = (mixed >>> 4) & 31;
		words[wordIndex] = (words[wordIndex] ?? 0) | (1 << bitIndex);
	}
}

function mightContainCoverageLexicalV2HanBigramId(
	words: readonly CoverageLexicalV2HanGateBloomWord[],
	bigramId: CoverageLexicalV2HanBigramId,
): boolean {
	for (let seed = 0; seed < COVERAGE_LEXICAL_V2_HAN_GATE_BLOOM_HASH_COUNT; seed += 1) {
		const mixed = mixCoverageLexicalV2HanBigramIdForBloom(bigramId, seed);
		const wordIndex = mixed & (COVERAGE_LEXICAL_V2_HAN_GATE_BLOOM_WORD_COUNT - 1);
		const bitIndex = (mixed >>> 4) & 31;
		if ((((words[wordIndex] ?? 0) >>> bitIndex) & 1) === 0) {
			return false;
		}
	}
	return true;
}

function mixCoverageLexicalV2HanBigramIdForBloom(
	bigramId: CoverageLexicalV2HanBigramId,
	seed: number,
): number {
	let mixed = bigramId ^ Math.imul(seed + 1, 0x9e3779b1);
	mixed ^= mixed >>> 16;
	mixed = Math.imul(mixed, 0x7feb352d);
	mixed ^= mixed >>> 15;
	mixed = Math.imul(mixed, 0x846ca68b);
	mixed ^= mixed >>> 16;
	return mixed >>> 0;
}
