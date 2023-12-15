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
	path: string;
	count: number;
	constructor(path: string, count: number) {
		this.path = path;
		this.count = count;
	}
}
export class InFileResult extends SearchResult {
	items: InFileItem[];

	constructor(path: string, items: InFileItem[]) {
		super(path, items.length);
		this.items = items;
	}
}

export class InFileItem {
	line: MatchedLine;
	context: string;

	constructor(line: MatchedLine, context: string) {
		this.line = line;
		this.context = context;
	}
}
