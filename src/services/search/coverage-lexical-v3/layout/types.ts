import type {
	ResidentIntegerArray,
	ResidentSectionEncodingDescriptor,
} from "./integer-arrays";
import type { ResidentBlockPositionLane } from "./position-lanes";

export type ResidentStringArena = Readonly<{
	text: string;
	offsets: ResidentIntegerArray;
	lengths: ResidentIntegerArray;
	count: number;
}>;

export type ResidentDocTable = Readonly<{
	docCount: number;
	liveDocCount: number;
	docRefsByDocId: Float64Array;
	docRefsByLiveDocSlot: Float64Array;
	liveDocSlotByDocId: ResidentIntegerArray;
	docIdByLiveDocSlot: ResidentIntegerArray;
	pathStringIds: ResidentIntegerArray;
	pathStringIdsByLiveDocSlot: ResidentIntegerArray;
	generationByDocId: Float64Array;
	generationByLiveDocSlot: Float64Array;
	identityStartByDocId: ResidentIntegerArray;
	identityCountByDocId: ResidentIntegerArray;
	identityStartByLiveDocSlot: ResidentIntegerArray;
	identityCountByLiveDocSlot: ResidentIntegerArray;
	routeStartByDocId: ResidentIntegerArray;
	routeCountByDocId: ResidentIntegerArray;
	routeStartByLiveDocSlot: ResidentIntegerArray;
	routeCountByLiveDocSlot: ResidentIntegerArray;
	headingStartByDocId: ResidentIntegerArray;
	headingCountByDocId: ResidentIntegerArray;
	headingStartByLiveDocSlot: ResidentIntegerArray;
	headingCountByLiveDocSlot: ResidentIntegerArray;
	bodyBlockStartByDocId: ResidentIntegerArray;
	bodyBlockCountByDocId: ResidentIntegerArray;
	bodyBlockStartByLiveDocSlot: ResidentIntegerArray;
	bodyBlockCountByLiveDocSlot: ResidentIntegerArray;
}>;

export type ResidentFamilyKind = "latin" | "han" | "mixed" | "other";

export type ResidentFamilyLexicon = Readonly<{
	familyCount: number;
	shardLocalFamilyCount: number;
	shardLocalFamilySlotByFamilyId: ResidentIntegerArray;
	familyIdByShardLocalFamilySlot: ResidentIntegerArray;
	familyStringIds: ResidentIntegerArray;
	familyFlagsByFamilyId: Uint8Array;
}>;

export type ResidentPostingList = Readonly<{
	postingStarts: ResidentIntegerArray;
	docIds: ResidentIntegerArray;
}>;

export type ResidentBlockPostingList = Readonly<{
	postingStarts: ResidentIntegerArray;
	blockIds: ResidentIntegerArray;
}>;

export type ResidentMetadataContainerArena = Readonly<{
	identityFamiliesByDoc: ResidentIntegerArray;
	identitySourceMaskByDocEntry: Uint8Array;
	routeFamiliesByDoc: ResidentIntegerArray;
	routeSourceMaskByDocEntry: Uint8Array;
	headingFamiliesByDoc: ResidentIntegerArray;
	identityPostings: ResidentPostingList;
	routePostings: ResidentPostingList;
	headingPostings: ResidentPostingList;
}>;

export type ResidentBodyFamilyPostingField = ResidentAdaptivePostingField;

export type ResidentBodyBlockArena = Readonly<{
	blockCount: number;
	docIdByBlockId: ResidentIntegerArray;
	liveDocSlotByBlockId: ResidentIntegerArray;
	blockOrdinalByBlockId: ResidentIntegerArray;
	exactTapeStartByBlockId: ResidentIntegerArray;
	exactTapeCountByBlockId: ResidentIntegerArray;
	familySupportStartByBlockId: ResidentIntegerArray;
	familySupportFamilyIds: ResidentIntegerArray;
	familySupportMaskByEntry: Uint8Array;
}>;

export type ResidentBodyFamilySupportSidecar = Readonly<{
	familySupportStartByBlockId: ResidentIntegerArray;
	familySupportFamilyIds: ResidentIntegerArray;
	familySupportMaskByEntry: Uint8Array;
	entryCount: number;
	bytes: number;
}>;

export type ResidentExactTapeArena = Readonly<{
	familyIds: ResidentIntegerArray;
}> &
	ResidentBlockPositionLane;

export type ResidentExactTapeSidecar = ResidentExactTapeArena &
	Readonly<{
		entryCount: number;
		bytes: number;
	}>;

