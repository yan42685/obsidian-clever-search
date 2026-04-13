import type {
	BaseIndexedFileRef,
	IndexedDocument,
} from "src/globals/search-types";
import type {
	CoverageLexicalV2CandidateCascadeDocumentRecord,
	CoverageLexicalV2CandidateCascadeHanBackstopStats,
	CoverageLexicalV2CandidateCascadeHanExactWitness,
	CoverageLexicalV2CandidateCascadeHanBlockExactPrefetchResult,
	CoverageLexicalV2CandidateCascadePostingField,
	CoverageLexicalV2CandidateCascadeStorageReader,
} from "../candidate-cascade";

export const COVERAGE_LEXICAL_V2_INDEX_STORE_SCHEMA_VERSION = 11;
export const COVERAGE_LEXICAL_V2_INDEX_STORE_META_ID = "active";
export const COVERAGE_LEXICAL_V2_INDEX_STORE_SNAPSHOT_CHUNK_ID = "active:0";
export type CoverageLexicalV2CanonicalTermId = number;
export type CoverageLexicalV2HanSymbolId = number;
export type CoverageLexicalV2HanBigramId = number;
export type CoverageLexicalV2HanGateBloomWord = number;

export type CoverageLexicalV2MetadataPostingField = Exclude<
	CoverageLexicalV2CandidateCascadePostingField,
	"body"
>;

export type CoverageLexicalV2FieldTermLists = Record<
	CoverageLexicalV2CandidateCascadePostingField,
	readonly string[]
>;

export type CoverageLexicalV2FieldTermIdLists = Record<
	CoverageLexicalV2CandidateCascadePostingField,
	readonly CoverageLexicalV2CanonicalTermId[]
>;

export type CoverageLexicalV2MetadataBigramLists = Record<
	CoverageLexicalV2MetadataPostingField,
	readonly string[]
>;

export type CoverageLexicalV2MetadataBigramIdLists = Record<
	CoverageLexicalV2MetadataPostingField,
	readonly CoverageLexicalV2CanonicalTermId[]
>;

export type CoverageLexicalV2NormalizedDocumentTexts = Pick<
	CoverageLexicalV2CandidateCascadeDocumentRecord,
	| "basenameText"
	| "aliasesText"
	| "headingsText"
	| "folderText"
	| "tagsText"
>;

export type CoverageLexicalV2BodyTokenSidecarLocator = {
	path: string;
	generation?: number;
	size?: number;
	tokenCount: number;
	estimatedBytes: number;
};

export type CoverageLexicalV2RuntimeBodyTokenSidecarMetadata = Omit<
	CoverageLexicalV2BodyTokenSidecarLocator,
	"path"
>;

export type CoverageLexicalV2BodyHanSegmentExactSidecarLocator = {
	generation?: number;
	size?: number;
	segmentCount: number;
	logicalBlockCount: number;
	estimatedBytes: number;
};

export type CoverageLexicalV2RuntimeBodyHanSegmentExactSidecarMetadata =
	CoverageLexicalV2BodyHanSegmentExactSidecarLocator;

export type CoverageLexicalV2RuntimeBodyHanLogicalBlockManifest = {
	blockOrdinal: number;
	segmentCount: number;
	symbolCount: number;
	encodedByteLength: number;
};

export type CoverageLexicalV2PersistedBodyHanLogicalBlockManifest =
	CoverageLexicalV2RuntimeBodyHanLogicalBlockManifest & {
	bigramIds: readonly CoverageLexicalV2HanBigramId[];
	};

export type CoverageLexicalV2PreparedDocument = {
	path: string;
	generation?: number;
	indexedRef: BaseIndexedFileRef;
	record: CoverageLexicalV2CandidateCascadeDocumentRecord;
	exactTermsByField: CoverageLexicalV2FieldTermLists;
	metadataHanBigramsByField: CoverageLexicalV2MetadataBigramLists;
	bodyHanSegments: readonly string[];
	bodyTokens: readonly string[];
};

export type CoverageLexicalV2CanonicalTermPoolState = {
	arenaBytes: readonly number[];
	termOffsets: readonly number[];
};

export type CoverageLexicalV2HanSymbolPoolState = {
	codePointsBySymbolId: readonly number[];
};

