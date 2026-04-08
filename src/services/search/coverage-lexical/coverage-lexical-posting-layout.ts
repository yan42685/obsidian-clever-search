export const enum CoverageLexicalSnapshotSectionKind {
	Metadata = 1,
	StringPool = 2,
	Lexicon = 3,
	BodyTokenLexicon = 4,
	Documents = 5,
	BodyPostings = 10,
	BodyCharPostings = 11,
	BodyHanSegmentPostings = 12,
	MetadataAliasCharPostings = 14,
	MetadataAliasHanSegmentPostings = 15,
	MetadataAliasPhrasePostings = 16,
	MetadataAliasPostings = 17,
	MetadataBasenameCharPostings = 18,
	MetadataBasenameHanSegmentPostings = 19,
	MetadataBasenamePhrasePostings = 20,
	MetadataBasenamePostings = 21,
	MetadataFolderCharPostings = 22,
	MetadataFolderHanSegmentPostings = 23,
	MetadataFolderPhrasePostings = 24,
	MetadataFolderPostings = 25,
	MetadataHeadingCharPostings = 26,
	MetadataHeadingHanSegmentPostings = 27,
	MetadataHeadingPhrasePostings = 28,
	MetadataHeadingPostings = 29,
	MetadataPostings = 30,
	MetadataTagCharPostings = 31,
	MetadataTagFullPostings = 32,
	MetadataTagPhrasePostings = 33,
	MetadataTagPostings = 34,
}

export type CoverageLexicalPostingOwnership = "plain" | "packed";

export type CoverageLexicalSnapshotPostingKey =
	| "bodyPostings"
	| "bodyCharPostings"
	| "bodyHanSegmentPostings"
	| "metadataAliasCharPostings"
	| "metadataAliasHanSegmentPostings"
	| "metadataAliasPhrasePostings"
	| "metadataAliasPostings"
	| "metadataBasenameCharPostings"
	| "metadataBasenameHanSegmentPostings"
	| "metadataBasenamePhrasePostings"
	| "metadataBasenamePostings"
	| "metadataFolderCharPostings"
	| "metadataFolderHanSegmentPostings"
	| "metadataFolderPhrasePostings"
	| "metadataFolderPostings"
	| "metadataHeadingCharPostings"
	| "metadataHeadingHanSegmentPostings"
	| "metadataHeadingPhrasePostings"
	| "metadataHeadingPostings"
	| "metadataPostings"
	| "metadataTagCharPostings"
	| "metadataTagFullPostings"
	| "metadataTagPhrasePostings"
	| "metadataTagPostings";

export type CoverageLexicalLivePostingKey =
	| "bodyPostings"
	| "metadataAliasCharPostings"
	| "metadataAliasPostings"
	| "metadataBasenameCharPostings"
	| "metadataBasenamePostings"
	| "metadataFolderCharPostings"
	| "metadataFolderPostings"
	| "metadataHeadingPostings"
	| "metadataTagCharPostings"
	| "metadataTagFullPostings"
	| "metadataTagPostings";

type CoverageLexicalPostingDescriptor = {
	key: CoverageLexicalSnapshotPostingKey;
	sectionKind: CoverageLexicalSnapshotSectionKind;
	ownership: CoverageLexicalPostingOwnership;
	live: boolean;
	source?: string;
	breakdownKey?: string;
	contributesToLexicon?: boolean;
};

export type CoverageLexicalLivePostingDescriptor = {
	key: CoverageLexicalLivePostingKey;
	sectionKind: CoverageLexicalSnapshotSectionKind;
	ownership: CoverageLexicalPostingOwnership;
	live: true;
	source: string;
	breakdownKey: string;
	contributesToLexicon: boolean;
};

