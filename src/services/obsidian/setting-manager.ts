import {
	App,
	Modal,
	PluginSettingTab,
	Setting,
	TFolder,
	Vault,
} from "obsidian";
import { ICON_COLLAPSE, ICON_EXPAND, THIS_PLUGIN } from "src/globals/constants";
import {
	DEFAULT_OUTER_SETTING,
	OuterSetting,
	type FileSearchBackend,
	type LogLevelOptions,
	type SearchHistoryMaxItems,
} from "src/globals/plugin-setting";
import { ChinesePatch } from "src/integrations/languages/chinese-patch";
import type CleverSearch from "src/main";
import {
	getCurrentWeekDateRange,
	getCurrentWeekTokenUsage,
	getTopTokenFiles,
	getTotalTokens,
} from "src/services/search/hybrid/embedder";
import { FloatingWindowManager } from "src/ui/floating-window";
import { logger, type LogLevel } from "src/utils/logger";
import { MyLib, getInstance } from "src/utils/my-lib";
import { AssetsProvider } from "src/utils/web/assets-provider";
import { container, inject, singleton } from "tsyringe";
import { CommonSuggester, MyNotice } from "./transformed-api";
import { t } from "./translations/locale-helper";
import { DataManager } from "./user-data/data-manager";
import { DataProvider } from "./user-data/data-provider";
import { SearchHistoryService } from "./user-data/search-history-service";
import { ViewRegistry } from "./view-registry";

@singleton()
export class SettingManager {
	private plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private setting: OuterSetting;
	shouldReload = false;

	async initAsync() {
		await this.loadSettings(); // must run this line before registering PluginSetting
		container.register(OuterSetting, { useValue: this.setting });
		this.plugin.addSettingTab(getInstance(GeneralTab));
	}

	// NOTE: this.plugin.saveData() can't handle Set
	async saveSettings() {
		await this.plugin.saveData(this.setting);
	}

	async postSettingUpdated() {
		this.saveSettings();

		if (this.shouldReload) {
			this.shouldReload = false;
			await this.downloadAndRefresh();
		}
	}

	private async loadSettings() {
		// shallow merge can't handle nested object correctly
		// this.setting = Object.assign(
		// 	{},
		// 	DEFAULT_OUTER_SETTING,
		// 	await this.plugin.loadData(),
		// );
		this.setting = MyLib.mergeDeep(
			DEFAULT_OUTER_SETTING,
			await this.plugin.loadData(),
		);
		logger.setLevel(this.setting.logLevel);
	}

	private async downloadAndRefresh() {
		getInstance(ViewRegistry).refreshAll();
		await getInstance(AssetsProvider).initAsync();
		await getInstance(ChinesePatch).initAsync();

		getInstance(DataProvider).init();
		await getInstance(DataManager).refreshAllAsync();
	}
}

@singleton()
class GeneralTab extends PluginSettingTab {
	private readonly settingManager = getInstance(SettingManager);
	private readonly setting = getInstance(OuterSetting);
	private readonly searchHistoryService = getInstance(SearchHistoryService);
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
			.setName(t("Max items count"))
			.setDesc(t("Max items count desc"))
			.addSlider((text) =>
				text
					.setLimits(1, 300, 1)
					.setValue(this.setting.ui.maxItemResults)
					.setDynamicTooltip()
					.onChange((value) => {
						this.setting.ui.maxItemResults = value;
					}),
			);

		new Setting(containerEl)
			.setName(t("Floating window for in-file search"))
			.setDesc(t("Floating window for in-file search desc"))
			.addToggle((t) =>
				t
					.setValue(this.setting.ui.floatingWindowForInFile)
					.onChange(
						(v) => (this.setting.ui.floatingWindowForInFile = v),
					),
			);

		new Setting(containerEl)
			.setName(t("Search history"))
			.setDesc(t("Search history desc"));

