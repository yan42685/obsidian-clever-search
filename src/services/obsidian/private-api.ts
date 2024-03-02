import { App, FileSystemAdapter, type TFile } from "obsidian";
import { THIS_PLUGIN } from "src/globals/constants";
import type CleverSearch from "src/main";
import { pathUtil } from "src/utils/file-util";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";

/*
 * APIs in this file are not declared in the official obsidian.d.ts but are available in js
 */
@singleton()
export class PrivateApi {
	private app = getInstance(App) as any;
	private plugin: CleverSearch = getInstance(THIS_PLUGIN);
	public obsidianFs: FileSystemAdapter = this.app.vault.adapter;


	getVaultAbsolutePath(): string {
		return this.obsidianFs.getBasePath().replace(/\\/g, "/") + "/";
	}
	getAbsolutePath(relativePath: string) {
		return pathUtil.join(this.getVaultAbsolutePath(), relativePath) ;
	}
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

	isNotObsidianExcludedPath(path: string) {
		return !(
			this.app.metadataCache.isUserIgnored &&
			this.app.metadataCache.isUserIgnored(path)
		);
	}
}