export const COVERAGE_LEXICAL_POSTING_DESCRIPTORS = [
	{
		key: "bodyPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.BodyPostings,
		ownership: "packed",
		live: true,
		source: "postings.body.term",
		breakdownKey: "body",
		contributesToLexicon: true,
	},
	{
		key: "bodyCharPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.BodyCharPostings,
		ownership: "packed",
		live: false,
	},
	{
		key: "bodyHanSegmentPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.BodyHanSegmentPostings,
		ownership: "plain",
		live: false,
	},
	{
		key: "metadataAliasCharPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataAliasCharPostings,
		ownership: "plain",
		live: true,
		source: "postings.metadataAliasChar.term",
		breakdownKey: "metadataAliasChar",
	},
	{
		key: "metadataAliasHanSegmentPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataAliasHanSegmentPostings,
		ownership: "plain",
		live: false,
	},
	{
		key: "metadataAliasPhrasePostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataAliasPhrasePostings,
		ownership: "packed",
		live: false,
	},
	{
		key: "metadataAliasPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataAliasPostings,
		ownership: "packed",
		live: true,
		source: "postings.metadataAlias.term",
		breakdownKey: "metadataAlias",
		contributesToLexicon: true,
	},
	{
		key: "metadataBasenameCharPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataBasenameCharPostings,
		ownership: "plain",
		live: true,
		source: "postings.metadataBasenameChar.term",
		breakdownKey: "metadataBasenameChar",
	},
	{
		key: "metadataBasenameHanSegmentPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataBasenameHanSegmentPostings,
		ownership: "plain",
		live: false,
	},
	{
		key: "metadataBasenamePhrasePostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataBasenamePhrasePostings,
		ownership: "packed",
		live: false,
	},
	{
		key: "metadataBasenamePostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataBasenamePostings,
		ownership: "packed",
		live: true,
		source: "postings.metadataBasename.term",
		breakdownKey: "metadataBasename",
		contributesToLexicon: true,
	},
	{
		key: "metadataFolderCharPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataFolderCharPostings,
		ownership: "plain",
		live: true,
		source: "postings.metadataFolderChar.term",
		breakdownKey: "metadataFolderChar",
	},
	{
		key: "metadataFolderHanSegmentPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataFolderHanSegmentPostings,
		ownership: "plain",
		live: false,
	},
	{
		key: "metadataFolderPhrasePostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataFolderPhrasePostings,
		ownership: "packed",
		live: false,
	},
	{
		key: "metadataFolderPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataFolderPostings,
		ownership: "packed",
		live: true,
		source: "postings.metadataFolder.term",
		breakdownKey: "metadataFolder",
		contributesToLexicon: true,
	},
	{
		key: "metadataHeadingCharPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataHeadingCharPostings,
		ownership: "plain",
		live: false,
	},
	{
		key: "metadataHeadingHanSegmentPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataHeadingHanSegmentPostings,
		ownership: "plain",
		live: false,
	},
	{
		key: "metadataHeadingPhrasePostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataHeadingPhrasePostings,
		ownership: "packed",
		live: false,
	},
	{
		key: "metadataHeadingPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataHeadingPostings,
		ownership: "packed",
		live: true,
		source: "postings.metadataHeading.term",
		breakdownKey: "metadataHeading",
		contributesToLexicon: true,
	},
	{
		key: "metadataPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataPostings,
		ownership: "plain",
		live: false,
	},
	{
		key: "metadataTagCharPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataTagCharPostings,
		ownership: "plain",
		live: true,
		source: "postings.metadataTagChar.term",
		breakdownKey: "metadataTagChar",
	},
	{
		key: "metadataTagFullPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataTagFullPostings,
		ownership: "packed",
		live: true,
		source: "postings.metadataTagFull.term",
		breakdownKey: "metadataTagFull",
	},
	{
		key: "metadataTagPhrasePostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataTagPhrasePostings,
		ownership: "packed",
		live: false,
	},
	{
		key: "metadataTagPostings",
		sectionKind: CoverageLexicalSnapshotSectionKind.MetadataTagPostings,
		ownership: "packed",
		live: true,
		source: "postings.metadataTag.term",
		breakdownKey: "metadataTag",
		contributesToLexicon: true,
	},
] as const satisfies readonly CoverageLexicalPostingDescriptor[];

export const COVERAGE_LEXICAL_LIVE_POSTING_DESCRIPTORS =
	COVERAGE_LEXICAL_POSTING_DESCRIPTORS.filter(
		(descriptor) => descriptor.live,
	) as unknown as readonly CoverageLexicalLivePostingDescriptor[];

export const COVERAGE_LEXICAL_LIVE_POSTING_DESCRIPTOR_BY_KEY =
	new Map<CoverageLexicalLivePostingKey, CoverageLexicalLivePostingDescriptor>(
		COVERAGE_LEXICAL_LIVE_POSTING_DESCRIPTORS.map((descriptor) => [
			descriptor.key,
			descriptor,
		] as const),
	);
