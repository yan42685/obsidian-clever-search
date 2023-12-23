import type { SearchResult as MiniResult } from "minisearch";
import { MyLib } from "src/utils/my-lib";
export type MiniSearchResult = MiniResult;

export type IndexedDocument = {
	path: string;
	basename: string;
	aliases: string;
	content: string;
};

export type DocumentRef = {
	path: string;
	mtime: number;
};

export type InFileDataSource = {
	lines: Line[];
	path: string;
};

export enum SearchType {
	NONE,
	IN_FILE,
	VAULT,
	VAULT_LEXICAL,
	VAULT_SEMANTIC,
}
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

export class Item {
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
	type: SearchType;
	path: string;
	inFileItems?: InFileItem[];
	get basename() {
		return MyLib.getBasename(this.path);
	}
	get extension() {
		return MyLib.getExtension(this.path);
	}

	constructor(type: SearchType, path: string, inFileItems?: InFileItem[]) {
		super();
		this.type = type;
		this.path = path;
		this.inFileItems = inFileItems;
	}
}