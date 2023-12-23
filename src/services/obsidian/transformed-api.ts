import { Notice } from "obsidian";


export class MyNotice extends Notice {
	constructor(text: string, duration = 0) {
		super(text + "\n(clever-search)", duration);
	}
}

class MyObsidianApi {
}

export const myObApi = new MyObsidianApi();
