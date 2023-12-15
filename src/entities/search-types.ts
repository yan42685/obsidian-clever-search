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
export class InFileResult {
	path: string;
	items: InFileItem[];

	constructor(title: string, items: InFileItem[]) {
		this.path = title;
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