export type CoverageLexicalV2IndexStorePersistedDocManifest = {
	exactTermIdsByField: CoverageLexicalV2FieldTermIdLists;
	metadataHanBigramIdsByField: CoverageLexicalV2MetadataBigramIdLists;
	bodyHanLogicalBlocks: readonly CoverageLexicalV2PersistedBodyHanLogicalBlockManifest[];
	hasBodyHanSegments: boolean;
	bodyHanSegmentExactSidecar: CoverageLexicalV2BodyHanSegmentExactSidecarLocator;
	bodyTokenSidecar: CoverageLexicalV2BodyTokenSidecarLocator;
};

export type CoverageLexicalV2IndexStoreRuntimeDocManifest = {
	exactTermIdsByField: CoverageLexicalV2FieldTermIdLists;
	metadataHanBigramIdsByField: CoverageLexicalV2MetadataBigramIdLists;
	bodyHanLogicalBlocks: readonly CoverageLexicalV2RuntimeBodyHanLogicalBlockManifest[];
	hasBodyHanSegments: boolean;
	bodyHanSegmentExactSidecar: CoverageLexicalV2RuntimeBodyHanSegmentExactSidecarMetadata;
	bodyTokenSidecar: CoverageLexicalV2RuntimeBodyTokenSidecarMetadata;
};

export type CoverageLexicalV2IndexStoreDocumentState = {
	docId: number;
	path: string;
	generation?: number;
	indexedRef: BaseIndexedFileRef;
	record: CoverageLexicalV2CandidateCascadeDocumentRecord;
	manifest: CoverageLexicalV2IndexStoreRuntimeDocManifest;
};

export type CoverageLexicalV2PostingEncoding = "tiny_inline" | "delta_varint";

export type CoverageLexicalV2PackedNumberList =
	| readonly number[]
	| Uint8Array
	| Uint16Array
	| Uint32Array;

export type CoverageLexicalV2SerializedPostingDirectoryEntry = {
	encoding: CoverageLexicalV2PostingEncoding;
	docCount: number;
	tapeStart: number;
	tapeLength: number;
	inlineDocIds?: readonly number[];
};

export type CoverageLexicalV2SerializedPostingFieldSegment = {
	termIdDictionary: readonly CoverageLexicalV2CanonicalTermId[];
	postingDirectory: readonly CoverageLexicalV2SerializedPostingDirectoryEntry[];
	postingTape: readonly number[];
};

export type CoverageLexicalV2SerializedAdaptivePostingFieldSegment = {
	singletonTermIds: CoverageLexicalV2PackedNumberList;
	singletonValueIds: CoverageLexicalV2PackedNumberList;
	pairTermIds: CoverageLexicalV2PackedNumberList;
	pairFirstValueIds: CoverageLexicalV2PackedNumberList;
	pairSecondValueIds: CoverageLexicalV2PackedNumberList;
	smallTermIds: CoverageLexicalV2PackedNumberList;
	smallValueStarts: CoverageLexicalV2PackedNumberList;
	smallValueIds: CoverageLexicalV2PackedNumberList;
	deltaTermIds: CoverageLexicalV2PackedNumberList;
	deltaTapeStarts: CoverageLexicalV2PackedNumberList;
	postingTape: CoverageLexicalV2PackedNumberList;
};

export type CoverageLexicalV2SerializedAdaptiveBodyPostingFieldSegment =
	CoverageLexicalV2SerializedAdaptivePostingFieldSegment;

export type CoverageLexicalV2SerializedExactSegmentFields = Record<
	CoverageLexicalV2CandidateCascadePostingField,
	CoverageLexicalV2SerializedAdaptivePostingFieldSegment
>;

export type CoverageLexicalV2SerializedMetadataSegmentFields = Record<
	CoverageLexicalV2MetadataPostingField,
	CoverageLexicalV2SerializedAdaptivePostingFieldSegment
>;

export type CoverageLexicalV2IndexStoreResidentSegment = {
	id: string;
	createdAt: number;
	docCount: number;
	exactByField: CoverageLexicalV2SerializedExactSegmentFields;
	metadataHanByField: CoverageLexicalV2SerializedMetadataSegmentFields;
};

export type CoverageLexicalV2ResidentHanShardBlockDescriptor = {
	blockId: number;
	docId: number;
	generation?: number;
	blockOrdinal: number;
	encodedByteLength: number;
};

