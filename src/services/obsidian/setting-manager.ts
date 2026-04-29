import {
	App,
	Modal,
	PluginSettingTab,
	Setting,
	TFolder,
	Vault,
} from "obsidian";
import { ICON_COLLAPSE, ICON_EXPAND, THIS_PLUGIN } from "src/globals/constants";
import { EventEnum } from "src/globals/enums";
import { migrateOuterSetting } from "src/globals/plugin-setting-migration";
import {
	DEFAULT_FILE_SEARCH_BACKEND,
	DEFAULT_OUTER_SETTING,
	OuterSetting,
	type LogLevelOptions,
	type SearchHistoryMaxItems,
	normalizeHideWeaklyRelatedResults,
	toLegacyWeakFilePruneMode,
} from "src/globals/plugin-setting";
import { ChinesePatch } from "src/integrations/languages/chinese-patch";
import type CleverSearch from "src/main";
import {
	buildDashScopeApiUrl,
	getCurrentWeekDateRange,
	getCurrentWeekTokenUsage,
	getEstimatedTokenSavingsSummary,
	getTopTokenFiles,
	getTotalTokens,
	normalizeApiDomain,
	resetCurrentWeekTokenUsage,
} from "src/services/search/hybrid/embedder";
import {
	buildHybridProviderErrorDetails,
	buildHybridSearchIssue,
} from "src/services/search/hybrid/provider-error";
import { SEARCH_RERANK_TOKEN_KEY } from "src/services/search/hybrid/reranker";
import { FloatingWindowManager } from "src/ui/floating-window";
import { eventBus, type EventCallback } from "src/utils/event-bus";
import { logger, type LogLevel } from "src/utils/logger";
import { MyLib, getInstance, isDevEnvironment } from "src/utils/my-lib";
import { AssetsProvider } from "src/utils/web/assets-provider";
import { container, inject, singleton } from "tsyringe";
import { CommonSuggester, MyNotice } from "./transformed-api";
import { t } from "./translations/locale-helper";
import {
	DataManager,
	type HybridAvailabilityState,
	type HybridDeferredEmbeddingSummary,
	type HybridHealthSummary,
} from "./user-data/data-manager";
import { DataProvider } from "./user-data/data-provider";
import type { HybridFailedEmbeddingSummary } from "./user-data/hybrid-embedding-recovery-manager";
import {
	formatHybridAvailabilityReasons,
	formatHybridAvailabilityRuntime
} from "./user-data/search-availability";
import { SearchHistoryService } from "./user-data/search-history-service";
import { ViewRegistry } from "./view-registry";

type PendingRefreshState = {
	reloadAssets: boolean;
	lexicalReindex: boolean;
	hybridRuntimeRefresh: boolean;
	hybridSyncFileSetWithoutEmbedding: boolean;
	hybridFullReindex: boolean;
};

function createPendingRefreshState(): PendingRefreshState {
	return {
		reloadAssets: false,
		lexicalReindex: false,
		hybridRuntimeRefresh: false,
		hybridSyncFileSetWithoutEmbedding: false,
		hybridFullReindex: false,
	};
}

const HYBRID_RUNTIME_STATUS_REFRESH_MS = 1_000;

@singleton()
export class SettingManager {
	private plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private setting: OuterSetting;
	private pendingRefresh = createPendingRefreshState();

	async initAsync() {
		await this.loadSettings(); // must run this line before registering PluginSetting
		container.register(OuterSetting, { useValue: this.setting });
		this.plugin.addSettingTab(getInstance(GeneralTab));
	}

	// NOTE: this.plugin.saveData() can't handle Set
	async saveSettings() {
		await this.plugin.saveData(this.setting);
	}

	hasSeenReleaseAnnouncement(version: string): boolean {
		return this.setting.releaseAnnouncements.seenVersions.includes(version);
	}

	async markReleaseAnnouncementSeen(version: string): Promise<void> {
		if (this.hasSeenReleaseAnnouncement(version)) {
			return;
		}
		this.setting.releaseAnnouncements.seenVersions.push(version);
		await this.saveSettings();
	}

	async postSettingUpdated() {
		await this.saveSettings();
		const pendingRefresh = this.consumePendingRefresh();
		const dataProvider = getInstance(DataProvider);
		dataProvider.init();

		if (!this.hasPendingRefresh(pendingRefresh)) {
			return;
		}

		getInstance(ViewRegistry).refreshAll();
		if (pendingRefresh.reloadAssets) {
			await getInstance(AssetsProvider).initAsync();
			await getInstance(ChinesePatch).initAsync();
		}
		const dataManager = getInstance(DataManager);
		if (pendingRefresh.lexicalReindex) {
			await dataManager.refreshLexicalStateAsync();
		}
		if (pendingRefresh.hybridFullReindex) {
			await dataManager.refreshHybridStateAsync({ forceRefresh: true });
			return;
		}
		if (pendingRefresh.hybridRuntimeRefresh) {
			await dataManager.refreshHybridStateAsync();
		}
		if (pendingRefresh.hybridSyncFileSetWithoutEmbedding) {
			await dataManager.refreshHybridStateAsync({
				syncFileSetWithoutEmbedding:
					pendingRefresh.hybridSyncFileSetWithoutEmbedding,
			});
		}
	}

	private async loadSettings() {
		// shallow merge can't handle nested object correctly
		// this.setting = Object.assign(
		// 	{},
		// 	DEFAULT_OUTER_SETTING,
		// 	await this.plugin.loadData(),
		// );
		const migrationResult = migrateOuterSetting(await this.plugin.loadData());
		this.setting = MyLib.mergeDeep(
			DEFAULT_OUTER_SETTING,
			migrationResult.data as Partial<OuterSetting>,
		) as OuterSetting;
		this.setting.fileSearchBackend = DEFAULT_FILE_SEARCH_BACKEND;
		this.setting.hideWeaklyRelatedResults = normalizeHideWeaklyRelatedResults(
			((this.setting as unknown) as Record<string, unknown>)
				.hideWeaklyRelatedResults,
		);
		this.setting.weakFilePruneMode = toLegacyWeakFilePruneMode(
			this.setting.hideWeaklyRelatedResults,
		);
		logger.setLevel(this.setting.logLevel);
		if (migrationResult.didMigrate) {
			await this.plugin.saveData(this.setting);
		}
	}

	private hasPendingRefresh(state: PendingRefreshState): boolean {
		return Object.values(state).some(Boolean);
	}

	private consumePendingRefresh(): PendingRefreshState {
		const current = this.pendingRefresh;
		this.pendingRefresh = createPendingRefreshState();
		return current;
	}

	requestLexicalReindex(options: { reloadAssets?: boolean } = {}): void {
		this.pendingRefresh.lexicalReindex = true;
		this.pendingRefresh.reloadAssets =
			this.pendingRefresh.reloadAssets || (options.reloadAssets ?? false);
	}

	requestHybridRuntimeRefresh(): void {
		this.pendingRefresh.hybridRuntimeRefresh = true;
	}

	requestHybridLocalRefresh(options: {
		syncFileSetWithoutEmbedding?: boolean;
		reloadAssets?: boolean;
	} = {}): void {
		this.pendingRefresh.hybridSyncFileSetWithoutEmbedding =
			this.pendingRefresh.hybridSyncFileSetWithoutEmbedding ||
			(options.syncFileSetWithoutEmbedding ?? false);
		this.pendingRefresh.reloadAssets =
			this.pendingRefresh.reloadAssets || (options.reloadAssets ?? false);
	}

	requestHybridFullReindex(options: { reloadAssets?: boolean } = {}): void {
		this.pendingRefresh.hybridFullReindex = true;
		this.pendingRefresh.reloadAssets =
			this.pendingRefresh.reloadAssets || (options.reloadAssets ?? false);
	}
}

export function openHybridSearchModal(app: App) {
	new HybridSearchModal(app).open();
}

export function openLexicalSearchModal(app: App) {
	new LexicalSearchModal(app).open();
}

export function openHybridHealthSummaryModal(app: App) {
	new HybridHealthSummaryModal(app).open();
}

export function openSearchHistoryModal(app: App) {
	new SearchHistoryModal(app).open();
}

export function openQuickSwitchManageModal(app: App) {
	new QuickSwitchManageModal(app).open();
}

@singleton()
class GeneralTab extends PluginSettingTab {
	private readonly settingManager = getInstance(SettingManager);
	private readonly setting = getInstance(OuterSetting);
	// WARN: this class should not initialize any other modules on fields
	//       or there will be runtime exceptions that are hard to diagnose
	// BE CAUTIOUS

