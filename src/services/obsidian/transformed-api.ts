import { Notice } from "obsidian";

export class MyNotice extends Notice {
	constructor(info: string) {
		super(info + "\n(clever-search)");
	}
}
