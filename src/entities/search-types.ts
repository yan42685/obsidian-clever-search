export enum ResultType {
	IN_FILE,
	IN_VAULT,
	SEMANTIC,
}
export class Line {
	text: string;
	row: number;
	constructor(text: string, row: number) {
		this.text = text;
		this.row = row;
	}
}
export class MatchedLine extends Line{
	col: number;
	constructor(text: string, row: number, col: number) {
		super(text, row);
		this.col = col;
	}
}
export class SearchResult {
	type: ResultType;
	title: string;
	matchedLine?: MatchedLine;
	context: string;

	constructor(type: ResultType, title = "", matchedLine = undefined, context = "") {
		this.type = type;
		this.title = title;
		this.matchedLine = matchedLine;
		this.context = context;
	}
}

// 示例
// const a = new SearchResult(ResultType.IN_FILE, "test title", undefined, "the context");