export type ResidentAdaptivePostingField = Readonly<{
	singletonTermIds: ResidentIntegerArray;
	singletonValueIds: ResidentIntegerArray;
	pairTermIds: ResidentIntegerArray;
	pairFirstValueIds: ResidentIntegerArray;
	pairSecondValueIds: ResidentIntegerArray;
	smallTermIds: ResidentIntegerArray;
	smallValueStarts: ResidentIntegerArray;
	smallValueIds: ResidentIntegerArray;
	deltaTermIds: ResidentIntegerArray;
	deltaTapeStarts: ResidentIntegerArray;
	postingTape: Uint8Array;
}>;

export type ResidentFuzzyRescueSidecar = Readonly<{
	candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey: ReadonlyMap<
		string,
		Uint32Array
	>;
	indexedMetadataFamilyCount: number;
	fuzzyLookupKeyCount: number;
	bytes: number;
}>;

export type ResidentHanWitnessSidecar = Readonly<{
	identityWitnessStartByDocId: ResidentIntegerArray;
	identityWitnessStartByLiveDocSlot?: ResidentIntegerArray;
	identityWitnessStringIds: ResidentIntegerArray;
	identityWitnessSourceMaskByDocEntry: Uint8Array;
	routeWitnessStartByDocId: ResidentIntegerArray;
	routeWitnessStartByLiveDocSlot?: ResidentIntegerArray;
	routeWitnessStringIds: ResidentIntegerArray;
	routeWitnessSourceMaskByDocEntry: Uint8Array;
	headingWitnessStartByDocId: ResidentIntegerArray;
	headingWitnessStartByLiveDocSlot?: ResidentIntegerArray;
	headingWitnessStringIds: ResidentIntegerArray;
	bodyWitnessOccurrenceStartByBlockId: ResidentIntegerArray;
	bodyWitnessOccurrenceStringIds: ResidentIntegerArray;
	bodyWitnessPositionEncodingByBlockId: Uint8Array;
	bodyWitnessPositionStartByBlockId: ResidentIntegerArray;
	bodyWitnessPositionDeltaU8Tape: Uint8Array;
	bodyWitnessPositionDeltaU16Tape: Uint16Array;
	bodyWitnessPositionDeltaU32Tape: Uint32Array;
	metadataWitnessEntryCount: number;
	bodyWitnessEntryCount: number;
	bytes: number;
}>;

export type ResidentHanRouteArena = Readonly<{
	bigramIds: Uint32Array;
	metadataPostingStarts: ResidentIntegerArray;
	metadataDocIds: ResidentIntegerArray;
	bodyAdaptivePostings: ResidentAdaptivePostingField;
	metadataCharIds: Uint32Array;
	metadataCharPostingStarts: ResidentIntegerArray;
	metadataCharDocIds: ResidentIntegerArray;
	bodyCharAdaptivePostings: ResidentAdaptivePostingField;
	identityWitnessStartByDocId: ResidentIntegerArray;
	identityWitnessStartByLiveDocSlot?: ResidentIntegerArray;
	identityWitnessStringIds: ResidentIntegerArray;
	identityWitnessSourceMaskByDocEntry: Uint8Array;
	routeWitnessStartByDocId: ResidentIntegerArray;
	routeWitnessStartByLiveDocSlot?: ResidentIntegerArray;
	routeWitnessStringIds: ResidentIntegerArray;
	routeWitnessSourceMaskByDocEntry: Uint8Array;
	headingWitnessStartByDocId: ResidentIntegerArray;
	headingWitnessStartByLiveDocSlot?: ResidentIntegerArray;
	headingWitnessStringIds: ResidentIntegerArray;
	bodyWitnessOccurrenceStartByBlockId: ResidentIntegerArray;
	bodyWitnessOccurrenceStringIds: ResidentIntegerArray;
}> &
	{
		bodyWitnessPositionEncodingByBlockId: Uint8Array;
		bodyWitnessPositionStartByBlockId: ResidentIntegerArray;
		bodyWitnessPositionDeltaU8Tape: Uint8Array;
		bodyWitnessPositionDeltaU16Tape: Uint16Array;
		bodyWitnessPositionDeltaU32Tape: Uint32Array;
	};

