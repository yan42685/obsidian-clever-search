import type { SearchResult as MiniResult } from "minisearch";
import { MyLib } from "src/utils/my-lib";
export type MiniSearchResult = MiniResult;

export type IndexedDocument = {
	path: string;
	basename: string;
	aliases?: string;
	content?: string;
};

export type DocumentWeight = {
    [K in keyof IndexedDocument]?: number;
};

export type DocumentRef = {
	path: string;
	lexicalMtime: number;
	embeddingMtime: number;
};

export type InFileDataSource = {
	lines: Line[];
	path: string;
};

export class Line {
	text: string;
	row: number;
	constructor(text: string, row: number) {
		this.text = text;
		this.row = row;
	}
}
export class MatchedLine extends Line {
	col: number;
	constructor(text: string, row: number, col: number) {
		super(text, row);
		this.col = col;
	}
}

export type MatchedFile  = {
	path: string,
	matchedTerms: string[]
}

export class SearchResult {
	type: SearchType;
	currPath: string;
	items: Item[];
	constructor(type: SearchType, currPath: string, items: Item[]) {
		this.type = type;
		this.currPath = currPath;
		this.items = items;
	}
}


export enum SearchType {
	NONE,
	IN_FILE,
	IN_VAULT,
}

export enum ItemType {
	LEXICAL,
	SEMANTIC,
}

export abstract class Item {
	element?: HTMLElement;
}

export class InFileItem extends Item {
	line: MatchedLine;
	context: string;

	constructor(line: MatchedLine, context: string) {
		super();
		this.line = line;
		this.context = context;
	}
}

export class InVaultItem extends Item {
	type: ItemType;
	path: string;
	inFileItems?: InFileItem[];
	get basename() {
		return MyLib.getBasename(this.path);
	}
	get extension() {
		return MyLib.getExtension(this.path);
	}

	constructor(type: ItemType, path: string, inFileItems?: InFileItem[]) {
		super();
		this.type = type;
		this.path = path;
		this.inFileItems = inFileItems;
	}
}
