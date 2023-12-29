import type { SearchResult as MiniResult } from "minisearch";
import { FileType, FileUtil } from "src/utils/file-util";
export type MiniSearchResult = MiniResult;

export type IndexedDocument = {
	path: string;
	basename: string;
	folder: string;
	aliases?: string;
	content?: string;
};

export type DocumentFields = Array<keyof IndexedDocument>;

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
	subItems: FileSubItem[]; // for plaintext filetype
	// TODO: impl this
	previewContent: any;  // for non-plaintext filetype
	get fileType(): FileType {
		return FileUtil.getFileType(this.path);
	}
	get basename() {
		return FileUtil.getBasename(this.path);
	}
	get extension() {
		return FileUtil.getExtension(this.path);
	}
	get folderPath() {
		return FileUtil.getFolderPath(this.path);
	}

	constructor(engineType: EngineType, path: string, subItems: FileSubItem[], previewContent: any) {
		super();
		this.engineType = engineType;
		this.path = path;
		this.subItems = subItems;
		this.previewContent = previewContent;
	}
}

export class FileSubItem extends Item {
	text: string;
	originRow: number;  // for precisely jumping to the original file location
	originCol: number;
	constructor(text: string, originRow: number, originCol: number) {
		super();
		this.text = text;
		this.originRow = originRow;
		this.originCol = originCol;
	}
}