export type ResidentBaseMetrics = Readonly<{
	docArenaBytes: number;
	stringArenaBytes: number;
	stringArenaPathBytes: number;
	stringArenaFamilyBytes: number;
	stringArenaIdentityWitnessBytes: number;
	stringArenaRouteWitnessBytes: number;
	stringArenaHeadingWitnessBytes: number;
	stringArenaBodyWitnessBytes: number;
	stringArenaMultiSourceBytes: number;
	stringArenaUnattributedBytes: number;
	familyLexiconBytes: number;
	metadataContainerBytes: number;
	headingBytes: number;
	familyPostingBytes: number;
	familyPostingTermIdsBytes: number;
	familyPostingPostingStartsBytes: number;
	familyPostingBlockIdsBytes: number;
	familyPostingSingletonTermIdsBytes: number;
	familyPostingSingletonBlockIdsBytes: number;
	familyPostingPairTermIdsBytes: number;
	familyPostingPairFirstBlockIdsBytes: number;
	familyPostingPairSecondBlockIdsBytes: number;
	familyPostingSmallTermIdsBytes: number;
	familyPostingSmallPostingStartsBytes: number;
	familyPostingSmallBlockIdsBytes: number;
	familyPostingDeltaTermIdsBytes: number;
	familyPostingDeltaTapeStartsBytes: number;
	familyPostingDeltaPostingTapeBytes: number;
	bodyBlockBytes: number;
	exactTapeBytes: number;
	exactTapePositionBytes: number;
	hanRouteBytes: number;
	hanRouteSharedBigramIdsBytes: number;
	hanRouteMetadataHanPostingsBytes: number;
	hanRouteMetadataHanPostingStartsBytes: number;
	hanRouteMetadataHanDocIdsBytes: number;
	hanRouteHanBigramPostingBytes: number;
	hanRouteBodyBigramIdsBytes: number;
	hanRouteHanBigramPostingStartsBytes: number;
	hanRouteHanBigramBlockIdsBytes: number;
	hanRouteHanBigramSingletonTermIdsBytes: number;
	hanRouteHanBigramSingletonBlockIdsBytes: number;
	hanRouteHanBigramPairTermIdsBytes: number;
	hanRouteHanBigramPairFirstBlockIdsBytes: number;
	hanRouteHanBigramPairSecondBlockIdsBytes: number;
	hanRouteHanBigramSmallTermIdsBytes: number;
	hanRouteHanBigramSmallPostingStartsBytes: number;
	hanRouteHanBigramSmallBlockIdsBytes: number;
	hanRouteHanBigramDeltaTermIdsBytes: number;
	hanRouteHanBigramDeltaTapeStartsBytes: number;
	hanRouteHanBigramDeltaPostingTapeBytes: number;
	hanRouteMetadataHanCharPostingsBytes: number;
	hanRouteMetadataHanCharPostingStartsBytes: number;
	hanRouteMetadataHanCharDocIdsBytes: number;
	hanRouteHanCharPostingBytes: number;
	hanRouteBodyCharIdsBytes: number;
	hanRouteHanCharPostingStartsBytes: number;
	hanRouteHanCharBlockIdsBytes: number;
	hanRouteMetadataWitnessBytes: number;
	hanRouteBodyWitnessBytes: number;
	hanRouteBodyWitnessPositionBytes: number;
	scaffoldBytes: number;
	countBytes: number;
	idPayloadBytes: number;
	stringPayloadBytes: number;
	auxiliaryBytes: number;
	residentBytes: number;
	indexedSurfaceUtf8Bytes: number;
	rawMarkdownUtf8Bytes: number;
	"residentBytes / indexedSurfaceUtf8Bytes": number;
	"residentBytes / rawMarkdownUtf8Bytes": number;
}>;

export type ResidentByteBreakdownEntry = Readonly<{
	label: string;
	bytes: number;
	share: number;
}>;

export type ResidentBaseSummary = Readonly<{
	documentCount: number;
	familyCount: number;
	blockCount: number;
	exactTapeValueCount: number;
	buckets: readonly ResidentByteBreakdownEntry[];
	sectionEncodings: readonly ResidentSectionEncodingDescriptor[];
	indexedSurfaceUtf8Bytes: number;
	rawMarkdownUtf8Bytes: number;
	"residentBytes / indexedSurfaceUtf8Bytes": number;
	"residentBytes / rawMarkdownUtf8Bytes": number;
}>;

export type ResidentBase = Readonly<{
	version: 1;
	stringArena: ResidentStringArena;
	docTable: ResidentDocTable;
	familyLexicon: ResidentFamilyLexicon;
	metadataContainers: ResidentMetadataContainerArena;
	bodyFamilyPosting: ResidentBodyFamilyPostingField;
	bodyBlocks: ResidentBodyBlockArena;
	exactTapes: ResidentExactTapeArena;
	hanRoute: ResidentHanRouteArena;
	fuzzyRescue: ResidentFuzzyRescueSidecar;
	metrics: ResidentBaseMetrics;
}>;