export type CoverageLexicalV2ResidentHanShard = {
	id: string;
	createdAt: number;
	localBlockCount: number;
	postingsByBigram: CoverageLexicalV2SerializedAdaptivePostingFieldSegment;
	blockDescriptors: readonly CoverageLexicalV2ResidentHanShardBlockDescriptor[];
};

export type CoverageLexicalV2SerializedPostingDeltaRecord<
	Field extends string,
> = Record<Field, Readonly<Record<string, readonly number[]>>>;

export type CoverageLexicalV2SerializedTermIdPostingDeltaRecord<
	Field extends string,
> = Record<Field, Readonly<Record<string, readonly number[]>>>;

export type CoverageLexicalV2SerializedExactPostingDeltaRecord =
	CoverageLexicalV2SerializedTermIdPostingDeltaRecord<
		CoverageLexicalV2CandidateCascadePostingField
	>;

export type CoverageLexicalV2SerializedMetadataPostingDeltaRecord =
	CoverageLexicalV2SerializedPostingDeltaRecord<
		CoverageLexicalV2MetadataPostingField
	>;

export type CoverageLexicalV2IndexStoreOverlayState = {
	exactAddsByField: CoverageLexicalV2SerializedExactPostingDeltaRecord;
	exactRemovalsByField: CoverageLexicalV2SerializedExactPostingDeltaRecord;
	metadataHanAddsByField: CoverageLexicalV2SerializedMetadataPostingDeltaRecord;
	metadataHanRemovalsByField: CoverageLexicalV2SerializedMetadataPostingDeltaRecord;
};

export type CoverageLexicalV2IndexStoreSnapshotDocument = {
	docId: number;
	path: string;
	generation?: number;
	indexedRef: BaseIndexedFileRef;
	record: CoverageLexicalV2CandidateCascadeDocumentRecord;
	manifest: CoverageLexicalV2IndexStorePersistedDocManifest;
};

export type CoverageLexicalV2IndexStoreSnapshotState = {
	schemaVersion: number;
	nextDocumentId: number;
	snapshotCreatedAt: number;
	canonicalTermPool: CoverageLexicalV2CanonicalTermPoolState;
	hanSymbolPool: CoverageLexicalV2HanSymbolPoolState;
	documents: readonly CoverageLexicalV2IndexStoreSnapshotDocument[];
	segments: readonly CoverageLexicalV2IndexStoreResidentSegment[];
	overlay: CoverageLexicalV2IndexStoreOverlayState;
};

export type CoverageLexicalV2IndexStoreJournalTransaction = {
	transactionId: string;
	commitSequence?: number;
};

export type CoverageLexicalV2PersistedJournalDocument = {
	path: string;
	generation?: number;
	indexedRef: BaseIndexedFileRef;
	record: CoverageLexicalV2CandidateCascadeDocumentRecord;
	exactTermIdsByField: CoverageLexicalV2FieldTermIdLists;
	metadataHanBigramIdsByField: CoverageLexicalV2MetadataBigramIdLists;
	bodyHanLogicalBlocks: readonly CoverageLexicalV2PersistedBodyHanLogicalBlockManifest[];
	bodyHanSegmentExactSidecar: CoverageLexicalV2BodyHanSegmentExactSidecarLocator;
	bodyTokenSidecar: CoverageLexicalV2BodyTokenSidecarLocator;
};

export type CoverageLexicalV2IndexStoreReplaceJournalEntry = {
	kind: "replace";
	path: string;
	previousPath?: string;
	updatedAt: number;
	transaction: CoverageLexicalV2IndexStoreJournalTransaction;
	document: CoverageLexicalV2PersistedJournalDocument;
};

export type CoverageLexicalV2IndexStoreMoveJournalEntry = {
	kind: "move";
	path: string;
	previousPath: string;
	updatedAt: number;
	transaction: CoverageLexicalV2IndexStoreJournalTransaction;
	document: CoverageLexicalV2PersistedJournalDocument;
};

export type CoverageLexicalV2IndexStoreDeleteJournalEntry = {
	kind: "delete";
	path: string;
	updatedAt: number;
	transaction: CoverageLexicalV2IndexStoreJournalTransaction;
};

export type CoverageLexicalV2IndexStoreJournalEntry =
	| CoverageLexicalV2IndexStoreReplaceJournalEntry
	| CoverageLexicalV2IndexStoreMoveJournalEntry
	| CoverageLexicalV2IndexStoreDeleteJournalEntry;

