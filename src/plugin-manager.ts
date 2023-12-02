import type { FileSystemAdapter } from "obsidian";
import { inject, singleton } from "tsyringe";
import CleverSearch from "./main";
import { pathUtils } from "./my-lib";

@singleton()
export class PluginManager {
	private readonly plugin: CleverSearch;
	private readonly fs: FileSystemAdapter;
	private readonly vaultPath: string;
	private watchedPaths: string[] = [];

	
	constructor(@inject("CleverSearch") plugin: CleverSearch) {
		this.plugin = plugin;
		this.fs = plugin.app.vault.adapter as FileSystemAdapter;
		this.vaultPath = this.fs.getBasePath().replace(/\\/g, "/") + "/";
		this.updateWatchedPaths();
	}

	getWatchedPaths() {
		return this.watchedPaths;
	}
	// 存放索引的表
	getIndexName() {
		return (
			"obsidian_vault_" + this.plugin.app.vault.getName().toLowerCase()
		);
	}

	updateWatchedPaths() {
		// TODO: configurable
		const whitelistPaths = ["abc"];
		const blackListPaths = [".obsidian/"];
		const paths = ["abc/"];
		this.watchedPaths = paths.map(
			(relativePath) =>
				pathUtils
					.join(this.vaultPath, relativePath)
					.replace(/\\/g, "/") + "**/*.md"
		);
	}
}
