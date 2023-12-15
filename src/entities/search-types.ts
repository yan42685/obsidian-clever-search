import { Component } from "obsidian";

export enum ResultType{
	IN_FILE, IN_VAULT, SEMANTIC
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
	type: ResultType;
	currPath: string;
	items: Item[];
	constructor(type: ResultType, currPath: string, items: Item[]) {
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
