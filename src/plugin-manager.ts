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

	// 由于plugin不能让框架自己new，而是要注册this依赖，所以这里需要在CleverSearch手动注册this对象
	// 然后在这里手动注册依赖，并且由于我不了解的原因，不能将CleverSearch这个类作为key进行注册; 
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
