import CleverSearch from "src/main";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";

@singleton()
export class AuxiliaryService {
	private privacyModeEnabled = false;
	private plugin: CleverSearch = getInstance(CleverSearch);

	togglePrivacyMode() {
		this.privacyModeEnabled = !this.privacyModeEnabled;
		if (this.privacyModeEnabled) {
			document.body.classList.add("cs-privacy-blur");
		} else {
			document.body.classList.remove("cs-privacy-blur");
		}
	}

	init() {
		this.watchSelectionAndAutoCopy();
	}

	private watchSelectionAndAutoCopy() {
		this.plugin.registerDomEvent(
			document,
			"mousedown",
			(event: MouseEvent) => {
				const classesToCheck = [
					"cs-modal",
					"cs-floating-window-container",
				];
				if (isEventTargetInClass(event, classesToCheck)) {
					document.addEventListener(
						"mouseup",
						() => {
							copySelectedText();
						},
						{ once: true },
					);
				}
			},
		);
	}
}

function isEventTargetInClass(event: MouseEvent, classes: string[]): boolean {
	let element: HTMLElement | null = event.target as HTMLElement;
	while (element) {
		if (
			classes.some((className) => element?.classList.contains(className))
		) {
			return true;
		}
		element = element.parentElement;
	}
	return false;
}

function copySelectedText(): void {
	const selection = window.getSelection();
	if (selection && selection.rangeCount > 0) {
		const range = selection.getRangeAt(0);
		const selectedText = range.toString();
		if (selectedText) {
			navigator.clipboard
				.writeText(selectedText)
				.then(() => logger.debug(`selection copied: ${selectedText}`));
		}
	}
}
