import { App, Notice, Plugin, Vault } from "obsidian";
import { THIS_PLUGIN } from "src/globals/constants";
import { container } from "tsyringe";


export class MyNotice extends Notice {
	constructor(text: string, duration = 0) {
		super(text + "\n(clever-search)", duration);
	}
}

class MyObsidianApi {
}

export const myObApi = new MyObsidianApi();