	constructor(@inject(THIS_PLUGIN) plugin: CleverSearch) {
		super(plugin.app, plugin);
	}
	hide() {
		this.settingManager.postSettingUpdated();
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// new Setting(containerEl)
		// 	.setName("Min word Length to Trigger Prefix Search")
		// 	// For Chinese users, a setting of 1 or 2 is typically sufficient, because there are many different chars
		// 	.setDesc("Affect the responding speed for the first several characters")
		// 	.addSlider(text => text
		// 		.setLimits(1, 4, 1)
		// 		.setValue(this.setting.search.minTermLengthForPrefixSearch)
		// 		.setDynamicTooltip()
		// 		.onChange(async (value) => {
		// 			this.setting.search.minTermLengthForPrefixSearch = value as 1 | 2 | 3 | 4;
		// 			await this.settingManager.saveSettings();
		// 		}),
		// 	);

		new Setting(containerEl)
			.setName(t("Lexical search"))
			.setDesc(t("Lexical search desc"))
			.addButton((button) =>
				button.setButtonText(t("Manage")).onClick(() => {
					openLexicalSearchModal(getInstance(App));
				}),
			);

		new Setting(containerEl)
			.setName(t("Hybrid search"))
			.setDesc(t("Hybrid search desc"))
			.addButton((b) =>
				b.setButtonText(t("Manage")).onClick(() => {
					openHybridSearchModal(getInstance(App));
				}),
			);

		new Setting(containerEl)
			.setName(t("Search history completion"))
			.setDesc(t("Search history desc"))
			.addButton((button) =>
				button.setButtonText(t("Manage")).onClick(() => {
					openSearchHistoryModal(getInstance(App));
				}),
			);

		new Setting(containerEl)
			.setName(t("QuickSwitch"))
			.setDesc(t("QuickSwitch desc"))
			.addButton((button) =>
				button.setButtonText(t("Manage")).onClick(() => {
					openQuickSwitchManageModal(getInstance(App));
				}),
			);

		new Setting(containerEl).setName(t("Excluded files")).addButton((b) =>
			b.setButtonText(t("Manage")).onClick(() => {
				new ExcludePathModal(getInstance(App)).open();
			}),
		);

		new Setting(containerEl)
			.setName(t("Customize extensions"))
			.addButton((b) =>
				b
					.setButtonText(t("Manage"))
					.onClick(() =>
						new CustomExtensionModal(getInstance(App)).open(),
					),
			);

		new Setting(containerEl)
			.setName(t("Reindex the vault"))
			.addButton((button) => {
				button.setButtonText(t("Reindex")).onClick(async () => {
					await getInstance(DataManager).refreshAllAsync();
				});
			});

		// ======== For Development =======
		const settingGroup = containerEl.createDiv("cs-dev-setting-group");
		settingGroup.style.marginTop = "1.5em";

		const devSettingTitle = settingGroup.createDiv({
			cls: "cs-setting-group-dev-title",
			text: t("For Development"),
		});

		// collapse by default
		const devSettingContent = settingGroup.createDiv({
			cls: "cs-setting-group-dev-content",
		});

		const collapseDevSettingByDefault =
			this.setting.ui.collapseDevSettingByDefault;
		devSettingContent.style.display = collapseDevSettingByDefault
			? "none"
			: "block";
		devSettingTitle.style.setProperty(
			"--cs-dev-collapse-icon",
			collapseDevSettingByDefault ? ICON_COLLAPSE : ICON_EXPAND,
		);

		// Toggle the development section and update the collapse icon.
		devSettingTitle.onclick = () => {
			const isCollapsed = devSettingContent.style.display === "none";
			devSettingContent.style.display = isCollapsed ? "block" : "none";
			devSettingTitle.style.setProperty(
				"--cs-dev-collapse-icon",
				isCollapsed ? ICON_EXPAND : ICON_COLLAPSE,
			);
		};

		new Setting(devSettingContent)
			.setName(t("Collapse development setting by default"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.ui.collapseDevSettingByDefault)
					.onChange((value) => {
						this.setting.ui.collapseDevSettingByDefault = value;
					}),
			);

		new Setting(devSettingContent)
			.setName(t("Log level"))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						trace: "trace",
						debug: "debug",
						info: "info",
						warn: "warn",
						error: "error",
						none: "none",
					} as LogLevelOptions)
					// Use lowercase values because the stored log level is normalized.
					.setValue(this.setting.logLevel.toLowerCase())
					.onChange(async (value) => {
						const level = value as LogLevel;
						logger.setLevel(level);
						this.setting.logLevel = level;
					}),
			);

		new Setting(devSettingContent)
			.setName(t("Reset floating window position"))
			.setDesc(t("Reset floating window position desc"))
			.addButton((b) =>
				b.setButtonText(t("Reset position")).onClick((e) => {
					getInstance(FloatingWindowManager).resetAllPositions();
				}),
			);

		new Setting(devSettingContent)
			.setName(t("Support the Project"))
			.setDesc(t("Support the Project desc"))
			.addButton((button) => {
				button.setButtonText(t("Visit GitHub")).onClick(() => {
					window.open(
						"https://github.com/yan42685/obsidian-clever-search",
						"_blank",
					);
				});
			});
	}
}

class LexicalSearchModal extends Modal {
	private readonly settingManager = getInstance(SettingManager);
	private readonly setting = getInstance(OuterSetting);