		new Setting(containerEl)
			.setName(t("Enable search history"))
			.setDesc(t("Enable search history desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.searchHistory.enabled)
					.onChange((value) => {
						this.setting.searchHistory.enabled = value;
					}),
			);

		new Setting(containerEl)
			.setName(t("Search history suggestions"))
			.setDesc(t("Search history suggestions desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.searchHistory.showSuggestions)
					.onChange((value) => {
						this.setting.searchHistory.showSuggestions = value;
					}),
			);

		new Setting(containerEl)
			.setName(t("Search history ghost completion"))
			.setDesc(t("Search history ghost completion desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.searchHistory.enableGhostCompletion)
					.onChange((value) => {
						this.setting.searchHistory.enableGhostCompletion = value;
					}),
			);

		new Setting(containerEl)
			.setName(t("Search history max items"))
			.setDesc(t("Search history max items desc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						20: "20",
						50: "50",
						100: "100",
					})
					.setValue(String(this.setting.searchHistory.maxItems))
					.onChange((value) => {
						this.setting.searchHistory.maxItems =
							Number(value) as SearchHistoryMaxItems;
					}),
			);

		new Setting(containerEl)
			.setName(t("Clear search history"))
			.setDesc(
				`${t("Clear search history desc")} (${this.searchHistoryService.getEntryCount()})`,
			)
			.addButton((button) =>
				button.setButtonText(t("Clear")).onClick(async () => {
					await this.searchHistoryService.clearHistory();
					this.display();
				}),
			);

		new Setting(containerEl).setName(t("Case sensitive")).addToggle((t) =>
			t.setValue(this.setting.isCaseSensitive).onChange((v) => {
				this.setting.isCaseSensitive = v;
				this.settingManager.shouldReload = true;
			}),
		);
		new Setting(containerEl)
			.setName(t("Prefix match"))
			.addToggle((t) =>
				t
					.setValue(this.setting.isPrefixMatch)
					.onChange((v) => (this.setting.isPrefixMatch = v)),
			);

		new Setting(containerEl)
			.setName(t("Character fuzzy allowed"))
			.addToggle((t) =>
				t
					.setValue(this.setting.isFuzzy)
					.onChange((v) => (this.setting.isFuzzy = v)),
			);

		new Setting(containerEl)
			.setName(t("File search backend"))
			.setDesc(t("File search backend desc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						minisearch: t("fileSearchBackend.minisearch"),
						"custom-bm25": t("fileSearchBackend.customBm25"),
					})
					.setValue(this.setting.fileSearchBackend)
					.onChange((value) => {
						this.setting.fileSearchBackend = value as FileSearchBackend;
						this.settingManager.shouldReload = true;
					}),
			);

		new Setting(containerEl)
			.setName(t("English word blacklist"))
			.setDesc(t("English word blacklist desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.enableStopWordsEn)
					.onChange((value) => {
						this.setting.enableStopWordsEn = value;
						this.settingManager.shouldReload = true;
					}),
			);

		new Setting(containerEl)
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
						this.settingManager.shouldReload = true;
					}),
			);

		new Setting(containerEl)
			.setName(t("Chinese word blacklist"))
			.setDesc(t("Chinese word blacklist desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.enableStopWordsZh)
					.onChange(async (value) => {
						this.setting.enableStopWordsZh = value;
						this.settingManager.shouldReload = true;
					}),
			);
		new Setting(containerEl)
			.setName(t("Advanced"))
			.setDesc(t("Advanced.desc"));

		new Setting(containerEl)
			.setName(t("Hybrid search"))
			.setDesc(t("Hybrid search desc"))
			.addButton((b) =>
				b.setButtonText(t("Manage")).onClick(() => {
					new HybridSearchModal(getInstance(App)).open();
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

		// 点击标题时切换设置组的显示状态，并更新伪元素的图标
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
					// 不能用大写的字符串作为key...
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

class HybridSearchModal extends Modal {
	private settingManager = getInstance(SettingManager);
	private setting = getInstance(OuterSetting);
	private allPaths = new Set<string>();
	private allFolders = new Set<string>();
	private excludesEl: HTMLElement;
	private inputEl: HTMLInputElement;
	private suggester: CommonSuggester;
	private weeklyLimitInputEl: HTMLInputElement;
	private indexConcurrencyInputEl: HTMLInputElement;
	private weeklyQuotaEl: HTMLElement;
	private statsEl: HTMLElement;

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
		this.modalEl.style.width = "56vw";
		this.modalEl.style.marginBottom = "5em";
		this.modalEl.querySelector(".modal-close-button")?.remove();
		const contentEl = this.contentEl;

		// ── Introduction ──────────────────────────────────────────────────────
		new Setting(contentEl).setDesc(t("hybridModal.desc"));

		// ── Enable ────────────────────────────────────────────────────────────
		new Setting(contentEl)
			.setName(t("Enable"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.setting.hybrid.enabled)
					.onChange((v) => {
						this.setting.hybrid.enabled = v;
						this.settingManager.shouldReload = true;
						this.settingManager.saveSettings();
					}),
			);

		// ── API Domain ────────────────────────────────────────────────────────
		new Setting(contentEl)
			.setName(t("hybridModal.apiDomain"))
			.setDesc(t("hybridModal.apiDomain.desc"))
			.addText((text) =>
				text
					.setPlaceholder("dashscope.aliyuncs.com")
					.setValue(this.setting.hybrid.apiDomain)
					.onChange((v) => {
						this.setting.hybrid.apiDomain = v;
						this.settingManager.saveSettings();
					}),
			);

		// ── API Key ───────────────────────────────────────────────────────────
		new Setting(contentEl)
			.setName(t("hybridModal.apiKey"))
			.addText((text) => {
				text.inputEl.type = "password";
				text.inputEl.style.width = "100%";
				text
					.setPlaceholder("sk-...")
					.setValue(this.setting.hybrid.apiKey)
					.onChange((v) => {
						this.setting.hybrid.apiKey = v;
						this.settingManager.saveSettings();
					});
			});

		// ── Weekly token limit ────────────────────────────────────────────────
		new Setting(contentEl).setDesc(t("hybridModal.apiKeyNotice"));

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
			})
			.addButton((button) =>
				button.setButtonText(t("Update")).onClick(async () => {
					await this.updateWeeklyTokenLimit();
				}),
			);
		this.weeklyQuotaEl = contentEl.createDiv();
		this.weeklyQuotaEl.style.marginBottom = "1em";
		this.weeklyQuotaEl.setText(t("hybridModal.tokenStats.loading"));

		new Setting(contentEl)
			.setName(t("hybridModal.maxResultCount"))
			.setDesc(t("hybridModal.maxResultCount.desc"))
			.addSlider((slider) =>
				slider
					.setLimits(1, 30, 1)
					.setValue(this.setting.hybrid.maxResultCount ?? 5)
					.setDynamicTooltip()
					.onChange((value) => {
						this.setting.hybrid.maxResultCount = value;
						this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("hybridModal.indexConcurrency"))
			.setDesc(t("hybridModal.indexConcurrency.desc"))
			.addText((text) => {
				this.indexConcurrencyInputEl = text.inputEl;
				text
					.setPlaceholder("3")
					.setValue(String(this.setting.hybrid.indexConcurrency ?? 3));
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.inputEl.max = "8";
				text.inputEl.step = "1";
			})
			.addButton((button) =>
				button.setButtonText(t("Update")).onClick(async () => {
					await this.updateIndexConcurrency();
				}),
			);

		// ── Excluded paths ────────────────────────────────────────────────────
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
						this.settingManager.shouldReload = true;
						this.settingManager.saveSettings();
					}),
			);

		new Setting(contentEl)
			.setName(t("hybridModal.fileRankStrategy"))
			.setDesc(t("hybridModal.fileRankStrategy.desc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						bestPlusSupport: t("hybridModal.fileRankStrategy.bestPlusSupport"),
						bestChunk: t("hybridModal.fileRankStrategy.bestChunk"),
						sumTopChunks: t("hybridModal.fileRankStrategy.sumTopChunks"),
					})
					.setValue(
						this.setting.hybrid.fileRankStrategy ?? "bestPlusSupport",
					)
					.onChange((value) => {
						if (
							value === "bestChunk" ||
							value === "sumTopChunks" ||
							value === "bestPlusSupport"
						) {
							this.setting.hybrid.fileRankStrategy = value;
							this.settingManager.saveSettings();
						}
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

		// ── Token usage stats ─────────────────────────────────────────────────
		contentEl.createEl("h3", { text: t("hybridModal.tokenStats") });
		this.statsEl = contentEl.createDiv();
		this.statsEl.setText(t("hybridModal.tokenStats.loading"));
		void this.refreshTokenStats();
	}

	onClose() {
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
			const del = row.createSpan({ text: "✕" });
			del.style.cursor = "pointer";
			del.onClickEvent(() => {
				paths.splice(index, 1);
				this.settingManager.shouldReload = true;
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
				this.settingManager.shouldReload = true;
				this.settingManager.saveSettings();
				this.renderExcludedList(this.excludesEl);
				this.inputEl.value = "";
			}
		}
	}

	private async updateWeeklyTokenLimit() {
		const parsed = parseInt(this.weeklyLimitInputEl.value, 10);
		this.setting.hybrid.weeklyTokenLimit =
			Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
		this.weeklyLimitInputEl.value = String(this.setting.hybrid.weeklyTokenLimit);
		await this.settingManager.saveSettings();

		const used = await getCurrentWeekTokenUsage();
		if (
			this.setting.hybrid.weeklyTokenLimit > 0 &&
			used >= this.setting.hybrid.weeklyTokenLimit
		) {
			new MyNotice(t("hybridModal.weeklyLimitExceededNotice"), 5000);
		}

		await this.refreshTokenStats();
	}

	private async updateIndexConcurrency() {
		const parsed = parseInt(this.indexConcurrencyInputEl.value, 10);
		const nextValue =
			Number.isNaN(parsed) || parsed < 1 ? 3 : Math.min(parsed, 8);
		this.setting.hybrid.indexConcurrency = nextValue;
		this.indexConcurrencyInputEl.value = String(nextValue);
		await this.settingManager.saveSettings();
	}

	private async refreshTokenStats() {
		await this.loadTokenStats(this.statsEl);
	}

	private async loadTokenStats(container: HTMLElement) {
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
		const { fromDate: weeklyFrom, toDate: weeklyTo } =
			getCurrentWeekDateRange(now);
		const monthlyFrom = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;

		const [dailyTop, weeklyTop, monthlyTop, weeklyTotal] = await Promise.all([
			getTopTokenFiles(todayKey, todayKey, 20),
			getTopTokenFiles(weeklyFrom, weeklyTo, 20),
			getTopTokenFiles(monthlyFrom, todayKey, 20),
			getTotalTokens(weeklyFrom, weeklyTo),
		]);

		container.empty();
		this.renderWeeklyQuotaSummary(weeklyTotal);

		const limit = this.setting.hybrid.weeklyTokenLimit ?? 0;
		const limitText =
			limit > 0
				? `${weeklyTotal.toLocaleString()} / ${limit.toLocaleString()}`
				: `${weeklyTotal.toLocaleString()}`;
		container.createEl("p", {
			text: `${t("hybridModal.weeklyUsage")}: ${limitText}`,
		});
		this.renderTokenTabs(container, [
			{ title: t("hybridModal.dailyTop"), items: dailyTop },
			{ title: t("hybridModal.weeklyTop"), items: weeklyTop },
			{ title: t("hybridModal.monthlyTop"), items: monthlyTop },
		]);
	}

	private renderWeeklyQuotaSummary(used: number) {
		this.weeklyQuotaEl.empty();
		const limit = this.setting.hybrid.weeklyTokenLimit ?? 0;
		const remaining = limit > 0 ? Math.max(0, limit - used) : Infinity;
		this.weeklyQuotaEl.createEl("p", {
			text: `${t("hybridModal.weeklyUsed")}: ${this.formatTokenCompact(used)}`,
		});
		this.weeklyQuotaEl.createEl("p", {
			text:
				`${t("hybridModal.weeklyRemaining")}: ` +
				(limit > 0
					? this.formatTokenCompact(remaining)
					: t("hybridModal.unlimited")),
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
		const table = parent.createEl("table");
		table.style.cssText = "width:100%;border-collapse:collapse;font-size:0.85em;";
		const header = table.createEl("tr");
		["#", t("hybridModal.file"), t("hybridModal.tokens")].forEach((h) => {
			const th = header.createEl("th", { text: h });
			th.style.cssText = "text-align:left;padding:2px 6px;border-bottom:1px solid var(--background-modifier-border);";
		});
		items.forEach(({ filePath, tokens }, i) => {
			const tr = table.createEl("tr");
			[String(i + 1), filePath, this.formatTokenCompact(tokens)].forEach((cell) => {
				const td = tr.createEl("td", { text: cell });
				td.style.cssText = "padding:2px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:30vw;";
			});
		});
	}

	private renderTokenTabs(
		parent: HTMLElement,
		tabs: Array<{
			title: string;
			items: Array<{ filePath: string; tokens: number }>;
		}>,
	) {
		const tabRow = parent.createDiv();
		tabRow.style.cssText = "display:flex;gap:8px;margin:0.75em 0 0.5em 0;";
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
				"flex:1;padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:6px;cursor:pointer;";
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
						this.settingManager.shouldReload = true;
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
			span.setText("✕");
			span.style.cursor = "pointer";
			span.onClickEvent(() => {
				this.excludedPaths.splice(index, 1);
				this.settingManager.shouldReload = true;
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
				this.settingManager.shouldReload = true;
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
					this.settingManager.shouldReload = true;
				});
			});

		new Setting(contentEl).setName("Image").setDesc("Todo");
	}
}
