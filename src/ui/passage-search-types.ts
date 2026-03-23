export type PassageSearchHit = {
	id?: string | number;
	path: string;
	title?: string;
	heading?: string;
	snippet: string;
	score?: number;
	line?: number;
	column?: number;
};
