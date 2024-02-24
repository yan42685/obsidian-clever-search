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
import { SemanticEngine } from "src/services/search/semantic-engine";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";

@singleton()
export class ViewHelper {
	private readonly app = getInstance(App);
	private readonly privateApi = getInstance(PrivateApi);
	private readonly setting = getInstance(OuterSetting);

	updateSubItemIndex(
		subItems: FileSubItem[],
		currSubIndex: number,
		direction: "next" | "prev",
	): number {
		const subItem = subItems[currSubIndex];
		const maxIndex = subItems.length - 1;
		this.scrollTo("center", subItem, "auto");
		if (direction === "next") {
			return currSubIndex < maxIndex ? currSubIndex + 1 : currSubIndex;
		} else {
			return currSubIndex > 0 ? currSubIndex - 1 : currSubIndex;
		}
	}

	async handleConfirmAsync(
		onConfirmExternal: () => void,
		sourcePath: string,
		searchType: SearchType,
		selectedItem: Item,
		currSubItemIndex: number,
	) {
		onConfirmExternal();
		if (selectedItem) {
			if (searchType === SearchType.IN_FILE) {
				const lineItem = selectedItem as LineItem;
				await this.jumpInVaultAsync(
					sourcePath,
					lineItem.line.row,
					lineItem.line.col,
				);
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
				} else {
					// no content text matched, but filenames or folders are matched
					await this.jumpInVaultAsync(fileItem.path, 0, 0);
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
		// wait until the dom states are updated
		setTimeout(() => {
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
		}, 0);
	}

	focusInput() {
		setTimeout(() => {
			const inputElement = document.getElementById("cs-search-input");
			inputElement?.focus();
		}, 0);
	}

	showNoResult(isSemantic: boolean) {
		if (isSemantic) {
			const semanticEngineStatus = getInstance(SemanticEngine).status;
			if (semanticEngineStatus === "ready") {
				return "No matched content";
			} else {
				return `Semantic engine is ${semanticEngineStatus}`;
			}
		} else {
			return "No matched content";
		}
	}

	private async jumpInVaultAsync(path: string, row: number, col: number) {
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
		// if removing the command in this function, we can't focus the editor when switching to an existing view
		this.privateApi.executeCommandById(
			ObsidianCommandEnum.FOCUS_ON_LAST_NOTE,
		);
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cursorPos: EditorPosition = {
			line: row,
			ch: col,
		};

		if (view) {
			// auto-switch to editing mode if it's reading mode in target view
			const tmpViewState = view.getState();
			tmpViewState.mode = "source";
			view.setState(tmpViewState, { history: false });

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

			// this command need to be triggered again if the view mode has been switched to `editing` from `reading`
			this.privateApi.executeCommandById(
				ObsidianCommandEnum.FOCUS_ON_LAST_NOTE,
			);
		} else {
			logger.info("No markdown view to jump");
		}
	}
}
