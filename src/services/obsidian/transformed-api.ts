import { Notice } from "obsidian";
import { throttle } from "throttle-debounce";


export class MyNotice extends Notice {
	constructor(text: string, duration?: number) {
		super(text + "\n(clever-search)", duration);
	}
}

class MyObsidianApi {
}

export const myObApi = new MyObsidianApi();
