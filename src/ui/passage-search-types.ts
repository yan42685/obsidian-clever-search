export type PassageSearchHit = {
	id?: string | number;
	title?: string;
	path: string;
	targetPath?: string;
	heading?: string;
	snippet?: string;
	secondaryText?: string;
	badgeText?: string;
	score?: number;
	line?: number;
	column?: number;
};