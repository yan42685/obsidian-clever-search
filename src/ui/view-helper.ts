// src/utils/view-helper.ts
import { App, MarkdownView, type EditorPosition } from "obsidian";
import { NULL_NUMBER } from "src/globals/constants";
import { ObsidianCommandEnum } from "src/globals/enums";
import { OuterSetting } from "src/globals/plugin-setting";
import {
	FileItem,
	FileSubItem,
	Item,
	LineItem,
	SearchType,
} from "src/globals/search-types";
import { PrivateApi } from "src/services/obsidian/private-api";
import { ViewType } from "src/services/obsidian/view-registry";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import type { SearchModal } from "./search-modal";

@singleton()
export class ViewHelper {
	private readonly app = getInstance(App);
	private readonly privateApi = getInstance(PrivateApi);
	private readonly setting = getInstance(OuterSetting);

	updateSubItemIndex(
		subItems: FileSubItem[],
		currentIndex: number,
		direction: "next" | "prev",
	): number {
		const subItem = subItems[currentIndex];
		const maxIndex = subItems.length - 1;
		this.scrollTo("center", subItem, "auto");
		if (direction === "next") {
			return currentIndex < maxIndex ? currentIndex + 1 : currentIndex;
		} else {
			return currentIndex > 0 ? currentIndex - 1 : currentIndex;
		}
	}

	async handleConfirmAsync(
		onConfirmExternal: () => void,
		searchType: SearchType,
		selectedItem: Item,
		currSubItemIndex: number,
	) {
		onConfirmExternal();
		if (selectedItem) {
			if (searchType === SearchType.IN_FILE) {
				const lineItem = selectedItem as LineItem;
				this.jumpInFile(lineItem.line.row, lineItem.line.col);
			} else if (searchType === SearchType.IN_VAULT) {
				const fileItem = selectedItem as FileItem;
				const viewType = fileItem.viewType;
				if (currSubItemIndex !== NULL_NUMBER) {
					const subItem = fileItem.subItems[currSubItemIndex];
					if (viewType === ViewType.MARKDOWN) {
						// TODO: reuse tab for html
						// if (fileItem.extension === "html") {
						// 	const absolutePath =
						// 		this.privateApi.getAbsolutePath(fileItem.path);
						// 	const matchedText = subItem.text.replace(
						// 		/<mark>|<\/mark>/g,
						// 		"",
						// 	);
						// 	// logger.info(matchedText);
						// 	window.open(
						// 		`file:///${absolutePath}#:~:text=${matchedText}`,
						// 		"",
						// 	);
						// } else {
						await this.jumpInVaultAsync(
							fileItem.path,
							subItem.row,
							subItem.col,
						);
						// }
					} else {
						throw Error("unsupported viewType to jump");
					}
				}
			} else {
				throw Error(`unsupported search type to jump ${searchType}`);
			}
		}
	}

	// for scroll bar
	scrollTo(
		direction: ScrollLogicalPosition,
		item: Item | undefined,
		behavior: ScrollBehavior,
	) {
		if (item && item.element) {
			item.element.scrollIntoView({
				behavior: behavior,
				// behavior: "auto",
				// behavior: "instant",
				//@ts-ignore  the type definition mistakenly spell `block` as `lock`, so there will be a warning
				block: direction, // vertical
				// inline: "center"    // horizontal
			});
		}
	}

	private jumpInFile(row: number, col: number) {
		this.scrollIntoViewForExistingView(row, col);
	}

	private async jumpInVaultAsync(path: string, row: number, col: number) {
		let alreadyOpen = false;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (
				// leaf.view instanceof MarkdownView &&
				leaf.getViewState().state?.file === path
			) {
				this.app.workspace.setActiveLeaf(leaf, { focus: true });
				alreadyOpen = true;
			}
		});
		if (alreadyOpen) {
			this.scrollIntoViewForExistingView(row, col);
		} else {
			await this.app.workspace.openLinkText(
				path,
				"",
				this.setting.ui.openInNewPane,
			);
			// this.scrollIntoViewForExistingView(row, col);
			this.app.workspace.onLayoutReady(() =>
				this.scrollIntoViewForExistingView(row, col),
			);
		}
	}

	private scrollIntoViewForExistingView(row: number, col: number) {
		// WARN: this command inside this function will cause a warning in the console:
		// [Violation] Forced reflow while executing JavaScript took 55ms
		// if executing it in the `jumpInFile` before calling this function, this warning won't appear,
		// but if removing the command in this function, we can't focus the editor when switching to an existing view
		this.privateApi.executeCommandById(
			ObsidianCommandEnum.FOCUS_ON_LAST_NOTE,
		);
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cursorPos: EditorPosition = {
			line: row,
			ch: col,
		};
		if (view) {
			view.editor.setCursor(cursorPos);
			view.editor.scrollIntoView(
				{
					from: cursorPos,
					to: cursorPos,
				},
				true,
			);
			// It doesn't take effect , use ObsidianCommandEnum.FOCUS_ON_LAST_NOTE instead
			// 	view.editor.focus();
		} else {
			logger.info("No view to jump");
		}
	}
}