	onOpen() {
		this.modalEl.style.width = "52vw";
		this.modalEl.querySelector(".modal-close-button")?.remove();
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h4", { text: t("lexicalModal.section.display") });

		new Setting(contentEl)
			.setName(t("Max items count"))
			.setDesc(t("Max items count desc"))
			.addSlider((slider) =>
				slider
					.setLimits(1, 200, 1)
					.setValue(this.setting.ui.maxItemResults)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.setting.ui.maxItemResults = value;
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("Floating window for in-file search"))
			.setDesc(t("Floating window for in-file search desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.ui.floatingWindowForInFile)
					.onChange(async (value) => {
						this.setting.ui.floatingWindowForInFile = value;
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("Weak file pruning"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.hideWeaklyRelatedResults)
					.onChange(async (value) => {
						this.setting.hideWeaklyRelatedResults = value;
						this.setting.weakFilePruneMode = toLegacyWeakFilePruneMode(value);
						await this.settingManager.saveSettings();
					}),
			);

		contentEl.createEl("h4", { text: t("lexicalModal.section.matching") });

		new Setting(contentEl).setName(t("Case sensitive")).addToggle((toggle) =>
			toggle.setValue(this.setting.isCaseSensitive).onChange(async (value) => {
				this.setting.isCaseSensitive = value;
				this.settingManager.requestLexicalReindex();
				await this.settingManager.saveSettings();
			}),
		);

		new Setting(contentEl)
			.setName(t("Prefix match"))
			.setDesc(t("Prefix match desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.isPrefixMatch)
					.onChange(async (value) => {
						this.setting.isPrefixMatch = value;
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("Character fuzzy allowed"))
			.setDesc(t("Character fuzzy allowed desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.setting.isFuzzy).onChange(async (value) => {
					this.setting.isFuzzy = value;
					await this.settingManager.saveSettings();
				}),
			);

		new Setting(contentEl)
			.setName(t("English word blacklist"))
			.setDesc(t("English word blacklist desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.enableStopWordsEn)
					.onChange(async (value) => {
						this.setting.enableStopWordsEn = value;
						this.settingManager.requestLexicalReindex();
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("Chinese patch"))
			.setDesc(t("Chinese patch desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.enableChinesePatch)
					.onChange(async (value) => {
						this.setting.enableChinesePatch = value;
						logger.info(
							`enable chinese: ${
								getInstance(OuterSetting).enableChinesePatch
							}`,
						);
						this.settingManager.requestLexicalReindex({
							reloadAssets: true,
						});
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("Chinese word blacklist"))
			.setDesc(t("Chinese word blacklist desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.enableStopWordsZh)
					.onChange(async (value) => {
						this.setting.enableStopWordsZh = value;
						this.settingManager.requestLexicalReindex({
							reloadAssets: true,
						});
						await this.settingManager.saveSettings();
					}),
			);
	}

	onClose() {
		void this.settingManager.postSettingUpdated();
	}
}

class SearchHistoryModal extends Modal {
	private readonly settingManager = getInstance(SettingManager);
	private readonly setting = getInstance(OuterSetting);
	private readonly searchHistoryService = getInstance(SearchHistoryService);

	onOpen() {
		this.modalEl.style.width = "42vw";
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName(t("Search history completion"))
			.setDesc(t("Search history completion desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.searchHistory.enabled)
					.onChange(async (value) => {
						this.setting.searchHistory.enabled = value;
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("Search history suggestions"))
			.setDesc(t("Search history suggestions desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.searchHistory.showSuggestions)
					.onChange(async (value) => {
						this.setting.searchHistory.showSuggestions = value;
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("Search history ghost completion"))
			.setDesc(t("Search history ghost completion desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.searchHistory.enableGhostCompletion)
					.onChange(async (value) => {
						this.setting.searchHistory.enableGhostCompletion = value;
						await this.settingManager.saveSettings();
					}),
			);


		new Setting(contentEl)
			.setName(t("Search history max items"))
			.setDesc(t("Search history max items desc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						20: "20",
						50: "50",
						100: "100",
						1000: "1000",
						3000: "3000",
						5000: "5000",
						10000: "10000",
					})
					.setValue(String(this.setting.searchHistory.maxItems))
					.onChange(async (value) => {
						this.setting.searchHistory.maxItems =
							Number(value) as SearchHistoryMaxItems;
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("Clear search history"))
			.setDesc(
				`${t("Clear search history desc")} (${this.searchHistoryService.getEntryCount()})`,
			)
			.addButton((button) =>
				button.setButtonText(t("Clear")).onClick(async () => {
					await this.searchHistoryService.clearHistory();
					this.onOpen();
				}),
			);
	}
}

class QuickSwitchManageModal extends Modal {
	private readonly settingManager = getInstance(SettingManager);
	private readonly setting = getInstance(OuterSetting);
	private readonly searchHistoryService = getInstance(SearchHistoryService);

	onOpen() {
		this.modalEl.style.width = "42vw";
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName(t("Autocomplete candidate sources"))
			.setDesc(t("Autocomplete candidate sources desc"));

		new Setting(contentEl)
			.setName(t("Search history source file"))
			.setDesc(t("Search history source file desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.searchHistory.sources.file)
					.onChange(async (value) => {
						this.setting.searchHistory.sources.file = value;
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("Search history source alias"))
			.setDesc(t("Search history source alias desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.searchHistory.sources.alias)
					.onChange(async (value) => {
						this.setting.searchHistory.sources.alias = value;
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("Search history source heading"))
			.setDesc(t("Search history source heading desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.searchHistory.sources.heading)
					.onChange(async (value) => {
						this.setting.searchHistory.sources.heading = value;
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("Search history source path"))
			.setDesc(t("Search history source path desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.searchHistory.sources.path)
					.onChange(async (value) => {
						this.setting.searchHistory.sources.path = value;
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("Search history source recent"))
			.setDesc(t("Search history source recent desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.searchHistory.sources.recentFile)
					.onChange(async (value) => {
						this.setting.searchHistory.sources.recentFile = value;
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("Enable QuickSwitch history"))
			.setDesc(t("Enable QuickSwitch history desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.quickSwitchHistory.enabled)
					.onChange(async (value) => {
						this.setting.quickSwitchHistory.enabled = value;
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("QuickSwitch history max items"))
			.setDesc(t("QuickSwitch history max items desc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						20: "20",
						50: "50",
						100: "100",
						1000: "1000",
						3000: "3000",
						5000: "5000",
						10000: "10000",
					})
					.setValue(String(this.setting.quickSwitchHistory.maxItems))
					.onChange(async (value) => {
						this.setting.quickSwitchHistory.maxItems =
							Number(value) as SearchHistoryMaxItems;
						await this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("Clear QuickSwitch history"))
			.setDesc(`${t("Clear QuickSwitch history desc")} (${this.searchHistoryService.getQuickSwitchEntryCount()})`)
			.addButton((button) =>
				button.setButtonText(t("Clear")).onClick(async () => {
					await this.searchHistoryService.clearQuickSwitchHistory();
					this.onOpen();
				}),
			);
	}
}

function appendHybridStatusText(container: HTMLElement, text: string) {
	container.createEl("p", { text });
}

function appendHybridStatusLine(
	container: HTMLElement,
	label: string,
	value: string,
) {
	appendHybridStatusText(container, `${label}: ${value}`);
}

function formatHybridFailureKindSummary(
	items: Array<{ kind: string; count: number }>,
): string {
	return items
		.map(
			(item) =>
				`${t(`hybridModal.failedEmbeddingReason.${item.kind}` as any)} x${item.count}`,
		)
		.join(" | ");
}

function formatHybridRelativeTime(targetAt: number): string {
	const remainingMs = Math.max(0, targetAt - Date.now());
	const totalSeconds = Math.ceil(remainingMs / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes} min ${seconds} s`;
}

function renderHybridHealthSummary(
	container: HTMLElement,
	summary: HybridHealthSummary,
	availabilityState: HybridAvailabilityState,
	failedEmbeddingSummary: HybridFailedEmbeddingSummary,
	deferredEmbeddingSummary: HybridDeferredEmbeddingSummary,
) {
	container.empty();
	appendHybridStatusLine(
		container,
		t("hybridModal.healthSummary.status"),
		t(`hybridModal.healthSummary.state.${summary.state}` as any),
	);
	appendHybridStatusLine(
		container,
		"Runtime",
		formatHybridAvailabilityRuntime(availabilityState),
	);
	if (availabilityState.reasons.length > 0) {
		appendHybridStatusLine(
			container,
			"Reasons",
			formatHybridAvailabilityReasons(availabilityState.reasons),
		);
	}
	if (availabilityState.prompt.blockingNoticeKey) {
		appendHybridStatusLine(
			container,
			"Notice",
			t(availabilityState.prompt.blockingNoticeKey),
		);
	}
	appendHybridStatusLine(
		container,
		t("hybridModal.healthSummary.engine"),
		[
			`${t("hybridModal.healthSummary.metric.ready")} ${summary.readyFileCount}`,
			`${t("hybridModal.healthSummary.metric.lexicalOnly")} ${summary.lexicalOnlyFileCount}`,
			`${t("hybridModal.healthSummary.metric.unstable")} ${summary.unstableFileCount}`,
		].join(" | "),
	);
	appendHybridStatusLine(
		container,
		t("hybridModal.healthSummary.docs"),
		[
			`${t("hybridModal.healthSummary.metric.tracked")} ${summary.trackedFileCount}`,
			`${t("hybridModal.healthSummary.metric.processing")} ${summary.processingFileCount}`,
			`${t("hybridModal.healthSummary.metric.stale")} ${summary.staleFileCount}`,
			`${t("hybridModal.healthSummary.metric.repair")} ${summary.repairFileCount}`,
		].join(" | "),
	);
	appendHybridStatusLine(
		container,
		t("hybridModal.healthSummary.storage"),
		[
			`${t("hybridModal.healthSummary.metric.refs")} ${summary.indexedFileRefCount}`,
			`${t("hybridModal.healthSummary.metric.currentAligned")} ${summary.currentAlignedSnapshotCount}`,
			`${t("hybridModal.healthSummary.metric.shadowAligned")} ${summary.shadowAlignedSnapshotCount}`,
			`${t("hybridModal.healthSummary.metric.shadowMismatch")} ${summary.shadowMismatchCount}`,
		].join(" | "),
	);
	appendHybridStatusLine(
		container,
		t("hybridModal.healthSummary.errors"),
		[
			`${t("hybridModal.healthSummary.metric.failed")} ${summary.failedEmbeddingCount}`,
			`${t("hybridModal.healthSummary.metric.deferred")} ${summary.deferredEmbeddingCount}`,
		].join(" | "),
	);
	if (failedEmbeddingSummary.blockingKinds.length > 0) {
		appendHybridStatusLine(
			container,
			t("hybridModal.failedEmbeddingStatus.blocked"),
			formatHybridFailureKindSummary(failedEmbeddingSummary.blockingKinds),
		);
	}
	if (failedEmbeddingSummary.retryableKinds.length > 0) {
		appendHybridStatusLine(
			container,
			t("hybridModal.failedEmbeddingStatus.retrying"),
			formatHybridFailureKindSummary(failedEmbeddingSummary.retryableKinds),
		);
	}
	if (
		failedEmbeddingSummary.retryableCount > 0 &&
		failedEmbeddingSummary.nextRetryAt !== null
	) {
		appendHybridStatusLine(
			container,
			t("hybridModal.failedEmbeddingStatus.nextRetry"),
			formatHybridRelativeTime(failedEmbeddingSummary.nextRetryAt),
		);
	}
	if (
		deferredEmbeddingSummary.deferredCount > 0 &&
		deferredEmbeddingSummary.nextEligibleAt !== null
	) {
		appendHybridStatusLine(
			container,
			t("hybridModal.deferredEmbeddingStatus.nextResume"),
			formatHybridRelativeTime(deferredEmbeddingSummary.nextEligibleAt),
		);
	}
	if (summary.processingSamplePaths.length > 0) {
		appendHybridStatusLine(
			container,
			t("hybridModal.freshnessNotice.processingSamples"),
			summary.processingSamplePaths.join(" | "),
		);
	}
	if (summary.staleSamplePaths.length > 0) {
		appendHybridStatusLine(
			container,
			t("hybridModal.freshnessNotice.staleSamples"),
			summary.staleSamplePaths.join(" | "),
		);
	}
	if (summary.shadowMismatchSamplePaths.length > 0) {
		appendHybridStatusLine(
			container,
			t("hybridModal.healthSummary.metric.samples"),
			summary.shadowMismatchSamplePaths.join(" | "),
		);
	}
}

function formatDevOnlySettingName(name: string): string {
	return `${name}（Dev Only）`;
}

class HybridHealthSummaryModal extends Modal {
	private summaryEl: HTMLElement;

	onOpen() {
		this.modalEl.style.width = "42vw";
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h3", {
			text: formatDevOnlySettingName(t("hybridModal.healthSummary")),
		});
		contentEl.createEl("p", { text: t("hybridModal.healthSummary.localOnly") });
		new Setting(contentEl).addButton((button) =>
			button.setButtonText(t("hybridModal.healthSummary.check")).onClick(
				() => {
					void this.runHealthCheck();
				},
			),
		);
		this.summaryEl = contentEl.createDiv();
		this.summaryEl.style.margin = "0.35em 0 0 0";
		this.summaryEl.setText(t("hybridModal.healthSummary.loading"));
		void this.runHealthCheck();
	}

	private async runHealthCheck() {
		this.summaryEl.setText(t("hybridModal.healthSummary.loading"));
		try {
			const dataManager = getInstance(DataManager);
			const [summary, failedEmbeddingSummary, deferredEmbeddingSummary] =
				await Promise.all([
					dataManager.getHybridHealthSummary(),
					Promise.resolve(dataManager.getHybridFailedEmbeddingSummary()),
					dataManager.getHybridDeferredEmbeddingSummary(),
				]);
			const availabilityState = dataManager.getHybridAvailabilityState();
			renderHybridHealthSummary(
				this.summaryEl,
				summary,
				availabilityState,
				failedEmbeddingSummary,
				deferredEmbeddingSummary,
			);
		} catch (error) {
			logger.error("failed to load hybrid health summary:", error);
			this.summaryEl.setText("Failed to load local health summary.");
			new MyNotice("Failed to load local health summary.", 5000);
		}
	}
}

class HybridSearchModal extends Modal {
	private settingManager = getInstance(SettingManager);
	private setting = getInstance(OuterSetting);
	private dataProvider = getInstance(DataProvider);
	private allPaths = new Set<string>();
	private allFolders = new Set<string>();
	private excludesEl: HTMLElement;
	private inputEl: HTMLInputElement;
	private suggester: CommonSuggester;
	private weeklyLimitInputEl: HTMLInputElement;
	private weeklyQuotaEl: HTMLElement;
	private autoTriggerDebounceSettingEl: HTMLElement;
	private hybridApiDomainInputEl: HTMLInputElement;
	private hybridApiKeyInputEl: HTMLInputElement;
	private failedEmbeddingStatusEl: HTMLElement;
	private deferredEmbeddingStatusEl: HTMLElement;
	private statsEl: HTMLElement;
	private openedApiDomain = "";
	private openedApiKey = "";
	private currentFailedEmbeddingSummary: HybridFailedEmbeddingSummary | null = null;
	private currentDeferredEmbeddingSummary: HybridDeferredEmbeddingSummary | null = null;
	private failedEmbeddingStatusTimer: number | null = null;
	private readonly failedEmbeddingStatusListener: EventCallback = () => {
		void this.refreshHybridRuntimeStatusFromData();
	};

	constructor(app: App) {
		super(app);
		const allAbstractFiles = getInstance(Vault).getAllLoadedFiles();
		for (const aFile of allAbstractFiles) {
			this.allPaths.add(aFile.path);
			if (aFile instanceof TFolder) {
				this.allFolders.add(aFile.path);
			}
		}
	}

	onOpen() {
		this.modalEl.style.width = "52vw";
		this.modalEl.style.marginBottom = "5em";
		this.modalEl.querySelector(".modal-close-button")?.remove();
		this.openedApiDomain = this.setting.hybrid.apiDomain ?? "";
		this.openedApiKey = this.setting.hybrid.apiKey ?? "";
		eventBus.on(
			EventEnum.HYBRID_RUNTIME_STATUS_CHANGED,
			this.failedEmbeddingStatusListener,
		);
		this.failedEmbeddingStatusTimer = window.setInterval(() => {
			this.renderHybridRuntimeStatus();
		}, HYBRID_RUNTIME_STATUS_REFRESH_MS);
		const contentEl = this.contentEl;

		// Introduction

		// 闂傚倸鍊风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛?Enable 闂傚倸鍊风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛瀛樼矒缁犳牕顫忓ú顏勭闁圭粯甯掓潏鍛存⒑缁嬫鍎愰柟鐟版喘瀵顓兼径濠勵槯婵犮垼娉涢敃锝嗙珶閺囥垺鈷掑ù锝囶焾閺嗛亶鏌涘Ο鑽ょ煉鐎规洘鍨块獮妯肩磼濡厧甯楅梻浣侯焾缁绘劙藝椤栨稓顩插Δ锝呭暞閳锋垿鏌涢幇顓炵祷閻㈩垬鍔戦弻娑氣偓锝庡亝瀹曞矂鏌＄仦鐣屝х€规洘顨嗗鍕節娴ｅ壊妫滈梻鍌氬€风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛瀛樼矒缁犳牕顫忓ú顏勭闁圭粯甯掓潏鍛存⒑缁嬫鍎愰柟鐟版喘瀵顓兼径濠勵槯婵犮垼娉涢敃锝嗙珶閺囥垺鈷掑ù锝囶焾閺嗛亶鏌涘Ο鑽ょ煉鐎规洘鍨块獮妯肩磼濡厧甯楅梻浣侯焾缁绘劙藝椤栨稓顩插Δ锝呭暞閳锋垿鏌涢幇顓炵祷閻㈩垬鍔戦弻娑氣偓锝庡亝瀹曞矂鏌＄仦鐣屝х€规洘顨嗗鍕節娴ｅ壊妫滈梻鍌氬€风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛瀛樼矒缁犳牕顫忓ú顏勭闁圭粯甯掓潏鍛存⒑缁嬫鍎愰柟鐟版喘瀵顓兼径濠勵槯婵犮垼娉涢敃锝嗙珶閺囥垺鈷掑ù锝囶焾閺嗛亶鏌涘Ο鑽ょ煉鐎规洘鍨块獮妯肩磼濡厧甯楅梻浣侯焾缁绘劙藝椤栨稓顩插Δ锝呭暞閳锋垿鏌涢幇顓炵祷閻㈩垬鍔戦弻娑氣偓锝庡亝瀹曞矂鏌＄仦鐣屝х€规洘顨嗗鍕節娴ｅ壊妫滈梻鍌氬€风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛瀛樼矒缁犳牕顫忓ú顏勭闁圭粯甯掓潏鍛存⒑缁嬫鍎愰柟鐟版喘瀵顓兼径濠勵槯婵犮垼娉涢敃锝嗙珶閺囥垺鈷掑ù锝囶焾閺嗛亶鏌涘Ο鑽ょ煉鐎规洘鍨块獮妯肩磼濡厧甯楅梻浣侯焾缁绘劙藝椤栨稓顩插Δ锝呭暞閳锋垿鏌涢幇顓炵祷閻㈩垬鍔戦弻娑氣偓锝庡亝瀹曞矂鏌＄仦鐣屝х€规洘顨嗗鍕節娴ｅ壊妫滈梻鍌氬€风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛瀛樼矒缁犳牕顫忓ú顏勭闁圭粯甯掓潏鍛存⒑缁嬫鍎愰柟鐟版喘瀵顓兼径濠勵槯婵犮垼娉涢敃锝嗙珶閺囥垺鈷掑ù锝囶焾閺嗛亶鏌涘Ο鑽ょ煉鐎规洘鍨块獮妯肩磼濡厧甯楅梻浣侯焾缁绘劙藝椤栨稓顩插Δ锝呭暞閳锋垿鏌涢幇顓炵祷閻㈩垬鍔戦弻娑氣偓锝庡亝瀹曞矂鏌＄仦鐣屝х€规洘顨嗗鍕節娴ｅ壊妫滈梻鍌氬€风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛瀛樼矒缁犳牕顫忓ú顏勭闁圭粯甯掓潏鍛存⒑缁嬫鍎愰柟鐟版喘瀵顓兼径濠勵槯婵犮垼娉涢敃锝嗙珶閺囥垺鈷掑ù锝囶焾閺嗛亶鏌涘Ο鑽ょ煉鐎规洘鍨块獮妯肩磼濡厧甯楅梻浣侯焾缁绘劙藝椤栨稓顩插Δ锝呭暞閳锋垿鏌涢幇顓炵祷閻㈩垬鍔戦弻娑氣偓锝庡亝瀹曞矂鏌＄仦鐣屝х€规洘顨嗗鍕節娴ｅ壊妫滈梻鍌氬€风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛瀛樼矒缁犳牕顫忓ú顏勭闁圭粯甯掓潏鍛存⒑缁嬫鍎愰柟鐟版喘瀵顓兼径濠勵槯婵犮垼娉涢敃锝嗙珶閺囥垺鈷掑ù锝囶焾閺嗛亶鏌涘Ο鑽ょ煉鐎规洘鍨块獮妯肩磼濡厧甯楅梻浣侯焾缁绘劙藝椤栨稓顩插Δ锝呭暞閳锋垿鏌涢幇顓炵祷閻㈩垬鍔戦弻娑氣偓锝庡亝瀹曞矂鏌＄仦鐣屝х€规洘顨嗗鍕節娴ｅ壊妫滈梻鍌氬€风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛瀛樼矒缁犳牕顫忓ú顏勭闁圭粯甯掓潏鍛存⒑缁嬫鍎愰柟鐟版喘瀵顓兼径濠勵槯婵犮垼娉涢敃锝嗙珶?
		new Setting(contentEl)
			.setName(t("hybridModal.enableHybridSearch"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.hybrid.enabled)
					.onChange((v) => {
						this.setting.hybrid.enabled = v;
						this.settingManager.requestHybridRuntimeRefresh();
						this.settingManager.saveSettings();
					}),
			);

		// API Domain
		new Setting(contentEl)
			.setName(t("hybridModal.autoShowMixedSearchResults"))
			.setDesc(t("hybridModal.autoShowMixedSearchResults.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.setting.hybrid.autoShowResultsWhenLexicalEmpty ?? false,
					)
					.onChange((value) => {
						this.setting.hybrid.autoShowResultsWhenLexicalEmpty = value;
						this.settingManager.saveSettings();
					}),
			);

		const defaultApiDomain = "dashscope.aliyuncs.com";
		new Setting(contentEl)
			.setName(t("hybridModal.apiDomain"))
			.setDesc(t("hybridModal.apiDomain.desc"))
			.addText((text) => {
				this.hybridApiDomainInputEl = text.inputEl;
                text.inputEl.style.width = "24.62rem";
				text
					.setPlaceholder(defaultApiDomain)
					.setValue(
						this.setting.hybrid.apiDomain
							? normalizeApiDomain(this.setting.hybrid.apiDomain)
							: defaultApiDomain,
					)
					.onChange((v) => {
						const normalized = normalizeApiDomain(v);
						this.setting.hybrid.apiDomain =
							normalized === defaultApiDomain ? "" : normalized;
						this.settingManager.saveSettings();
					});
			});

		new Setting(contentEl)
			.setName(t("hybridModal.apiKey"))
			.addText((text) => {
				this.hybridApiKeyInputEl = text.inputEl;
				text.inputEl.type = "text";
                text.inputEl.style.width = "21rem";
				text
					.setPlaceholder("sk-...")
					.setValue(this.setting.hybrid.apiKey)
					.onChange((v) => {
						this.setting.hybrid.apiKey = v;
						this.settingManager.saveSettings();
					});
			})
			.addButton((button) =>
				button.setButtonText(t("hybridModal.testConnection")).onClick(() => {
					void this.checkHybridApiConnectivity();
				}),
			);
		// 闂傚倸鍊风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛?Weekly token limit 闂傚倸鍊风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛瀛樼矒缁犳牕顫忓ú顏勭闁圭粯甯掓潏鍛存⒑缁嬫鍎愰柟鐟版喘瀵顓兼径濠勵槯婵犮垼娉涢敃锝嗙珶閺囥垺鈷掑ù锝囶焾閺嗛亶鏌涘Ο鑽ょ煉鐎规洘鍨块獮妯肩磼濡厧甯楅梻浣侯焾缁绘劙藝椤栨稓顩插Δ锝呭暞閳锋垿鏌涢幇顓炵祷閻㈩垬鍔戦弻娑氣偓锝庡亝瀹曞矂鏌＄仦鐣屝х€规洘顨嗗鍕節娴ｅ壊妫滈梻鍌氬€风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛瀛樼矒缁犳牕顫忓ú顏勭闁圭粯甯掓潏鍛存⒑缁嬫鍎愰柟鐟版喘瀵顓兼径濠勵槯婵犮垼娉涢敃锝嗙珶閺囥垺鈷掑ù锝囶焾閺嗛亶鏌涘Ο鑽ょ煉鐎规洘鍨块獮妯肩磼濡厧甯楅梻浣侯焾缁绘劙藝椤栨稓顩插Δ锝呭暞閳锋垿鏌涢幇顓炵祷閻㈩垬鍔戦弻娑氣偓锝庡亝瀹曞矂鏌＄仦鐣屝х€规洘顨嗗鍕節娴ｅ壊妫滈梻鍌氬€风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛瀛樼矒缁犳牕顫忓ú顏勭闁圭粯甯掓潏鍛存⒑缁嬫鍎愰柟鐟版喘瀵顓兼径濠勵槯婵犮垼娉涢敃锝嗙珶閺囥垺鈷掑ù锝囶焾閺嗛亶鏌涘Ο鑽ょ煉鐎规洘鍨块獮妯肩磼濡厧甯楅梻浣侯焾缁绘劙藝椤栨稓顩插Δ锝呭暞閳锋垿鏌涢幇顓炵祷閻㈩垬鍔戦弻娑氣偓锝庡亝瀹曞矂鏌＄仦鐣屝х€规洘顨嗗鍕節娴ｅ壊妫滈梻鍌氬€风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛瀛樼矒缁犳牕顫忓ú顏勭闁圭粯甯掓潏鍛存⒑缁嬫鍎愰柟鐟版喘瀵顓兼径濠勵槯婵犮垼娉涢敃锝嗙珶閺囥垺鈷掑ù锝囶焾閺嗛亶鏌涘Ο鑽ょ煉鐎规洘鍨块獮妯肩磼濡厧甯楅梻浣侯焾缁绘劙藝椤栨稓顩插Δ锝呭暞閳锋垿鏌涢幇顓炵祷閻㈩垬鍔戦弻娑氣偓锝庡亝瀹曞矂鏌＄仦鐣屝х€规洘顨嗗鍕節娴ｅ壊妫滈梻鍌氬€风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛瀛樼矒缁犳牕顫忓ú顏勭闁圭粯甯掓潏鍛存⒑缁嬫鍎愰柟鐟版喘瀵顓兼径濠勵槯婵犮垼娉涢敃锝嗙珶閺囥垺鈷掑ù锝囶焾閺嗛亶鏌涘Ο鑽ょ煉鐎规洘鍨块獮妯肩磼濡厧甯楅梻浣侯焾缁绘劙藝椤栨稓顩插Δ锝呭暞閳锋垿鏌涢幇顓炵祷閻㈩垬鍔戦弻娑氣偓锝庡亝瀹曞矂鏌＄仦鐣屝х€规洘顨嗗鍕節娴ｅ壊妫滈梻鍌氬€风粈渚€宕崸妤€鍌ㄦ繝濠傜墕绾惧鏌熼崜褏甯涢柣鎾冲暣閺屾稖绠涢幙鍐┬︽繛瀛樼矒缁犳牕顫忓ú顏勭闁圭粯甯掓潏鍛存⒑缁嬫鍎愰柟鐟版喘瀵顓兼径濠勵槯婵犮垼娉涢敃锝嗙珶閺囥垺鈷掑ù锝囶焾閺嗛亶鏌涘Ο鑽ょ煉鐎规洘鍨块獮妯肩磼濡厧甯楅梻浣侯焾缁绘劙藝椤栨稓顩插Δ锝呭暞閳锋垿鏌涢幇顓炵祷閻㈩垬鍔戦弻娑氣偓锝庡亝瀹曞矂鏌＄仦鐣屝х€规洘顨嗗鍕節娴ｅ壊妫?		new Setting(contentEl).setDesc(t("hybridModal.apiKeyNotice"));
		new Setting(contentEl)
			.setName(t("hybridModal.autoTriggerOnInput"))
			.setDesc(t("hybridModal.autoTriggerOnInput.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.hybrid.autoTriggerOnInput ?? true)
					.onChange((value) => {
						this.setting.hybrid.autoTriggerOnInput = value;
						this.settingManager.saveSettings();
						this.renderAutoTriggerDebounceSetting();
					}),
			);
		this.autoTriggerDebounceSettingEl = contentEl.createDiv();
		this.renderAutoTriggerDebounceSetting();

		new Setting(contentEl)
			.setName(t("hybridModal.weeklyTokenLimit"))
			.setDesc(t("hybridModal.weeklyTokenLimit.desc"))
			.addText((text) => {
				this.weeklyLimitInputEl = text.inputEl;
				text
					.setPlaceholder("0")
					.setValue(String(this.setting.hybrid.weeklyTokenLimit ?? 0));
				text.inputEl.type = "number";
				text.inputEl.min = "0";
				text.inputEl.step = "1";
				text.inputEl.addEventListener("blur", () => {
					void this.updateWeeklyTokenLimit();
				});
			});
		this.weeklyQuotaEl = contentEl.createDiv();
		this.weeklyQuotaEl.style.margin = "0.35em 0 1em 0";
		this.weeklyQuotaEl.setText(t("hybridModal.tokenStats.loading"));

		new Setting(contentEl)
			.setName(t("hybridModal.maxResultCount"))
			.setDesc(t("hybridModal.maxResultCount.desc"))
			.addSlider((slider) =>
				slider
					.setLimits(1, 30, 1)
					.setValue(this.setting.hybrid.maxResultCount ?? 10)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.setting.hybrid.maxResultCount = value;
						await this.settingManager.saveSettings();
					}),
			);

		// Excluded paths
		if (isDevEnvironment) {
			new Setting(contentEl)
				.setName(
					formatDevOnlySettingName(
						t("hybridModal.minIncrementalEmbedInterval"),
					),
				)
				.setDesc(t("hybridModal.minIncrementalEmbedInterval.desc"))
				.addSlider((slider) =>
					slider
						.setLimits(1, 60, 1)
						.setValue(
							Math.max(
								1,
								Math.round(
									(this.setting.hybrid.minIncrementalEmbedIntervalSec ??
										180) / 60,
								),
							),
						)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.setting.hybrid.minIncrementalEmbedIntervalSec = value * 60;
							await this.settingManager.saveSettings();
						}),
				);

			new Setting(contentEl)
				.setName(
					formatDevOnlySettingName(
						t("hybridModal.failedEmbeddingRetryInterval"),
					),
				)
				.setDesc(t("hybridModal.failedEmbeddingRetryInterval.desc"))
				.addSlider((slider) =>
					slider
						.setLimits(5, 60, 1)
						.setValue(this.setting.hybrid.failedEmbeddingRetryIntervalMin ?? 10)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.setting.hybrid.failedEmbeddingRetryIntervalMin = value;
							await this.settingManager.saveSettings();
							getInstance(DataManager).refreshFailedEmbeddingRetrySchedule();
							await this.refreshHybridRuntimeStatusFromData();
						}),
				);
			this.failedEmbeddingStatusEl = contentEl.createDiv();
			this.failedEmbeddingStatusEl.style.margin = "0.35em 0 1em 0";
			this.failedEmbeddingStatusEl.setText(t("hybridModal.tokenStats.loading"));
			this.deferredEmbeddingStatusEl = contentEl.createDiv();
			this.deferredEmbeddingStatusEl.style.margin = "0 0 1em 0";
			this.deferredEmbeddingStatusEl.setText(t("hybridModal.tokenStats.loading"));

			contentEl.createEl("h3", {
				text: formatDevOnlySettingName(t("hybridModal.healthSummary")),
			});
			contentEl.createEl("p", { text: t("hybridModal.healthSummary.localOnly") });
			new Setting(contentEl).addButton((button) =>
				button.setButtonText(t("hybridModal.healthSummary.check")).onClick(
					() => {
						openHybridHealthSummaryModal(this.app);
					},
				),
			);
		} else {
			this.failedEmbeddingStatusEl = contentEl.createDiv();
			this.failedEmbeddingStatusEl.style.display = "none";
			this.deferredEmbeddingStatusEl = contentEl.createDiv();
			this.deferredEmbeddingStatusEl.style.display = "none";
		}

		new Setting(contentEl)
			.setName(t("hybridModal.vectorCompression"))
			.setDesc(t("hybridModal.vectorCompression.desc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						int8: t("hybridModal.vectorCompression.int8"),
						float16: t("hybridModal.vectorCompression.float16"),
					})
					.setValue(this.setting.hybrid.vectorCompression ?? "int8")
					.onChange((value) => {
						this.setting.hybrid.vectorCompression =
							value === "float16" ? "float16" : "int8";
						this.settingManager.requestHybridFullReindex();
						this.settingManager.saveSettings();
					}),
			);

		contentEl.createEl("h3", { text: t("hybridModal.excludedPaths") });
		this.excludesEl = contentEl.createDiv();
		this.renderExcludedList(this.excludesEl);

		new Setting(contentEl)
			.addText((text) => {
				this.inputEl = text.inputEl;
				text.inputEl.onfocus = () => {
					this.suggester?.close();
					this.suggester?.open();
				};
				text.setPlaceholder(t("Enter path...")).onChange(() => {
					this.suggester.close();
					this.suggester.open();
				});
			})
			.addButton((btn) =>
				btn.setButtonText(t("Add")).onClick(() => {
					this.addPath(this.inputEl.value);
				}),
			);

		// Autocomplete: exclude paths already in the hybrid exclusion list
		const hybridExcluded = new Set(this.setting.hybrid.excludedPaths ?? []);
		const availablePaths = new Set(
			[...this.allPaths].filter((p) => {
				// Remove paths that are already excluded or are sub-paths of excluded entries
				for (const ex of hybridExcluded) {
					if (p === ex || p.startsWith(ex + "/")) return false;
				}
				return true;
			}),
		);

		this.suggester = new CommonSuggester(
			this.inputEl,
			availablePaths,
			(v) => { this.addPath(v); },
		);

		// Token usage stats
		contentEl.createEl("h3", { text: t("hybridModal.tokenStats") });
		this.statsEl = contentEl.createDiv();
		this.statsEl.setText(t("hybridModal.tokenStats.loading"));
		void this.refreshHybridRuntimeStatusFromData();
		void this.refreshTokenStats();
	}

	onClose() {
		void this.updateWeeklyTokenLimit();
		eventBus.off(
			EventEnum.HYBRID_RUNTIME_STATUS_CHANGED,
			this.failedEmbeddingStatusListener,
		);
		if (this.failedEmbeddingStatusTimer !== null) {
			window.clearInterval(this.failedEmbeddingStatusTimer);
			this.failedEmbeddingStatusTimer = null;
		}
		const providerChanged =
			(this.openedApiDomain ?? "") !== (this.setting.hybrid.apiDomain ?? "") ||
			(this.openedApiKey ?? "") !== (this.setting.hybrid.apiKey ?? "");
		if (providerChanged) {
			void getInstance(DataManager).retryFailedEmbeddingsOnConfigChange(
				"provider-config-changed",
			);
		}
		void this.settingManager.postSettingUpdated();
	}

	private renderExcludedList(listEl: HTMLElement) {
		listEl.empty();
		const paths = this.setting.hybrid.excludedPaths ?? [];
		paths.forEach((path, index) => {
			const row = listEl.createDiv();
			row.style.cssText = "display:flex;justify-content:space-between;margin:0.5em 0;overflow:auto;";
			const span = row.createSpan({ text: path });
			span.style.cssText = "width:90%;overflow:auto;";
			const del = row.createSpan({ text: "x" });
			del.style.cursor = "pointer";
			del.onClickEvent(() => {
				paths.splice(index, 1);
				this.settingManager.requestHybridLocalRefresh({
					syncFileSetWithoutEmbedding: true,
				});
				this.settingManager.saveSettings();
				this.renderExcludedList(listEl);
			});
		});
	}

	private addPath(inputPath: string) {
		const paths = this.setting.hybrid.excludedPaths ?? [];
		if (inputPath && !paths.includes(inputPath)) {
			if (!this.allPaths.has(inputPath)) {
				new MyNotice(`Path doesn't exist: ${inputPath}`, 5000);
			} else {
				paths.push(inputPath);
				this.setting.hybrid.excludedPaths = paths;
				this.settingManager.requestHybridLocalRefresh({
					syncFileSetWithoutEmbedding: true,
				});
				this.settingManager.saveSettings();
				this.renderExcludedList(this.excludesEl);
				this.inputEl.value = "";
			}
		}
	}

	private renderAutoTriggerDebounceSetting() {
		if (!this.autoTriggerDebounceSettingEl) {
			return;
		}
		this.autoTriggerDebounceSettingEl.empty();
		if (!(this.setting.hybrid.autoTriggerOnInput ?? true)) {
			return;
		}

		new Setting(this.autoTriggerDebounceSettingEl)
			.setName(t("hybridModal.autoTriggerDebounceMs"))
			.setDesc(t("hybridModal.autoTriggerDebounceMs.desc"))
			.addSlider((slider) =>
				slider
					.setLimits(200, 5000, 100)
					.setValue(this.normalizeAutoTriggerDebounceMs())
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.setting.hybrid.autoTriggerDebounceMs = value;
						await this.settingManager.saveSettings();
					}),
			);
	}

	private normalizeAutoTriggerDebounceMs(): number {
		const value = this.setting.hybrid.autoTriggerDebounceMs ?? 400;
		if (!Number.isFinite(value)) {
			return 400;
		}
		return Math.min(5000, Math.max(200, Math.round(value / 100) * 100));
	}


	private async updateWeeklyTokenLimit() {
		if (!this.weeklyLimitInputEl) {
			return;
		}
		const parsed = parseInt(this.weeklyLimitInputEl.value, 10);
		const nextValue = Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
		const prevValue = this.setting.hybrid.weeklyTokenLimit ?? 0;
		this.setting.hybrid.weeklyTokenLimit = nextValue;
		this.weeklyLimitInputEl.value = String(nextValue);
		if (nextValue === prevValue) {
			return;
		}
		await this.settingManager.saveSettings();

		const used = await getCurrentWeekTokenUsage();
		if (
			nextValue > 0 &&
			used >= nextValue
		) {
			new MyNotice(t("hybridModal.weeklyLimitExceededNotice"), 5000);
		}

		await getInstance(DataManager).retryFailedEmbeddingsOnConfigChange(
			"weekly-token-limit-updated",
		);
		await this.refreshHybridRuntimeStatusFromData();
		await this.refreshTokenStats();
	}

	private async checkHybridApiConnectivity() {
		const rawDomain =
			this.hybridApiDomainInputEl?.value?.trim() ||
			this.setting.hybrid.apiDomain ||
			"dashscope.aliyuncs.com";
		const apiKey =
			this.hybridApiKeyInputEl?.value?.trim() || this.setting.hybrid.apiKey;
		if (!apiKey) {
			new MyNotice(t("hybridModal.connectivityMissingApiKey"), 5000);
			return;
		}
		const url = buildDashScopeApiUrl(rawDomain, "embedding");
		const controller = new AbortController();
		const timeoutId = window.setTimeout(() => controller.abort(), 10_000);
		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model: "text-embedding-v4",
					input: ["connectivity-check"],
					dimensions: 1024,
					encoding_format: "float",
				}),
				signal: controller.signal,
			});
			if (!response.ok) {
				const body = await response.text();
				const details = buildHybridProviderErrorDetails(
					response.status,
					body,
					response.headers.get("Retry-After"),
				);
				const reason = details.providerMessage ?? `${response.status} ${body}`.trim();
				new MyNotice(
					`${t("hybridModal.connectivityFailed")}: ${
						details.requestId
							? `${reason} (request_id: ${details.requestId})`
							: reason
					}`.slice(
						0,
						240,
					),
					7000,
				);
				return;
			}
			const body = await response.text();
			this.validateHybridConnectivityEmbeddingResponse(body);
			new MyNotice(t("hybridModal.connectivityOk"), 4000);
		} catch (error) {
			const issue = buildHybridSearchIssue(error);
			const message =
				error instanceof DOMException && error.name === "AbortError"
					? "Embedding API connectivity check timed out after 10 seconds"
					: issue.message ||
						(error instanceof Error ? error.message : String(error));
			new MyNotice(
				`${t("hybridModal.connectivityFailed")}: ${message}`.slice(0, 240),
				7000,
			);
		} finally {
			window.clearTimeout(timeoutId);
		}
	}

	private validateHybridConnectivityEmbeddingResponse(body: string): void {
		const trimmed = body.trim();
		if (!trimmed) {
			throw new Error("Embedding API returned an empty response");
		}

		const parsed = JSON.parse(trimmed) as {
			data?: Array<{ embedding?: unknown }>;
		};
		if (!Array.isArray(parsed.data) || parsed.data.length === 0) {
			throw new Error("Embedding API response missing embedding result");
		}

		const embedding = parsed.data.find((item) => Array.isArray(item?.embedding))
			?.embedding;
		if (!Array.isArray(embedding)) {
			throw new Error("Embedding API response missing embedding vector");
		}
		if (embedding.length === 0) {
			throw new Error("Embedding API response returned an empty vector");
		}
		if (!embedding.every((value) => typeof value === "number" && Number.isFinite(value))) {
			throw new Error("Embedding API response contains non-finite vector values");
		}
	}

	private async refreshTokenStats() {
		await this.loadTokenStats(this.statsEl);
	}

	private async refreshHybridRuntimeStatusFromData() {
		const dataManager = getInstance(DataManager);
		[this.currentFailedEmbeddingSummary, this.currentDeferredEmbeddingSummary] =
			await Promise.all([
			dataManager.getHybridFailedEmbeddingSummary(),
			dataManager.getHybridDeferredEmbeddingSummary(),
		]);
		this.renderHybridRuntimeStatus();
	}

	private renderHybridRuntimeStatus() {
		if (this.currentFailedEmbeddingSummary) {
			this.renderFailedEmbeddingStatus(this.currentFailedEmbeddingSummary);
		}
		if (this.currentDeferredEmbeddingSummary) {
			this.renderDeferredEmbeddingStatus(this.currentDeferredEmbeddingSummary);
		}
	}

	private renderFailedEmbeddingStatus(
		summary: HybridFailedEmbeddingSummary,
	) {
		this.failedEmbeddingStatusEl.empty();
		this.appendStatusLine(
			this.failedEmbeddingStatusEl,
			t("hybridModal.failedEmbeddingStatus.summary"),
			String(summary.failedCount),
		);

		if (summary.failedCount === 0) {
			return;
		}

		if (summary.blockingKinds.length > 0) {
			this.appendStatusLine(
				this.failedEmbeddingStatusEl,
				t("hybridModal.failedEmbeddingStatus.blocked"),
				this.formatFailedEmbeddingKinds(summary.blockingKinds),
			);
		}

		if (summary.retryableKinds.length > 0) {
			this.appendStatusLine(
				this.failedEmbeddingStatusEl,
				t("hybridModal.failedEmbeddingStatus.retrying"),
				this.formatFailedEmbeddingKinds(summary.retryableKinds),
			);
		}

		if (summary.retryableCount > 0 && summary.nextRetryAt !== null) {
			this.appendStatusLine(
				this.failedEmbeddingStatusEl,
				t("hybridModal.failedEmbeddingStatus.nextRetry"),
				this.formatRelativeTime(summary.nextRetryAt),
			);
		}
	}

	private renderDeferredEmbeddingStatus(
		summary: HybridDeferredEmbeddingSummary,
	) {
		this.deferredEmbeddingStatusEl.empty();
		this.appendStatusLine(
			this.deferredEmbeddingStatusEl,
			t("hybridModal.deferredEmbeddingStatus.summary"),
			String(summary.deferredCount),
		);
		if (summary.deferredCount === 0) {
			return;
		}

		if (summary.readyCount > 0) {
			this.appendStatusLine(
				this.deferredEmbeddingStatusEl,
				t("hybridModal.deferredEmbeddingStatus.ready"),
				String(summary.readyCount),
			);
		}

		if (summary.nextEligibleAt !== null) {
			const isReady = summary.nextEligibleAt <= Date.now();
			this.appendStatusLine(
				this.deferredEmbeddingStatusEl,
				isReady
					? t("hybridModal.deferredEmbeddingStatus.resumeState")
					: t("hybridModal.deferredEmbeddingStatus.nextResume"),
				isReady
					? t("hybridModal.deferredEmbeddingStatus.readyState")
					: this.formatRelativeTime(summary.nextEligibleAt),
			);
		}
	}

	private appendStatusText(container: HTMLElement, text: string) {
		container.createEl("p", { text });
	}

	private appendStatusLine(
		container: HTMLElement,
		label: string,
		value: string,
	) {
		this.appendStatusText(container, `${label}: ${value}`);
	}

	private formatFailedEmbeddingKinds(
		items: Array<{ kind: string; count: number }>,
	): string {
		return items
			.map(
				(item) =>
					`${t(`hybridModal.failedEmbeddingReason.${item.kind}` as any)} x${item.count}`,
			)
			.join(" | ");
	}

	private async loadTokenStats(container: HTMLElement) {
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
		const { fromDate: weeklyFrom, toDate: weeklyTo } =
			getCurrentWeekDateRange(now);
		const monthlyFrom = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
		const totalFrom = "0000-01-01";

		const [
			dailyTop,
			weeklyTop,
			monthlyTop,
			totalTop,
			dailyTotal,
			weeklyTotal,
			monthlyTotal,
			totalUsed,
			weeklyBudgetUsed,
			savingsSummary,
		] = await Promise.all([
			getTopTokenFiles(todayKey, todayKey, 20),
			getTopTokenFiles(weeklyFrom, weeklyTo, 20),
			getTopTokenFiles(monthlyFrom, todayKey, 20),
			getTopTokenFiles(totalFrom, todayKey, 20),
			getTotalTokens(todayKey, todayKey),
			getTotalTokens(weeklyFrom, weeklyTo),
			getTotalTokens(monthlyFrom, todayKey),
			getTotalTokens(totalFrom, todayKey),
			getCurrentWeekTokenUsage(),
			getEstimatedTokenSavingsSummary(),
		]);

		container.empty();
		this.renderWeeklyQuotaSummary(weeklyBudgetUsed);
		container.createEl("p", {
			text:
				`${t("hybridModal.todayUsed")}: ${this.formatTokenCompact(dailyTotal)}  |  ` +
				`${t("hybridModal.thisWeekUsed")}: ${this.formatTokenCompact(weeklyTotal)}  |  ` +
				`${t("hybridModal.thisMonthUsed")}: ${this.formatTokenCompact(monthlyTotal)}  |  ` +
				`${t("hybridModal.totalUsed")}: ${this.formatTokenCompact(totalUsed)}`,
		});
		container.createEl("p", {
			text:
				`${t("hybridModal.estimatedSavings.weekly")}` +
				`${this.formatTokenCompact(savingsSummary.week)} token  |  ` +
				`${t("hybridModal.estimatedSavings.total")}` +
				`${this.formatTokenCompact(savingsSummary.total)} token`,
		});
		this.renderTokenTabs(container, [
			{ title: t("hybridModal.dailyTop"), items: dailyTop },
			{ title: t("hybridModal.weeklyTop"), items: weeklyTop },
			{ title: t("hybridModal.monthlyTop"), items: monthlyTop },
			{ title: t("hybridModal.totalTop"), items: totalTop },
		]);
	}

	private renderWeeklyQuotaSummary(used: number) {
		this.weeklyQuotaEl.empty();
		const limit = this.setting.hybrid.weeklyTokenLimit ?? 0;
		const remaining = limit > 0 ? Math.max(0, limit - used) : Infinity;
		const row = this.weeklyQuotaEl.createDiv();
		row.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;";
		row.createEl("span", {
			text:
				`${t("hybridModal.weeklyRemaining")}: ` +
				(limit > 0
					? this.formatTokenCompact(remaining)
					: t("hybridModal.unlimited")),
		});
		const resetButton = row.createEl("button", {
			text: t("hybridModal.resetQuota"),
		});
		resetButton.addEventListener("click", () => {
			void (async () => {
				await resetCurrentWeekTokenUsage();
				await getInstance(DataManager).retryFailedEmbeddingsOnConfigChange(
					"weekly-token-limit-updated",
				);
				await this.refreshHybridRuntimeStatusFromData();
				await this.refreshTokenStats();
			})();
		});
	}

	private renderTopList(
		parent: HTMLElement,
		title: string,
		items: Array<{ filePath: string; tokens: number }>,
	) {
		parent.createEl("h4", { text: title });
		if (items.length === 0) {
			parent.createEl("p", { text: t("hybridModal.noData") });
			return;
		}
		const rankedItems = this.sortTokenStatItems(items);
		const table = parent.createEl("table");
		table.style.cssText = "width:100%;border-collapse:collapse;font-size:0.85em;";
		const header = table.createEl("tr");
		["#", t("hybridModal.file"), t("hybridModal.tokens")].forEach((h) => {
			const th = header.createEl("th", { text: h });
			th.style.cssText = "text-align:left;padding:2px 6px;border-bottom:1px solid var(--background-modifier-border);";
		});
		rankedItems.forEach(({ filePath, tokens }, i) => {
			const tr = table.createEl("tr");
			const displayIndex = this.isPinnedTokenStat(filePath) ? "0" : String(i);
			const displayPath = this.isPinnedTokenStat(filePath)
				? `${filePath} (${t("hybridModal.tokenStats.pinned")})`
				: filePath;
			[displayIndex, displayPath, this.formatTokenCompact(tokens)].forEach((cell) => {
				const td = tr.createEl("td", { text: cell });
				td.style.cssText = "padding:2px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:30vw;";
			});
		});
	}

	private sortTokenStatItems(
		items: Array<{ filePath: string; tokens: number }>,
	): Array<{ filePath: string; tokens: number }> {
		return [...items].sort((left, right) => {
			const leftPinned = this.isPinnedTokenStat(left.filePath);
			const rightPinned = this.isPinnedTokenStat(right.filePath);
			if (leftPinned !== rightPinned) {
				return leftPinned ? -1 : 1;
			}
			return right.tokens - left.tokens;
		});
	}

	private isPinnedTokenStat(filePath: string): boolean {
		return filePath === SEARCH_RERANK_TOKEN_KEY;
	}

	private renderTokenTabs(
		parent: HTMLElement,
		tabs: Array<{
			title: string;
			items: Array<{ filePath: string; tokens: number }>;
		}>,
	) {
		const tabRow = parent.createDiv();
		tabRow.style.cssText = "display:flex;gap:8px;margin:0.75em 0 0.5em 0;flex-wrap:wrap;";
		const panelEl = parent.createDiv();
		let activeIndex = 1;

		const renderActiveTab = () => {
			panelEl.empty();
			Array.from(tabRow.children).forEach((child, index) => {
				const button = child as HTMLButtonElement;
				button.style.backgroundColor =
					index === activeIndex
						? "var(--interactive-accent)"
						: "var(--background-secondary)";
				button.style.color =
					index === activeIndex
						? "var(--text-on-accent)"
						: "var(--text-normal)";
			});
			this.renderTopList(
				panelEl,
				tabs[activeIndex].title,
				tabs[activeIndex].items,
			);
		};

		tabs.forEach((tab, index) => {
			const button = tabRow.createEl("button", { text: tab.title });
			button.style.cssText =
				"flex:0 0 auto;padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:6px;cursor:pointer;white-space:nowrap;";
			button.onClickEvent(() => {
				activeIndex = index;
				renderActiveTab();
			});
		});

		renderActiveTab();
	}

	private formatTokenCompact(value: number): string {
		if (value >= 1_000_000) {
			return this.stripTrailingZero((value / 1_000_000).toFixed(1)) + "M";
		}
		if (value >= 1_000) {
			return this.stripTrailingZero((value / 1_000).toFixed(1)) + "K";
		}
		return value.toString();
	}

	private formatBytes(value: number): string {
		if (value >= 1024 * 1024) {
			return this.stripTrailingZero((value / (1024 * 1024)).toFixed(1)) + " MB";
		}
		if (value >= 1024) {
			return this.stripTrailingZero((value / 1024).toFixed(1)) + " KB";
		}
		return `${value} B`;
	}

	private formatRelativeTime(targetAt: number): string {
		const remainingMs = Math.max(0, targetAt - Date.now());
		const totalSeconds = Math.ceil(remainingMs / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes} min ${seconds} s`;
	}

	private stripTrailingZero(value: string): string {
		return value.replace(/\.0$/, "");
	}
}

class ExcludePathModal extends Modal {
	private settingManager = getInstance(SettingManager);
	private setting = getInstance(OuterSetting);
	private excludedPaths = this.setting.excludedPaths;
	private allPaths = new Set<string>();
	private allFolders = new Set<string>();

	private excludesEl: HTMLElement;
	private inputEl: HTMLInputElement;
	private suggester: CommonSuggester;

	constructor(app: App) {
		super(app);
		const allAbstractFiles = getInstance(Vault).getAllLoadedFiles();
		for (const aFile of allAbstractFiles) {
			this.allPaths.add(aFile.path);
			if (aFile instanceof TFolder) {
				this.allFolders.add(aFile.path);
			}
		}
	}

	onOpen() {
		this.modalEl.style.width = "48vw";
		this.modalEl.style.marginBottom = "5em";
		this.modalEl.querySelector(".modal-close-button")?.remove();
		const contentEl = this.contentEl;
		new Setting(contentEl)
			.setName(t("Follow Obsidian Excluded Files"))
			.addToggle((t) =>
				t
					.setValue(this.setting.followObsidianExcludedFiles)
					.onChange((v) => {
						this.setting.followObsidianExcludedFiles = v;
						this.settingManager.requestLexicalReindex();
						this.settingManager.requestHybridLocalRefresh({
							syncFileSetWithoutEmbedding: true,
						});
					}),
			);
		contentEl.createEl("h2", { text: t("Excluded files") });
		this.excludesEl = contentEl.createDiv();
		this.renderExcludedList(this.excludesEl);

		new Setting(contentEl)
			.addText((text) => {
				this.inputEl = text.inputEl;
				text.setPlaceholder(t("Enter path...")).onChange((value) => {
					this.suggester.close();
					this.suggester.open();
				});
			})
			.addButton((btn) => {
				btn.setButtonText(t("Add")).onClick(() => {
					this.addPath(this.inputEl.value);
				});
			});

		this.suggester = new CommonSuggester(
			this.inputEl,
			this.allFolders,
			(v) => {
				this.addPath(v);
			},
		);
		setTimeout(() => {
			this.inputEl.focus();
		}, 1);
	}

	private renderExcludedList(listEl: HTMLElement) {
		listEl.empty();

		this.excludedPaths.forEach((path, index) => {
			const pathDiv = listEl.createDiv();
			pathDiv.style.overflow = "auto";
			pathDiv.style.display = "flex";
			pathDiv.style.margin = "0.7em 0 0.7em 0";
			pathDiv.style.justifyContent = "space-between";

			const pathText = pathDiv.createSpan();
			pathText.setText(path);
			pathText.style.width = "90%";
			pathText.style.overflow = "auto";

			const span = pathDiv.createSpan();
			span.setText("x");
			span.style.cursor = "pointer";
			span.onClickEvent(() => {
				this.excludedPaths.splice(index, 1);
				this.settingManager.requestLexicalReindex();
				this.settingManager.requestHybridLocalRefresh({
					syncFileSetWithoutEmbedding: true,
				});
				this.renderExcludedList(listEl);
			});
		});
	}

	private addPath(inputPath: string) {
		if (inputPath && !this.excludedPaths.includes(inputPath)) {
			if (!this.allPaths.has(inputPath)) {
				new MyNotice(`Path doesn't exist: ${inputPath}`, 5000);
			} else {
				this.excludedPaths.push(inputPath);
				this.settingManager.requestLexicalReindex();
				this.settingManager.requestHybridLocalRefresh({
					syncFileSetWithoutEmbedding: true,
				});
				this.renderExcludedList(this.excludesEl);
			}
		}
	}
}

class CustomExtensionModal extends Modal {
	private setting = getInstance(OuterSetting);
	private settingManager = getInstance(SettingManager);
	onOpen(): void {
		this.modalEl.style.width = "60vw";
		this.modalEl.querySelector(".modal-close-button")?.remove();
		const contentEl = this.contentEl;

		new Setting(contentEl).setDesc(t("extensionModal.desc"));
		new Setting(contentEl)
			.setName(t("extensionModal.plaintextName"))
			.setDesc(t("extensionModal.plaintextDesc"))
			.addTextArea((textArea) => {
				textArea.inputEl.style.minWidth = "20vw";
				textArea.inputEl.style.minHeight = "20vh";
				textArea.setValue(
					this.setting.customExtensions.plaintext.join(" "),
				);

				textArea.onChange((newValue) => {
					const extensions = newValue
						.split(/[\s\n]+/)
						.map((ext) =>
							ext.startsWith(".") ? ext.substring(1) : ext,
						)
						.filter((ext) => ext.length > 0);

					this.setting.customExtensions.plaintext = extensions;
					this.settingManager.requestLexicalReindex();
					this.settingManager.requestHybridLocalRefresh({
						syncFileSetWithoutEmbedding: true,
					});
				});
			});

		new Setting(contentEl).setName("Image").setDesc("Todo");
	}
}
