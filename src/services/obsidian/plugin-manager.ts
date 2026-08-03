import { THIS_PLUGIN } from "src/globals/constants";
import { ChinesePatch } from "src/integrations/languages/chinese-patch";
import { FloatingWindowManager } from "src/ui/floating-window";
import {
	RELEASE_ANNOUNCEMENT_VERSION_030,
	showReleaseAnnouncementNotice,
} from "src/ui/release-announcement-notice";
import { logger } from "src/utils/logger";
import { AssetsProvider } from "src/utils/web/assets-provider";
import { SearchClient } from "src/web-workers/client";
import { singleton } from "tsyringe";
import { getInstance, isDevEnvironment } from "../../utils/my-lib";
import { AuxiliaryService } from "../auxiliary/auxiliary-service";
import { CommandRegistry } from "./command-registry";
import { SettingManager } from "./setting-manager";
import { DataManager } from "./user-data/data-manager";
import { RecentFileManager } from "./user-data/recent-file-manager";
import { ViewRegistry } from "./view-registry";
import type CleverSearch from "src/main";

@singleton()
export class PluginManager {
	// private readonly obFileUtil = getInstance(Vault).adapter as FileSystemAdapter;

	async onload() {
		await getInstance(SettingManager).initAsync();
		getInstance(ViewRegistry).init();
		if (isDevEnvironment) {
			logger.warn("仅在开发模式开启RecentFileManager")
			getInstance(RecentFileManager).init();
		}

		getInstance(CommandRegistry).addCommandsWithoutDependency();

		await getInstance(AssetsProvider).initAsync();
		await getInstance(ChinesePatch).initAsync();
		await getInstance(SearchClient).createChildThreads();

		getInstance(AuxiliaryService).init();
	}

	async onLayoutReady() {
		const commandRegistry = getInstance(CommandRegistry);
		commandRegistry.addInVaultCommands();
		await commandRegistry.addDevCommands();
		await getInstance(DataManager).initAsync();
		await this.maybeShowReleaseAnnouncement();
	}

	// should be called in CleverSearch.onunload()
	onunload() {
		getInstance(CommandRegistry).onunload();
		getInstance(DataManager).onunload();
		getInstance(FloatingWindowManager).onunload();
	}

	onAppQuit() {
		// getInstance(SettingManager).saveSettings();
	}

	private async maybeShowReleaseAnnouncement(): Promise<void> {
		if (isDevEnvironment) {
			return;
		}
		const version = this.resolveReleaseAnnouncementVersion();
		if (!version) {
			return;
		}

		const settingManager = getInstance(SettingManager);
		if (!isDevEnvironment && settingManager.hasSeenReleaseAnnouncement(version)) {
			return;
		}

		showReleaseAnnouncementNotice();
		if (!isDevEnvironment) {
			await settingManager.markReleaseAnnouncementSeen(version);
		}
	}

	private resolveReleaseAnnouncementVersion(): string | null {
		const plugin = getInstance(THIS_PLUGIN) as CleverSearch;
		const pluginVersion = plugin.manifest.version ?? "";
		return pluginVersion.startsWith(`${RELEASE_ANNOUNCEMENT_VERSION_030}.`) ||
			pluginVersion === RELEASE_ANNOUNCEMENT_VERSION_030
			? RELEASE_ANNOUNCEMENT_VERSION_030
			: null;
	}
}
