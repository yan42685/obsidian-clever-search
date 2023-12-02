import { FileSystemAdapter } from "obsidian";
import CleverSearch from "./main";

export class PluginStates {
	private readonly plugin: CleverSearch;
	private readonly fs: FileSystemAdapter;
	private readonly vaultPath: string;
	private readonly watchedPaths: string[];

	constructor(plugin: CleverSearch) {
		this.plugin = plugin;
		this.fs = plugin.app.vault.adapter as FileSystemAdapter;
		this.vaultPath = this.fs.getBasePath().replace(/\\/g, "/") + "/";
		// TODO: configurable
		const whitelistPaths = [""];
		const blackListPaths = [".obsidian/"];

		this.watchedPaths = [];
	}

	getWatchedPaths() {
		return this.watchedPaths;
	}
	// 存放索引的表
	getIndexName() {
		return "obsidian_vault_" + this.plugin.app.vault.getName();
	}
}
