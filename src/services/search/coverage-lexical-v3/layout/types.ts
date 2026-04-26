import type {
	ResidentIntegerArray,
	ResidentSectionEncodingDescriptor,
} from "./integer-arrays";
import type { ResidentBlockPositionLane } from "./position-lanes";
import type { ResidentShardDescriptor } from "../shards";

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
	liveDocSlotByDocId: ResidentIntegerArray;
	docIdByLiveDocSlot: ResidentIntegerArray;
	pathStringIds: ResidentIntegerArray;
	generationByDocId: Float64Array;
	identityStartByDocId: ResidentIntegerArray;
	identityCountByDocId: ResidentIntegerArray;
	routeStartByDocId: ResidentIntegerArray;
	routeCountByDocId: ResidentIntegerArray;
	headingStartByDocId: ResidentIntegerArray;
	headingCountByDocId: ResidentIntegerArray;
	bodyBlockStartByDocId: ResidentIntegerArray;
	bodyBlockCountByDocId: ResidentIntegerArray;
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
	familySupportShardLocalFamilySlots: ResidentIntegerArray;
	familySupportMaskByEntry: Uint8Array;
}>;

export type ResidentExactTapeArena = Readonly<{
	familyIds: ResidentIntegerArray;
}> &
	ResidentBlockPositionLane;

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

export type ResidentFuzzyRescueIndex = Readonly<{
	candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey: ReadonlyMap<
		string,
		Uint32Array
	>;
	indexedMetadataFamilyCount: number;
	fuzzyLookupKeyCount: number;
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
	identityWitnessTextIds: ResidentIntegerArray;
	identityWitnessSourceMaskByDocEntry: Uint8Array;
	routeWitnessStartByDocId: ResidentIntegerArray;
	routeWitnessTextIds: ResidentIntegerArray;
	routeWitnessSourceMaskByDocEntry: Uint8Array;
	headingWitnessStartByDocId: ResidentIntegerArray;
	headingWitnessTextIds: ResidentIntegerArray;
	bodyWitnessOccurrenceStartByBlockId: ResidentIntegerArray;
	bodyWitnessOccurrenceTextIds: ResidentIntegerArray;
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
	shardReadiness: ResidentShardReadinessSummary;
	indexedSurfaceUtf8Bytes: number;
	rawMarkdownUtf8Bytes: number;
	"residentBytes / indexedSurfaceUtf8Bytes": number;
	"residentBytes / rawMarkdownUtf8Bytes": number;
}>;

export type ResidentShard = Readonly<{
	shardId: string;
	generation: number;
	base: ResidentBase;
}>;

export type ResidentIndexView = Readonly<{
	version: 1;
	shards: readonly ResidentShard[];
	shardRegistry?: readonly ResidentShardDescriptor[];
}>;

export type ResidentIndexViewSummary = Readonly<{
	shardCount: number;
	documentCount: number;
	familyCount: number;
	blockCount: number;
	residentBytes: number;
	largestShardBytes: number;
	averageShardBytes: number;
	shards: readonly ResidentShardSummary[];
}>;

export type ResidentShardSummary = Readonly<{
	shardId: string;
	generation: number;
	documentCount: number;
	familyCount: number;
	blockCount: number;
	residentBytes: number;
	shardReadiness: ResidentShardReadinessSummary;
}>;

export type ResidentShardReadinessSummary = Readonly<{
	familyLexiconIdentitySlots: boolean;
	familyPostingUsesShardLocalSlots: boolean;
	docTableDuplicatedLiveSlotBytes: number;
	hanBigramPosting: ResidentAdaptivePostingReadinessSummary;
	familyPosting: ResidentAdaptivePostingReadinessSummary;
}>;

export type ResidentAdaptivePostingReadinessSummary = Readonly<{
	termCount: number;
	valueCount: number;
	singletonCount: number;
	pairCount: number;
	smallCount: number;
	deltaCount: number;
	maxTermId: number;
	maxValueId: number;
	termLaneBytes: number;
	valueLaneBytes: number;
	termLaneWidth: string;
	valueLaneWidth: string;
	termGapCompression: ResidentTermGapCompressionSummary;
}>;

export type ResidentTermGapCompressionSummary = Readonly<{
	rawBytes: number;
	estimatedBytes: number;
	estimatedSavingsBytes: number;
	maxGap: number;
	p95Gap: number;
	u8Count: number;
	u16Count: number;
	u32Count: number;
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
	fuzzyRescue: ResidentFuzzyRescueIndex;
	metrics: ResidentBaseMetrics;
}>;
