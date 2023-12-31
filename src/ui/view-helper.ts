// src/utils/view-helper.ts
import { App, MarkdownView, type EditorPosition } from "obsidian";
import { ObsidianCommandEnum } from "src/globals/enums";
import { PluginSetting } from "src/globals/plugin-setting";
import type { LocatableFile } from "src/globals/search-types";
import { PrivateApi } from "src/services/obsidian/private-api";
import { FileType } from "src/utils/file-util";
import { logger } from "src/utils/logger";
import { TO_BE_IMPL, getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";

@singleton()
export class ViewHelper {
	private readonly app = getInstance(App);
	private readonly privateApi = getInstance(PrivateApi);
	private readonly setting = getInstance(PluginSetting);

	jumpInFile(row: number, col: number) {
		this.privateApi.executeCommandById(ObsidianCommandEnum.FOCUS_ON_LAST_NOTE);
		this.scrollInView(row, col);
	}

	async jumpInVaultAsync(file: LocatableFile) {
		if (file.type === FileType.PLAIN_TEXT) {
            await this.setViewAsync(file.path);
			this.scrollInView(file.row, file.col);
		} else {
			throw Error(TO_BE_IMPL);
		}
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
        if(!alreadyOpen) {
			await this.app.workspace.openLinkText(path, "", this.setting.openInNewPane);
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
