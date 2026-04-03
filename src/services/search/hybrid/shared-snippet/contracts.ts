export type HybridSharedSnippetPayload = {
	snippetText: string;
	snippetHtml: string;
	highlightRanges: Array<{ start: number; end: number }>;
	bodyHighlightRanges: Array<{ start: number; end: number }>;
	coreStart: number;
	coreEnd: number;
	displayStart: number;
	displayEnd: number;
	bodyStart: number;
	bodyEnd: number;
	anchorOffset: number;
	headerText: string;
	bodyText: string;
};
