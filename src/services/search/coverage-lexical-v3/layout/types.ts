export type ResidentStringArena = Readonly<{
	text: string;
	offsets: Uint32Array;
	lengths: Uint32Array;
	count: number;
}>;

export type ResidentDocTable = Readonly<{
	docCount: number;
	pathStringIds: Uint32Array;
	stableKeyStringIds: Uint32Array;
	basenameStringIds: Uint32Array;
	folderStringIds: Uint32Array;
	generationByDocId: Uint32Array;
	sizeByDocId: Uint32Array;
	identityStartByDocId: Uint32Array;
	identityCountByDocId: Uint32Array;
	routeStartByDocId: Uint32Array;
	routeCountByDocId: Uint32Array;
	headingStartByDocId: Uint32Array;
	headingCountByDocId: Uint32Array;
	bodyBlockStartByDocId: Uint32Array;
	bodyBlockCountByDocId: Uint32Array;
	flagsByDocId: Uint8Array;
}>;

export type ResidentFamilyKind = "latin" | "han" | "mixed" | "other";

export type ResidentFamilyLexicon = Readonly<{
	familyCount: number;
	familyStringIds: Uint32Array;
	firstCodePointByFamilyId: Uint32Array;
	kindCodeByFamilyId: Uint8Array;
	prefixExpandableByFamilyId: Uint8Array;
	sourceMaskByFamilyId: Uint8Array;
}>;

export type ResidentPostingList = Readonly<{
	postingStarts: Uint32Array;
	postingCounts: Uint32Array;
	docIds: Uint32Array;
}>;

export type ResidentBlockPostingList = Readonly<{
	postingStarts: Uint32Array;
	postingCounts: Uint32Array;
	blockIds: Uint32Array;
}>;

export type ResidentMetadataContainerArena = Readonly<{
	identityFamiliesByDoc: Uint32Array;
	routeFamiliesByDoc: Uint32Array;
	headingFamiliesByDoc: Uint32Array;
	identityPostings: ResidentPostingList;
	routePostings: ResidentPostingList;
	headingPostings: ResidentPostingList;
}>;

export type ResidentBodySummaryArena = Readonly<{
	postings: ResidentBlockPostingList;
}>;

export type ResidentBodyBlockArena = Readonly<{
	blockCount: number;
	docIdByBlockId: Uint32Array;
	blockOrdinalByBlockId: Uint32Array;
	exactTapeStartByBlockId: Uint32Array;
	exactTapeCountByBlockId: Uint32Array;
}>;

export type ResidentExactTapeArena = Readonly<{
	familyIds: Uint32Array;
	tokenPositions: Uint32Array;
}>;

export type ResidentHanRouteArena = Readonly<{
	bigramIds: Uint32Array;
	metadataIdentityPostingStarts: Uint32Array;
	metadataIdentityPostingCounts: Uint32Array;
	metadataIdentityDocIds: Uint32Array;
	metadataRoutePostingStarts: Uint32Array;
	metadataRoutePostingCounts: Uint32Array;
	metadataRouteDocIds: Uint32Array;
	metadataHeadingPostingStarts: Uint32Array;
	metadataHeadingPostingCounts: Uint32Array;
	metadataHeadingDocIds: Uint32Array;
	bodyBlockPostingStarts: Uint32Array;
	bodyBlockPostingCounts: Uint32Array;
	bodyBlockIds: Uint32Array;
	identityWitnessStartByDocId: Uint32Array;
	identityWitnessCountByDocId: Uint32Array;
	identityWitnessFamilyIds: Uint32Array;
	routeWitnessStartByDocId: Uint32Array;
	routeWitnessCountByDocId: Uint32Array;
	routeWitnessFamilyIds: Uint32Array;
	headingWitnessStartByDocId: Uint32Array;
	headingWitnessCountByDocId: Uint32Array;
	headingWitnessFamilyIds: Uint32Array;
	bodyWitnessStartByBlockId: Uint32Array;
	bodyWitnessCountByBlockId: Uint32Array;
	bodyWitnessFamilyIds: Uint32Array;
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
