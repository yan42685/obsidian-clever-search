// src/utils/view-helper.ts
import { App, MarkdownView, type EditorPosition } from "obsidian";
import { NULL_NUMBER } from "src/globals/constants";
import { ObsidianCommandEnum } from "src/globals/enums";
import { PluginSetting } from "src/globals/plugin-setting";
import {
	FileItem,
	FileSubItem,
	Item,
	LineItem,
	SearchType,
} from "src/globals/search-types";
import { PrivateApi } from "src/services/obsidian/private-api";
import { FileType } from "src/utils/file-util";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import type { SearchModal } from "./search-modal";

@singleton()
export class ViewHelper {
	private readonly app = getInstance(App);
	private readonly privateApi = getInstance(PrivateApi);
	private readonly setting = getInstance(PluginSetting);

	updateSubItemIndex(
		subItems: FileSubItem[],
		currentIndex: number,
		direction: "next" | "prev",
	): number {
		const subItem = subItems[currentIndex];
		const maxIndex = subItems.length - 1;
		this.scrollTo("center", subItem, "smooth");
		if (direction === "next") {
			return currentIndex < maxIndex ? currentIndex + 1 : currentIndex;
		} else {
			return currentIndex > 0 ? currentIndex - 1 : currentIndex;
		}
	}

	async handleConfirmAsync(
		modal: SearchModal,
		searchType: SearchType,
		selectedItem: Item,
		currSubItemIndex: number,
	) {
		modal.close();
		if (selectedItem) {
			if (searchType === SearchType.IN_FILE) {
				const lineItem = selectedItem as LineItem;
				this.jumpInFile(lineItem.line.row, lineItem.line.col);
			} else if (searchType === SearchType.IN_VAULT) {
				const fileItem = selectedItem as FileItem;
				const filetype = fileItem.fileType;
				if (currSubItemIndex !== NULL_NUMBER) {
					const subItem = fileItem.subItems[currSubItemIndex];
					if (filetype === FileType.PLAIN_TEXT) {
						await this.jumpInVaultAsync(
							fileItem.path,
							subItem.row,
							subItem.col,
						);
					} else {
						throw Error("unsupported filetype to jump");
					}
				}
			} else {
				throw Error(`unsupported search type to jump ${searchType}`);
			}
		}
	}

	// for scroll bar
	scrollTo(direction: ScrollLogicalPosition, item: Item | undefined, behavior: ScrollBehavior) {
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
			this.scrollIntoViewForNewTab(row, col);
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

	/**
	 * This function is essential to distinguish from `scrollIntoViewForExistingView`.
	 * Although it does not center the view as precisely as the previous function,
	 * it is necessary because `scrollIntoViewForExistingView` has bugs when applied to new tabs,
	 * which is an inherent issue with Obsidian's API.
	 */
	private scrollIntoViewForNewTab(row: number, col: number) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			view.editor.setCursor({ line: row, ch: col });
			view.editor.scrollIntoView({
				from: { line: row - 10, ch: 0 },
				to: { line: row + 10, ch: 0 },
			});
		}
	}
}
