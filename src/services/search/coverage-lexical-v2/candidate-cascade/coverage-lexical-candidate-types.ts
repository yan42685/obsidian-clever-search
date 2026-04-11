export type CoverageLexicalV2CandidateCascadePostingField =
	| "basename"
	| "aliases"
	| "headings"
	| "folder"
	| "tag"
	| "body";

export type CoverageLexicalV2CandidateCascadeDocumentRecord = {
	path: string;
	stableDeterministicKey?: string;
	basenameText: string;
	aliasesText: string;
	headingsText: string;
};

export type CoverageLexicalV2CandidateCascadeMetadataVerificationTexts = {
	basenameText: string;
	aliasesText: string;
	headingsText: string;
	folderText: string;
	tagsText: string;
};

export type CoverageLexicalV2CandidateCascadeStorageReader = {
	getDocumentRecord(docId: number): CoverageLexicalV2CandidateCascadeDocumentRecord | null;
	getBodyHanSegmentDocIds(): readonly number[];
	getPostingMatches(
		field: CoverageLexicalV2CandidateCascadePostingField,
		term: string,
	): readonly number[] | Uint32Array | undefined;
	getMetadataHanBigramPostingMatches(
		field: CoverageLexicalV2CandidateCascadePostingField,
		bigram: string,
	): readonly number[] | Uint32Array | undefined;
	getBodyHanSegments(docId: number): readonly string[] | undefined;
	getMetadataVerificationTexts(
		docId: number,
	): CoverageLexicalV2CandidateCascadeMetadataVerificationTexts | null;
	getSortedLexicon(): readonly string[];
	getBodyTokenSequence(docId: number): readonly string[] | undefined;
	prefetchBodyTokenSequences(docIds: readonly number[]): Promise<void>;
	tokenizeText(text: string): readonly string[];
};
