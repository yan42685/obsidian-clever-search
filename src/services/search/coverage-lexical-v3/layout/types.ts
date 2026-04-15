import type {
	ResidentIntegerArray,
	ResidentSectionEncodingDescriptor,
} from "./integer-arrays";

export type ResidentStringArena = Readonly<{
	text: string;
	offsets: ResidentIntegerArray;
	lengths: ResidentIntegerArray;
	count: number;
}>;

export type ResidentDocTable = Readonly<{
	docCount: number;
	pathStringIds: ResidentIntegerArray;
	generationByDocId: ResidentIntegerArray;
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
	routeFamiliesByDoc: ResidentIntegerArray;
	headingFamiliesByDoc: ResidentIntegerArray;
	identityPostings: ResidentPostingList;
	routePostings: ResidentPostingList;
	headingPostings: ResidentPostingList;
}>;

export type ResidentBodySummaryArena = Readonly<{
	postings: ResidentBlockPostingList;
}>;

export type ResidentBodyBlockArena = Readonly<{
	blockCount: number;
	docIdByBlockId: ResidentIntegerArray;
	blockOrdinalByBlockId: ResidentIntegerArray;
	exactTapeStartByBlockId: ResidentIntegerArray;
	exactTapeCountByBlockId: ResidentIntegerArray;
}>;

export type ResidentExactTapeArena = Readonly<{
	familyIds: ResidentIntegerArray;
}>;

export type ResidentHanRouteArena = Readonly<{
	bigramIds: Uint32Array;
	metadataPostingStarts: ResidentIntegerArray;
	metadataDocIds: ResidentIntegerArray;
	bodyBlockPostingStarts: ResidentIntegerArray;
	bodyBlockIds: ResidentIntegerArray;
	identityWitnessStartByDocId: ResidentIntegerArray;
	identityWitnessFamilyIds: ResidentIntegerArray;
	routeWitnessStartByDocId: ResidentIntegerArray;
	routeWitnessFamilyIds: ResidentIntegerArray;
	headingWitnessStartByDocId: ResidentIntegerArray;
	headingWitnessFamilyIds: ResidentIntegerArray;
	bodyWitnessStartByBlockId: ResidentIntegerArray;
	bodyWitnessFamilyIds: ResidentIntegerArray;
}>;

export type ResidentBaseMetrics = Readonly<{
	docArenaBytes: number;
	stringArenaBytes: number;
	familyLexiconBytes: number;
	metadataContainerBytes: number;
	headingBytes: number;
	bodySummaryBytes: number;
	bodyBlockBytes: number;
	exactTapeBytes: number;
	hanRouteBytes: number;
	hanRouteMetadataHanPostingsBytes: number;
	hanRouteBodyHanPostingsBytes: number;
	hanRouteMetadataWitnessBytes: number;
	hanRouteBodyWitnessBytes: number;
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
	bodySummary: ResidentBodySummaryArena;
	bodyBlocks: ResidentBodyBlockArena;
	exactTapes: ResidentExactTapeArena;
	hanRoute: ResidentHanRouteArena;
	metrics: ResidentBaseMetrics;
}>;
