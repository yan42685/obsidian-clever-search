import { App, type TFile } from "obsidian";
import { THIS_PLUGIN } from "src/globals/constants";
import type CleverSearch from "src/main";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";

/*
 * APIs in this file are not declared in the official obsidian.d.ts but are available in js
 */
@singleton()
export class PrivateApi {
	app = getInstance(App) as any;
	plugin: CleverSearch = getInstance(THIS_PLUGIN);
	getFileBacklinks(file: TFile) {
		// @ts-ignore
		this.app.metadataCache.getBacklinksForFile(file);
	}
	getAppId() {
		// BUG: 最新的api移除了this.app.appId的定义，以后可能会废除这个属性
		// if this api is removed, use the following code to identify a vault:
		// public readonly vaultAbsolutePath = this.obsidianFs.getBasePath().replace(/\\/g, "/") + "/";
		return this.app.appId;
	}

	executeCommandById(commandId: string) {
		this.app.commands.executeCommandById(commandId);
	}

	isNotExcludedPath(path: string) {
		return !(
			this.app.metadataCache.isUserIgnored &&
			this.app.metadataCache.isUserIgnored(path)
		);
	}
}
