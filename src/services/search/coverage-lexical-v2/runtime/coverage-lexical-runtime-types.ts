export type CoverageLexicalV2RuntimePostingField =
	| "basename"
	| "aliases"
	| "headings"
	| "folder"
	| "tag"
	| "body";

export type CoverageLexicalV2RuntimeDocumentRecord = {
	path: string;
	stableDeterministicKey?: string;
	basenameText: string;
	aliasesText: string;
	headingsText: string;
};

export type CoverageLexicalV2RuntimeStorageReader = {
	getDocumentRecord(docId: number): CoverageLexicalV2RuntimeDocumentRecord | null;
	getPostingMatches(
		field: CoverageLexicalV2RuntimePostingField,
		term: string,
	): readonly number[] | Uint32Array | undefined;
	getSortedLexicon(): readonly string[];
	getBodyTokenSequence(docId: number): readonly string[] | undefined;
	prefetchBodyTokenSequences(docIds: readonly number[]): Promise<void>;
	tokenizeText(text: string): readonly string[];
};
