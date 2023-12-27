import type { SearchResult as MiniResult } from "minisearch";
import { FileRetriever } from "src/services/search/data-provider";
import { MyLib, getInstance } from "src/utils/my-lib";
export type MiniSearchResult = MiniResult;

export type IndexedDocument = {
	path: string;
	basename: string;
	folder: string;
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
	currPath: string;
	items: Item[];
	constructor(currPath: string, items: Item[]) {
		this.currPath = currPath;
		this.items = items;
	}
}


export enum SearchType {
	NONE,
	IN_FILE,
	IN_VAULT,
}

export enum EngineType {
	LEXICAL,
	SEMANTIC,
}

export abstract class Item {
	element?: HTMLElement;
}

export class LineItem extends Item {
	line: MatchedLine;
	context: string;

	constructor(line: MatchedLine, context: string) {
		super();
		this.line = line;
		this.context = context;
	}
}

export class FileItem extends Item {
	engineType: EngineType;
	path: string;
	subItems: string[];
	get fileType(): FileType {
		return getInstance(FileRetriever).getFileType(this.path);
	}
	get basename() {
		return MyLib.getBasename(this.path);
	}
	get extension() {
		return MyLib.getExtension(this.path);
	}
	get folderPath() {
		return MyLib.getFolderPath(this.path);
	}

	constructor(engineType: EngineType, path: string, subItems: string[]) {
		super();
		this.engineType = engineType;
		this.path = path;
		this.subItems = subItems;
	}
}

export enum FileType {
	PLAIN_TEXT, IMAGE, UNSUPPORTED
}