export type CoverageLexicalV2IndexStoreMetaRow = {
	id: typeof COVERAGE_LEXICAL_V2_INDEX_STORE_META_ID;
	schemaVersion: number;
	activeSnapshotId: string | null;
	snapshotDocumentCount: number;
	journalSequence: number;
	checkpointedJournalSequence: number;
	updatedAt: number;
};

export type CoverageLexicalV2IndexStoreSnapshotChunkRow = {
	id: string;
	snapshotId: string;
	order: number;
	updatedAt: number;
	data: ArrayBuffer;
};

export type CoverageLexicalV2IndexStoreJournalRow = {
	id: string;
	sequence: number;
	kind: CoverageLexicalV2IndexStoreJournalEntry["kind"];
	path: string;
	payloadJson?: string;
	updatedAt: number;
};

export type CoverageLexicalV2IndexStorePersistenceApi = {
	readSnapshot(): Promise<CoverageLexicalV2IndexStoreSnapshotState | null>;
	writeSnapshot(
		snapshot: CoverageLexicalV2IndexStoreSnapshotState,
		meta: Pick<CoverageLexicalV2IndexStoreMetaRow, "snapshotDocumentCount" | "updatedAt">,
	): Promise<void>;
	clearSnapshot(): Promise<void>;
	readJournal(): Promise<readonly CoverageLexicalV2IndexStoreJournalEntry[]>;
	appendJournalEntries(
		entries: readonly CoverageLexicalV2IndexStoreJournalEntry[],
	): Promise<void>;
	clearJournal(): Promise<void>;
};

export type CoverageLexicalV2IndexStoreReaderOptions = Pick<
	CoverageLexicalV2CandidateCascadeStorageReader,
	| "getBodyTokenSequence"
	| "prefetchBodyTokenSequences"
	| "tokenizeText"
	| "prefetchBodyHanExactBlocks"
	| "getBodyHanExactBlockBackstopStats"
> & {
	getBodyHanExactBlockWitness: CoverageLexicalV2IndexStoreBodyHanExactBlockWitnessReader;
};

export type CoverageLexicalV2IndexStoreBodyHanExactBlockWitnessReader = (
	blockId: number,
	normalizedText: string,
	bigrams: readonly string[],
) => CoverageLexicalV2CandidateCascadeHanExactWitness | null;

export type CoverageLexicalV2RuntimeMemoryBreakdown = {
	estimatedBytes: {
		residentHot: {
			total: number;
			postings: {
				exactIncidence: number;
				metadataHanGate: number;
				bodyHanShards: number;
			};
			documents: {
				view: number;
			};
			verification: {
				bodyHanSegments: number;
				bodyHanShardDescriptors: number;
			};
			lexicon: {
				canonicalTerms: number;
				latinExpansion: number;
			};
			caches: {
				bodyTokensHot: number;
			};
		};
		coldOwned: {
			total: number;
			bodyTokensSidecar: number;
			bodyHanSegmentExactSidecar: number;
		};
		overlapDiagnostics: {
			total: number;
			bodyTokensHotVsSidecar: number;
			pathMirrors: number;
			manifestMirrors: number;
		};
		combinedOwnedTotal: number;
	};
	documentCount: number;
	nextDocumentId: number;
	exactTermCount: number;
	metadataHanBigramCount: number;
	latinExpansionTermCount: number;
	segmentCount: number;
};

export type CoverageLexicalV2PreparedDocumentBuilder = (
	document: IndexedDocument,
) => CoverageLexicalV2PreparedDocument;

export type CoverageLexicalV2PersistentRecoveryPlan = {
	status: "up_to_date" | "needs_heal" | "needs_full_rebuild";
	reason:
		| "up_to_date"
		| "missing_snapshot"
		| "snapshot_corrupted"
		| "snapshot_version_mismatch"
		| "doc_registry_conflict"
		| "manifest_missing"
		| "persisted_ref_mismatch"
		| "journal_corruption"
		| "vault_drift"
		| "cold_sidecar_drift";
	docsToDelete: string[];
	docsToAdd: string[];
	docsToUpdate: string[];
	docsToMove: Array<{
		oldPath: string;
		newPath: string;
	}>;
};
