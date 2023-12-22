import type { FileSystemAdapter } from "obsidian";
import type CleverSearch from "src/main";
import { THIS_PLUGIN } from "src/utils/constants";
import { container, singleton } from "tsyringe";
import { pathUtils } from "../../utils/my-lib";
import { SettingManager } from "./settings";

@singleton()
export class PluginManager {
	private readonly plugin: CleverSearch;
	private readonly fs: FileSystemAdapter;
	public readonly vaultPath: string;
	// 存放索引的表
	public readonly indexName: string;
	public watchedPaths: string[] = [];

	
	constructor() {
		this.plugin = container.resolve(THIS_PLUGIN);
		this.fs = this.plugin.app.vault.adapter as FileSystemAdapter;
		this.vaultPath = this.fs.getBasePath().replace(/\\/g, "/") + "/";
		this.indexName = "obsidian_vault_" + this.plugin.app.vault.getName().toLowerCase();
		this.updateWatchedPaths();
		this.loadComponents();
	}


	private loadComponents() {
		container.resolve(SettingManager);
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
