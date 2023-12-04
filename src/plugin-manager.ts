import type { FileSystemAdapter } from "obsidian";
import { inject, singleton } from "tsyringe";
import CleverSearch from "./main";
import { pathUtils } from "./utils/my-lib";

@singleton()
export class PluginManager {
	private readonly plugin: CleverSearch;
	private readonly fs: FileSystemAdapter;
	public readonly vaultPath: string;
	// 存放索引的表
	public readonly indexName: string;
	public watchedPaths: string[] = [];

	
	constructor(@inject("CleverSearch") plugin: CleverSearch) {
		this.plugin = plugin;
		this.fs = plugin.app.vault.adapter as FileSystemAdapter;
		this.vaultPath = this.fs.getBasePath().replace(/\\/g, "/") + "/";
		this.indexName = "obsidian_vault_" + this.plugin.app.vault.getName().toLowerCase();
		this.updateWatchedPaths();
	}

	updateWatchedPaths() {
		// TODO: configurable
		const whitelistPaths = ["abc"];
		const blackListPaths = [".obsidian/"];
		const relativePaths = ["abc/"];
		this.watchedPaths = relativePaths.map(
			(relativePath) =>
				pathUtils
					.join(this.vaultPath, relativePath)
					.replace(/\\/g, "/")
		);
	}
}
