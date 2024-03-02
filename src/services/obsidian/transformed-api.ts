import { AbstractInputSuggest, App, Notice } from "obsidian";
import { getInstance } from "src/utils/my-lib";

export class MyNotice extends Notice {
	constructor(text: string, duration = 0) {
		super(text + "\n(clever-search)", duration);
	}
}

export class CommonSuggester extends AbstractInputSuggest<string> {
	content: Set<string>;

	constructor(
		private inputEl: HTMLInputElement,
		content: Set<string>,
		private onSelectCb: (value: string) => void,
	) {
		super(getInstance(App), inputEl);
		this.content = content;
	}

	getSuggestions(inputStr: string): string[] {
		return [...this.content].filter((content) =>
			content.toLowerCase().contains(inputStr.toLowerCase()),
		);
	}

	renderSuggestion(content: string, el: HTMLElement): void {
		el.setText(content);
	}

	selectSuggestion(content: string, evt: MouseEvent | KeyboardEvent): void {
		this.onSelectCb(content);
		this.inputEl.value = "";
		this.close();
	}
}

class MyObsidianApi {}

export const myObApi = new MyObsidianApi();
