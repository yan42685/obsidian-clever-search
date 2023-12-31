// src/utils/view-helper.ts
import { App, MarkdownView, type EditorPosition } from "obsidian";
import { NULL_NUMBER } from "src/globals/constants";
import { ObsidianCommandEnum } from "src/globals/enums";
import { PluginSetting } from "src/globals/plugin-setting";
import {
	FileItem,
	Item,
	LineItem,
	SearchType
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
		currentIndex: number,
		maxIndex: number,
		direction: "next" | "prev",
	): number {
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
							subItem.originRow,
							subItem.originCol,
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

	private jumpInFile(row: number, col: number) {
		this.privateApi.executeCommandById(
			ObsidianCommandEnum.FOCUS_ON_LAST_NOTE,
		);
		this.scrollInView(row, col);
	}

	private async jumpInVaultAsync(path: string, row: number, col: number) {
		await this.setViewAsync(path);
		this.scrollInView(row, col);
	}

	private async setViewAsync(path: string) {
		let alreadyOpen = false;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (
				leaf.view instanceof MarkdownView &&
				leaf.getViewState().state?.file === path
			) {
				this.app.workspace.setActiveLeaf(leaf, { focus: true });
				alreadyOpen = true;
			}
		});
		if (!alreadyOpen) {
			await this.app.workspace.openLinkText(
				path,
				"",
				this.setting.openInNewPane,
			);
		}
	}

	private scrollInView(row: number, col: number) {
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
		} else {
			logger.info("No view to jump");
		}
	}
}
