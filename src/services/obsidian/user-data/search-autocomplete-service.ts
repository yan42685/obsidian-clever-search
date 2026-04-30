import {
	App,
	TFile,
	Vault,
	parseFrontMatterAliases,
	type CachedMetadata,
} from "obsidian";
import { THIS_PLUGIN } from "src/globals/constants";
import { OuterSetting } from "src/globals/plugin-setting";
import type CleverSearch from "src/main";
import {
	createLightweightFuzzyIndex,
	matchLightweightFuzzy,
	prepareLightweightFuzzyQuery,
} from "src/services/search/lightweight-fuzzy-matcher";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { DataProvider } from "./data-provider";
import {
	SearchHistoryService,
	type NavigationHabitSignal,
	type RecentNavigationSelection,
} from "./search-history-service";

export type SearchAutocompleteSource =
	| "file"
	| "alias"
	| "heading"
	| "path"
	| "recent"
	| "quickCommand";

export type SearchAutocompleteMode = "navigation" | "quickCommand";

export type SearchAutocompleteSection =
	| "matches"
	| "recent-targets"
	| "recent-files";

export type SearchAutocompleteCandidate = {
	id: string;
	kind: SearchAutocompleteSource;
	section: SearchAutocompleteSection;
	insertText: string;
	primaryText: string;
	secondaryText?: string;
	path: string;
	openLinkText: string;
	positions: number[];
	pathPositions: number[];
	secondaryPositions: number[];
	score: number;
	memoryTimestamp?: number;
	confidence: "high" | "medium" | "low";
};

type NavigationQueryIntent =
	| "default"
	| "heading"
	| "block"
	| "path"
	| "breadcrumb";

type ParsedNavigationQuery = {
	intent: NavigationQueryIntent;
	normalizedQuery: string;
	preparedQuery: ReturnType<typeof prepareLightweightFuzzyQuery> | null;
	queryLooksPathLike: boolean;
};

type IndexedAutocompleteEntry = {
	id: string;
	kind: Exclude<SearchAutocompleteSource, "recent" | "quickCommand">;
	insertText: string;
	primaryText: string;
	secondaryText?: string;
	path: string;
	openLinkText: string;
	textIndex: ReturnType<typeof createLightweightFuzzyIndex>;
	pathTextIndex: ReturnType<typeof createLightweightFuzzyIndex>;
	pathDepth: number;
	pathLength: number;
};

type IndexedQuickCommandEntry = {
	id: string;
	kind: "quickCommand";
	insertText: string;
	primaryText: string;
	secondaryText: string;
	path: string;
	openLinkText: string;
	textIndex: ReturnType<typeof createLightweightFuzzyIndex>;
	secondaryTextIndex: ReturnType<typeof createLightweightFuzzyIndex>;
};

@singleton()
export class SearchAutocompleteService {
	private static readonly MAX_CANDIDATE_COUNT = 12;
	private static readonly RECENT_FILE_LIMIT = 10;
	private static readonly RECENT_TARGET_LIMIT = 6;
	private static readonly RECENT_QUICK_COMMAND_LIMIT = 8;
	private readonly plugin: CleverSearch = getInstance(THIS_PLUGIN);
	private readonly app = getInstance(App);
	private readonly vault = getInstance(Vault);
	private get setting(): OuterSetting {
		return getInstance(OuterSetting);
	}
	private lastSettingRef: OuterSetting | null = null;
	private readonly dataProvider = getInstance(DataProvider);
	private readonly searchHistoryService = getInstance(SearchHistoryService);
	private indexedEntriesCache: IndexedAutocompleteEntry[] | null = null;
	private indexedQuickCommandEntriesCache: IndexedQuickCommandEntry[] | null = null;

	constructor() {
		this.registerInvalidationEvents();
	}

	isEnabled(): boolean {
		this.ensureSettingFresh();
		const sources = this.setting.searchHistory.sources;
		return (
			sources.file ||
			sources.alias ||
			sources.heading ||
			sources.path ||
			sources.recentFile
		);
	}

	getNavigationSuggestions(
		queryText: string,
		limit = SearchAutocompleteService.MAX_CANDIDATE_COUNT,
	): SearchAutocompleteCandidate[] {
		this.ensureSettingFresh();
		if (!this.isEnabled()) {
			return [];
		}

		const parsedQuery = this.parseNavigationQuery(queryText);
		if (!parsedQuery.preparedQuery) {
			return this.buildEmptyStateCandidates(limit);
		}

		const recentFileBoosts = this.buildRecentFileBoosts();
		const navigationHabitSignals =
			this.searchHistoryService.getNavigationHabitSignals(
				parsedQuery.normalizedQuery,
			);
		const candidates: SearchAutocompleteCandidate[] = [];

		for (const entry of this.getIndexedEntries()) {
			if (!this.isSourceEnabled(entry.kind)) {
				continue;
			}
			const candidate = this.buildMatchedCandidate(
				entry,
				parsedQuery,
				recentFileBoosts,
				navigationHabitSignals,
			);
			if (candidate) {
				candidates.push(candidate);
			}
		}

		if (this.setting.searchHistory.sources.recentFile) {
			candidates.push(
				...this.buildRecentFileCandidates(
					parsedQuery,
					"matches",
					navigationHabitSignals,
				),
			);
		}

		return this.sortAndTrimCandidates(candidates, limit);
	}

	getQuickCommandSuggestions(
		queryText: string,
		limit = SearchAutocompleteService.MAX_CANDIDATE_COUNT,
	): SearchAutocompleteCandidate[] {
		this.ensureSettingFresh();
		const preparedQuery = prepareLightweightFuzzyQuery(queryText, "history");
		const normalizedQuery = preparedQuery.normalizedQuery;
		const navigationHabitSignals =
			this.searchHistoryService.getQuickCommandHabitSignals(queryText);
		if (normalizedQuery.length === 0) {
			return this.sortAndTrimCandidates(
				this.buildRecentQuickCommandCandidates(
					SearchAutocompleteService.RECENT_QUICK_COMMAND_LIMIT,
					navigationHabitSignals,
				),
				limit,
				{ preferMemoryTimestamp: true },
			);
		}

		const candidates: SearchAutocompleteCandidate[] = [];
		for (const entry of this.getIndexedQuickCommandEntries()) {
			const candidate = this.buildMatchedQuickCommandCandidate(
				entry,
				preparedQuery,
				normalizedQuery,
				navigationHabitSignals.get(entry.openLinkText),
			);
			if (candidate) {
				candidates.push(candidate);
			}
		}

		return this.sortAndTrimCandidates(candidates, limit);
	}

	private buildEmptyStateCandidates(limit: number): SearchAutocompleteCandidate[] {
		this.ensureSettingFresh();
		const candidates: SearchAutocompleteCandidate[] = [];
		const emptyQuery = this.parseNavigationQuery("");
		const navigationHabitSignals =
			this.searchHistoryService.getNavigationHabitSignals("");
		candidates.push(
			...this.buildRecentNavigationCandidates(
				Math.max(limit, SearchAutocompleteService.RECENT_TARGET_LIMIT),
				navigationHabitSignals,
			),
		);

		if (this.setting.searchHistory.sources.recentFile) {
			candidates.push(
				...this.buildRecentFileCandidates(
					emptyQuery,
					"recent-targets",
					navigationHabitSignals,
				),
			);
		}

		return this.sortAndTrimCandidates(candidates, limit, {
			preferMemoryTimestamp: true,
		});
	}

	private buildMatchedCandidate(
		entry: IndexedAutocompleteEntry,
		parsedQuery: ParsedNavigationQuery,
		recentFileBoosts: Map<string, number>,
		navigationHabitSignals: Map<string, NavigationHabitSignal>,
	): SearchAutocompleteCandidate | null {
		const preparedQuery = parsedQuery.preparedQuery;
		if (!preparedQuery) {
			return null;
		}

		const primaryMatch = matchLightweightFuzzy(preparedQuery, entry.textIndex);
		const secondaryMatch = entry.secondaryText
			? matchLightweightFuzzy(
				preparedQuery,
				createLightweightFuzzyIndex(entry.secondaryText),
			)
			: null;
		const pathMatch =
			entry.kind === "path"
				? primaryMatch
				: matchLightweightFuzzy(preparedQuery, entry.pathTextIndex);
		if (!primaryMatch && !pathMatch) {
			return null;
		}

		const baseScore = primaryMatch
			? primaryMatch.score
			: Math.max(0, (pathMatch?.score ?? 0) - 90);
		const score =
			baseScore +
			this.getSourceBoost(entry.kind, parsedQuery.queryLooksPathLike) +
			this.getIntentBoost(entry.kind, parsedQuery.intent) +
			this.getExactnessBoost(
				entry,
				parsedQuery.normalizedQuery,
				parsedQuery.queryLooksPathLike,
			) +
			this.getNavigationHabitBoost(
				navigationHabitSignals.get(entry.openLinkText),
				parsedQuery.normalizedQuery.length > 0,
			) +
			(recentFileBoosts.get(entry.path) ?? 0) -
			this.getPathPenalty(entry);

		return {
			id: entry.id,
			kind: entry.kind,
			section: "matches",
			insertText: entry.insertText,
			primaryText: entry.primaryText,
			secondaryText: entry.secondaryText,
			path: entry.path,
			openLinkText: entry.openLinkText,
			positions: this.getFieldHighlightPositions(
				entry.primaryText,
				preparedQuery,
				primaryMatch?.positions ?? [],
			),
			pathPositions:
				entry.primaryText === entry.path
					? []
					: this.getFieldHighlightPositions(
						entry.path,
						preparedQuery,
						pathMatch?.positions ?? [],
					),
			secondaryPositions: entry.secondaryText
				? this.getFieldHighlightPositions(
					entry.secondaryText,
					preparedQuery,
					secondaryMatch?.positions ?? [],
				)
				: [],
			score,
			confidence: this.getConfidenceLevel(entry, parsedQuery.normalizedQuery),
		};
	}

	private buildMatchedQuickCommandCandidate(
		entry: IndexedQuickCommandEntry,
		preparedQuery: ReturnType<typeof prepareLightweightFuzzyQuery>,
		normalizedQuery: string,
		habitSignal?: NavigationHabitSignal,
	): SearchAutocompleteCandidate | null {
		const primaryMatch = matchLightweightFuzzy(preparedQuery, entry.textIndex);
		const secondaryMatch = matchLightweightFuzzy(
			preparedQuery,
			entry.secondaryTextIndex,
		);
		if (!primaryMatch && !secondaryMatch) {
			return null;
		}
		const projectedPositions = this.projectQuickCommandMatchPositions(
			entry.insertText,
			entry.primaryText,
			entry.secondaryText,
			primaryMatch?.positions ?? [],
		);

		const score =
			(primaryMatch
				? primaryMatch.score
				: Math.max(0, (secondaryMatch?.score ?? 0) - 140)) +
			this.getSourceBoost("quickCommand", false) +
			this.getQuickCommandExactnessBoost(entry, normalizedQuery) +
			this.getNavigationHabitBoost(habitSignal, normalizedQuery.length > 0);

		return {
			id: entry.id,
			kind: "quickCommand",
			section: "matches",
			insertText: entry.insertText,
			primaryText: entry.primaryText,
			secondaryText: entry.secondaryText,
			path: entry.path,
			openLinkText: entry.openLinkText,
			positions: mergeSortedPositions(
				projectedPositions.primaryPositions,
				this.getFieldHighlightPositions(entry.primaryText, preparedQuery),
			),
			pathPositions: [],
			secondaryPositions: mergeSortedPositions(
				mergeSortedPositions(
					projectedPositions.secondaryPositions,
					secondaryMatch?.positions ?? [],
				),
				this.getFieldHighlightPositions(
					entry.secondaryText,
					preparedQuery,
					secondaryMatch?.positions ?? [],
				),
			),
			score,
			confidence: this.getConfidenceLevel(entry, normalizedQuery),
		};
	}

	private buildRecentNavigationCandidates(
		limit: number,
		navigationHabitSignals: Map<string, NavigationHabitSignal>,
	): SearchAutocompleteCandidate[] {
		const selections = this.searchHistoryService.getRecentNavigationSelections(
			Math.max(limit * 3, SearchAutocompleteService.RECENT_TARGET_LIMIT),
		);
		const candidates: SearchAutocompleteCandidate[] = [];

		for (const selection of selections) {
			const file = this.dataProvider.getFileByPath(selection.path);
			if (!(file instanceof TFile) || !this.dataProvider.isIndexable(file)) {
				continue;
			}
			if (!this.isSelectionSourceEnabled(selection.kind)) {
				continue;
			}

			candidates.push(
				this.createRecentNavigationCandidate(
					selection,
					navigationHabitSignals.get(selection.openLinkText),
				),
			);
		}

		return candidates
			.sort((left, right) => {
				if (left.score !== right.score) {
					return right.score - left.score;
				}
				const depthDiff = this.getPathDepth(left.path) - this.getPathDepth(right.path);
				if (depthDiff !== 0) {
					return depthDiff;
				}
				const lengthDiff = left.path.length - right.path.length;
				if (lengthDiff !== 0) {
					return lengthDiff;
				}
				return left.primaryText.localeCompare(right.primaryText);
			})
			.slice(0, limit);
	}

	private createRecentNavigationCandidate(
		selection: RecentNavigationSelection,
		habitSignal?: NavigationHabitSignal,
	): SearchAutocompleteCandidate {
		const score =
			this.getSourceBoost(selection.kind, false) +
			this.getNavigationHabitBoost(habitSignal, false) +
			this.getTimestampRecencyBoost(
				selection.timestamp,
				220,
				1000 * 60 * 60 * 24 * 5,
			);
		const confidence =
			habitSignal && (habitSignal.dayStreak >= 3 || habitSignal.totalSelectionCount >= 4)
				? "high"
				: "medium";
		return {
			id: `recent-target:${selection.openLinkText}`,
			kind: selection.kind,
			section: "recent-targets",
			insertText: selection.primaryText,
			primaryText: selection.primaryText,
			secondaryText: selection.secondaryText,
			path: selection.path,
			openLinkText: selection.openLinkText,
			positions: [],
			pathPositions: [],
			secondaryPositions: [],
			score,
			memoryTimestamp: selection.timestamp,
			confidence,
		};
	}

	private buildRecentQuickCommandCandidates(
		limit: number,
		navigationHabitSignals: Map<string, NavigationHabitSignal>,
	): SearchAutocompleteCandidate[] {
		const indexedQuickCommands = new Map(
			this.getIndexedQuickCommandEntries().map((entry) => [entry.openLinkText, entry]),
		);
		const selections = this.searchHistoryService.getRecentQuickCommandSelections(limit);

		return selections.flatMap((selection) => {
			const habitSignal = navigationHabitSignals.get(selection.openLinkText);
			const indexedEntry = indexedQuickCommands.get(selection.openLinkText);
			if (!indexedEntry) {
				return [];
			}
			return [{
				id: `recent-quick-command:${selection.openLinkText}`,
				kind: "quickCommand",
				section: "recent-targets",
				insertText: indexedEntry.insertText,
				primaryText: indexedEntry.primaryText,
				secondaryText: indexedEntry.secondaryText,
				path: indexedEntry.path,
				openLinkText: selection.openLinkText,
				positions: [],
				pathPositions: [],
				secondaryPositions: [],
				score:
					this.getSourceBoost("quickCommand", false) +
					this.getNavigationHabitBoost(habitSignal, false) +
					this.getTimestampRecencyBoost(
						selection.timestamp,
						240,
						1000 * 60 * 60 * 24 * 5,
					),
				memoryTimestamp: selection.timestamp,
				confidence:
					habitSignal &&
					(habitSignal.dayStreak >= 3 || habitSignal.totalSelectionCount >= 4)
						? "high"
						: "medium",
			}];
		});
	}

	private buildRecentFileCandidates(
		parsedQuery: ParsedNavigationQuery,
		section: SearchAutocompleteSection,
		navigationHabitSignals: Map<string, NavigationHabitSignal>,
	): SearchAutocompleteCandidate[] {
		const { preparedQuery, normalizedQuery, queryLooksPathLike, intent } = parsedQuery;
		const candidates: SearchAutocompleteCandidate[] = [];

		this.app.workspace
			.getLastOpenFiles()
			.slice(0, SearchAutocompleteService.RECENT_FILE_LIMIT)
			.forEach((path, index) => {
				const file = this.dataProvider.getFileByPath(path);
				if (!(file instanceof TFile) || !this.dataProvider.isIndexable(file)) {
					return;
				}

				const basenameMatch = preparedQuery
					? matchLightweightFuzzy(
							preparedQuery,
							createLightweightFuzzyIndex(file.basename),
						)
					: { positions: [], score: 0 };
				const pathMatch = preparedQuery
					? matchLightweightFuzzy(preparedQuery, createLightweightFuzzyIndex(path))
					: { positions: [], score: 0 };
				if (preparedQuery && !basenameMatch && !pathMatch) {
					return;
				}

				const score =
					(basenameMatch
						? basenameMatch.score
						: Math.max(0, (pathMatch?.score ?? 0) - 80)) +
					this.getSourceBoost("recent", queryLooksPathLike) +
					this.getIntentBoost("recent", intent) +
					this.getRecentExactnessBoost(
						file.basename,
						path,
						normalizedQuery,
						queryLooksPathLike,
					) +
					this.getNavigationHabitBoost(
						navigationHabitSignals.get(path),
						normalizedQuery.length > 0,
					) +
					(SearchAutocompleteService.RECENT_FILE_LIMIT - index) * 20 -
					this.getPathPenalty({
						pathDepth: this.getPathDepth(path),
						pathLength: path.length,
					});

				candidates.push({
					id: `recent:${path}`,
					kind: "recent",
					section,
					insertText: file.basename,
					primaryText: file.basename,
					path,
					openLinkText: path,
					positions: basenameMatch?.positions ?? [],
					pathPositions: pathMatch?.positions ?? [],
					secondaryPositions: [],
					score,
					memoryTimestamp: this.getNavigationHabitTimestamp(
						navigationHabitSignals.get(path),
						normalizedQuery.length > 0,
					),
					confidence: this.getConfidenceLevel(
						{
							insertText: file.basename,
							primaryText: file.basename,
							kind: "recent",
						},
						normalizedQuery,
					),
				});
			});

		return candidates;
	}

	private buildRecentFileBoosts(): Map<string, number> {
		const boosts = new Map<string, number>();
		this.app.workspace
			.getLastOpenFiles()
			.slice(0, SearchAutocompleteService.RECENT_FILE_LIMIT)
			.forEach((path, index) => {
				boosts.set(path, (SearchAutocompleteService.RECENT_FILE_LIMIT - index) * 12);
			});
		return boosts;
	}

	private registerInvalidationEvents(): void {
		this.plugin.registerEvent(
			this.vault.on("create", () => this.invalidateCache()),
		);
		this.plugin.registerEvent(
			this.vault.on("delete", () => this.invalidateCache()),
		);
		this.plugin.registerEvent(
			this.vault.on("rename", () => this.invalidateCache()),
		);
		this.plugin.registerEvent(
			this.app.metadataCache.on("changed", () => this.invalidateCache()),
		);
		this.plugin.registerEvent(
			this.app.metadataCache.on("resolved", () => this.invalidateCache()),
		);
	}

	private ensureSettingFresh(): void {
		const currentSetting = this.setting;
		if (this.lastSettingRef === currentSetting) {
			return;
		}
		this.lastSettingRef = currentSetting;
		this.invalidateCache();
	}

	private getIndexedEntries(): IndexedAutocompleteEntry[] {
		if (this.indexedEntriesCache) {
			return this.indexedEntriesCache;
		}

		const entries: IndexedAutocompleteEntry[] = [];
		for (const file of this.dataProvider.allFilesToBeIndexed()) {
			entries.push(...this.buildEntriesForFile(file));
		}
		this.indexedEntriesCache = entries;
		return entries;
	}

	private getIndexedQuickCommandEntries(): IndexedQuickCommandEntry[] {
		const registry = (this.app as App & {
			commands?: {
				commands?: Record<string, { id?: string; name?: string }>;
			};
		}).commands?.commands;
		const entries: IndexedQuickCommandEntry[] = [];
		for (const [registryKey, command] of Object.entries(registry ?? {})) {
			const commandId = command?.id?.trim() || registryKey.trim();
			const commandName = command?.name?.trim() || "";
			if (commandId.length === 0 || commandName.length === 0) {
				continue;
			}

			entries.push(this.createIndexedQuickCommandEntry(commandId, commandName));
		}

		this.indexedQuickCommandEntriesCache = entries.sort((left, right) =>
			left.primaryText.localeCompare(right.primaryText),
		);
		return this.indexedQuickCommandEntriesCache;
	}

	private buildEntriesForFile(file: TFile): IndexedAutocompleteEntry[] {
		const entries: IndexedAutocompleteEntry[] = [];
		const metadata = this.app.metadataCache.getFileCache(file);
		const basename = file.basename.trim();
		const path = file.path;

		entries.push(
			this.createIndexedEntry({
				kind: "file",
				insertText: basename,
				primaryText: basename,
				path,
				openLinkText: path,
			}),
		);

		entries.push(
			this.createIndexedEntry({
				kind: "path",
				insertText: path,
				primaryText: path,
				secondaryText: basename,
				path,
				openLinkText: path,
			}),
		);

		for (const alias of this.extractAliases(metadata, basename)) {
			entries.push(
				this.createIndexedEntry({
					kind: "alias",
					insertText: alias,
					primaryText: `${alias} -> ${basename}`,
					path,
					openLinkText: path,
				}),
			);
		}

		for (const heading of this.extractHeadings(metadata)) {
			entries.push(
				this.createIndexedEntry({
					kind: "heading",
					insertText: heading,
					primaryText: `${basename} > ${heading}`,
					path,
					openLinkText: `${path}#${heading}`,
				}),
			);
		}

		return entries;
	}

	private createIndexedQuickCommandEntry(
		commandId: string,
		commandName: string,
	): IndexedQuickCommandEntry {
		const secondaryText = this.getQuickCommandOwnerText(commandId);
		const displayName = this.getQuickCommandDisplayName(commandName, secondaryText);
		return {
			id: `quick-command:${normalizeKey(commandId)}`,
			kind: "quickCommand",
			insertText: commandName,
			primaryText: displayName,
			secondaryText,
			path: commandId,
			openLinkText: commandId,
			textIndex: createLightweightFuzzyIndex(commandName),
			secondaryTextIndex: createLightweightFuzzyIndex(secondaryText),
		};
	}

	private sortAndTrimCandidates(
		candidates: SearchAutocompleteCandidate[],
		limit: number,
		options: Readonly<{ preferMemoryTimestamp?: boolean }> = {},
	): SearchAutocompleteCandidate[] {
		const sorted = [...candidates].sort((left, right) => {
			if (left.section !== right.section) {
				return this.getSectionPriority(right.section) - this.getSectionPriority(left.section);
			}
			if (options.preferMemoryTimestamp) {
				const memoryTimestampDiff =
					(right.memoryTimestamp ?? 0) - (left.memoryTimestamp ?? 0);
				if (memoryTimestampDiff !== 0) {
					return memoryTimestampDiff;
				}
			}
			if (left.score !== right.score) {
				return right.score - left.score;
			}
			const priorityDiff =
				this.getKindPriority(right.kind) - this.getKindPriority(left.kind);
			if (priorityDiff !== 0) {
				return priorityDiff;
			}
			const depthDiff = this.getPathDepth(left.path) - this.getPathDepth(right.path);
			if (depthDiff !== 0) {
				return depthDiff;
			}
			const lengthDiff = left.path.length - right.path.length;
			if (lengthDiff !== 0) {
				return lengthDiff;
			}
			return left.primaryText.localeCompare(right.primaryText);
		});

		const deduped: SearchAutocompleteCandidate[] = [];
		const seen = new Set<string>();
		for (const candidate of sorted) {
			const key = this.getDedupKey(candidate);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			deduped.push(candidate);
			if (deduped.length >= limit) {
				break;
			}
		}
		return deduped;
	}

	private isSelectionSourceEnabled(kind: SearchAutocompleteSource): boolean {
		switch (kind) {
			case "quickCommand":
				return false;
			case "recent":
				return this.setting.searchHistory.sources.recentFile;
			case "file":
			case "alias":
			case "heading":
			case "path":
				return this.isSourceEnabled(kind);
		}
	}

	private isSourceEnabled(kind: IndexedAutocompleteEntry["kind"]): boolean {
		switch (kind) {
			case "file":
				return this.setting.searchHistory.sources.file;
			case "alias":
				return this.setting.searchHistory.sources.alias;
			case "heading":
				return this.setting.searchHistory.sources.heading;
			case "path":
				return this.setting.searchHistory.sources.path;
		}
	}

	private getSourceBoost(
		kind: SearchAutocompleteSource,
		queryLooksPathLike: boolean,
	): number {
		switch (kind) {
			case "quickCommand":
				return 320;
			case "recent":
				return 220;
			case "file":
				return 300;
			case "alias":
				return 250;
			case "heading":
				return 280;
			case "path":
				return queryLooksPathLike ? 260 : 130;
		}
	}

	private getIntentBoost(
		kind: SearchAutocompleteSource,
		intent: NavigationQueryIntent,
	): number {
		switch (intent) {
			case "default":
				return 0;
			case "heading":
				switch (kind) {
					case "quickCommand":
						return 0;
					case "heading":
						return 220;
					case "alias":
						return 40;
					case "file":
						return 20;
					case "recent":
						return 10;
					case "path":
						return -90;
				}
			case "block":
				switch (kind) {
					case "quickCommand":
						return 0;
					case "heading":
						return 190;
					case "file":
						return 20;
					case "alias":
						return 10;
					case "recent":
						return 20;
					case "path":
						return -100;
				}
			case "path":
				switch (kind) {
					case "quickCommand":
						return 0;
					case "path":
						return 260;
					case "file":
						return 120;
					case "recent":
						return 80;
					case "heading":
						return -70;
					case "alias":
						return -40;
				}
			case "breadcrumb":
				switch (kind) {
					case "quickCommand":
						return 0;
					case "heading":
						return 210;
					case "path":
						return 110;
					case "recent":
						return 30;
					case "file":
						return 20;
					case "alias":
						return 0;
				}
		}
	}

	private getExactnessBoost(
		entry: IndexedAutocompleteEntry,
		normalizedQuery: string,
		queryLooksPathLike: boolean,
	): number {
		const normalizedInsert = normalizeKey(entry.insertText);
		const normalizedPrimary = normalizeKey(entry.primaryText);
		const normalizedPath = normalizeKey(entry.path);
		let boost = 0;

		if (normalizedInsert === normalizedQuery) {
			boost += this.getExactMatchBoost(entry.kind);
		} else if (normalizedInsert.startsWith(normalizedQuery)) {
			boost += this.getPrefixMatchBoost(entry.kind);
		} else if (normalizedPrimary.startsWith(normalizedQuery)) {
			boost += 120;
		}

		if (normalizedPath === normalizedQuery) {
			boost += entry.kind === "path" ? 420 : 180;
		} else if (normalizedPath.startsWith(normalizedQuery)) {
			boost += queryLooksPathLike ? 180 : 70;
		}

		return boost;
	}

	private getRecentExactnessBoost(
		basename: string,
		path: string,
		normalizedQuery: string,
		queryLooksPathLike: boolean,
	): number {
		if (normalizedQuery.length === 0) {
			return 0;
		}

		const normalizedBasename = normalizeKey(basename);
		const normalizedPath = normalizeKey(path);
		if (normalizedBasename === normalizedQuery) {
			return 540;
		}
		if (normalizedBasename.startsWith(normalizedQuery)) {
			return 240;
		}
		if (normalizedPath === normalizedQuery) {
			return 220;
		}
		if (normalizedPath.startsWith(normalizedQuery)) {
			return queryLooksPathLike ? 160 : 60;
		}
		return 0;
	}

	private getQuickCommandExactnessBoost(
		entry: IndexedQuickCommandEntry,
		normalizedQuery: string,
	): number {
		if (normalizedQuery.length === 0) {
			return 0;
		}

		const normalizedInsert = normalizeKey(entry.insertText);
		const normalizedSecondary = normalizeKey(entry.secondaryText);
		if (normalizedInsert === normalizedQuery) {
			return this.getExactMatchBoost("quickCommand");
		}
		if (normalizedInsert.startsWith(normalizedQuery)) {
			return this.getPrefixMatchBoost("quickCommand");
		}
		if (normalizedSecondary === normalizedQuery) {
			return 220;
		}
		if (normalizedSecondary.startsWith(normalizedQuery)) {
			return 110;
		}
		return 0;
	}

	private getNavigationHabitBoost(
		signal: NavigationHabitSignal | undefined,
		preferQuerySignals: boolean,
	): number {
		if (!signal) {
			return 0;
		}

		let boost = 0;
		boost += Math.min(signal.totalSelectionCount, 12) * 26;
		boost += signal.recentDayCount * 42;
		boost += signal.dayStreak * 54;
		boost += this.getTimestampRecencyBoost(
			signal.lastTimestamp,
			160,
			1000 * 60 * 60 * 24 * 5,
		);

		if (preferQuerySignals) {
			boost += Math.min(signal.querySelectionCount, 8) * 92;
			boost += this.getTimestampRecencyBoost(
				signal.queryLastTimestamp,
				220,
				1000 * 60 * 60 * 24 * 4,
			);
		}

		return boost;
	}

	private getNavigationHabitTimestamp(
		signal: NavigationHabitSignal | undefined,
		preferQuerySignals: boolean,
	): number | undefined {
		if (!signal) {
			return undefined;
		}
		const timestamp =
			preferQuerySignals && signal.queryLastTimestamp > 0
				? signal.queryLastTimestamp
				: signal.lastTimestamp;
		return timestamp > 0 ? timestamp : undefined;
	}

	private getTimestampRecencyBoost(
		timestamp: number,
		maxBoost: number,
		halfLifeMs: number,
	): number {
		if (!(timestamp > 0)) {
			return 0;
		}
		const ageMs = Math.max(0, Date.now() - timestamp);
		return Math.round(maxBoost * Math.exp((-Math.LN2 * ageMs) / halfLifeMs));
	}

	private getExactMatchBoost(kind: Exclude<SearchAutocompleteSource, "recent">): number {
		switch (kind) {
			case "quickCommand":
				return 640;
			case "file":
				return 620;
			case "heading":
				return 560;
			case "alias":
				return 520;
			case "path":
				return 400;
		}
	}

	private getPrefixMatchBoost(kind: Exclude<SearchAutocompleteSource, "recent">): number {
		switch (kind) {
			case "quickCommand":
				return 280;
			case "file":
				return 260;
			case "heading":
				return 240;
			case "alias":
				return 220;
			case "path":
				return 170;
		}
	}

	private getKindPriority(kind: SearchAutocompleteSource): number {
		switch (kind) {
			case "quickCommand":
				return 6;
			case "file":
				return 5;
			case "heading":
				return 4;
			case "alias":
				return 3;
			case "recent":
				return 2;
			case "path":
				return 1;
		}
	}

	private getSectionPriority(section: SearchAutocompleteSection): number {
		switch (section) {
			case "recent-targets":
				return 3;
			case "recent-files":
				return 2;
			case "matches":
				return 1;
		}
	}

	private getDedupKey(candidate: SearchAutocompleteCandidate): string {
		switch (candidate.kind) {
			case "quickCommand":
				return `quick-command:${normalizeKey(candidate.openLinkText)}`;
			case "recent":
			case "file":
				return `file:${candidate.path}`;
			case "path":
				return `path:${candidate.path}`;
			case "alias":
				return `alias:${candidate.path}:${normalizeKey(candidate.insertText)}`;
			case "heading":
				return `heading:${normalizeKey(candidate.openLinkText)}`;
		}
	}

	private getPathPenalty(entry: { pathDepth: number; pathLength: number }): number {
		return entry.pathDepth * 5 + Math.min(entry.pathLength, 120) * 0.22;
	}

	private getFieldHighlightPositions(
		text: string,
		preparedQuery: ReturnType<typeof prepareLightweightFuzzyQuery>,
		fallbackPositions: number[] = [],
	): number[] {
		if (fallbackPositions.length > 0) {
			return fallbackPositions;
		}

		const queryTerms = preparedQuery.queryTerms.filter((term) => term.length > 0);
		if (queryTerms.length <= 1) {
			return fallbackPositions;
		}

		const textIndex = createLightweightFuzzyIndex(text);
		let positions: number[] = [];
		for (const term of queryTerms) {
			const termMatch = matchLightweightFuzzy(
				prepareLightweightFuzzyQuery(term, preparedQuery.mode),
				textIndex,
			);
			positions = mergeSortedPositions(positions, termMatch?.positions ?? []);
		}

		return positions;
	}

	private getConfidenceLevel(
		entry: Pick<SearchAutocompleteCandidate, "insertText" | "primaryText" | "kind">,
		normalizedQuery: string,
	): "high" | "medium" | "low" {
		if (normalizedQuery.length === 0) {
			return "medium";
		}

		const normalizedInsert = normalizeKey(entry.insertText);
		const normalizedPrimary = normalizeKey(entry.primaryText);
		if (normalizedInsert === normalizedQuery) {
			return "high";
		}
		if (
			normalizedInsert.startsWith(normalizedQuery) ||
			normalizedPrimary.startsWith(normalizedQuery)
		) {
			return "medium";
		}
		return "low";
	}

	private parseNavigationQuery(queryText: string): ParsedNavigationQuery {
		const trimmedQuery = queryText.trimStart();
		const intent = this.getQueryIntent(trimmedQuery.charAt(0));
		const effectiveQuery =
			intent === "default" ? queryText : trimmedQuery.slice(1).trimStart();
		const preparedQuery = prepareLightweightFuzzyQuery(effectiveQuery);
		const normalizedQuery = preparedQuery.normalizedQuery;
		return {
			intent,
			normalizedQuery,
			preparedQuery: normalizedQuery.length > 0 ? preparedQuery : null,
			queryLooksPathLike:
				intent === "path" || this.isPathLikeQuery(normalizedQuery),
		};
	}

	private getQueryIntent(firstCharacter: string): NavigationQueryIntent {
		switch (firstCharacter) {
			case "#":
				return "heading";
			case "^":
				return "block";
			case "/":
				return "path";
			case ">":
				return "breadcrumb";
			default:
				return "default";
		}
	}

	private createIndexedEntry(
		entry: Omit<
			IndexedAutocompleteEntry,
			"id" | "textIndex" | "pathTextIndex" | "pathDepth" | "pathLength"
		>,
	): IndexedAutocompleteEntry {
		return {
			...entry,
			id: `${entry.kind}:${entry.openLinkText}:${normalizeKey(entry.insertText)}`,
			textIndex: createLightweightFuzzyIndex(entry.primaryText),
			pathTextIndex: createLightweightFuzzyIndex(entry.path),
			pathDepth: this.getPathDepth(entry.path),
			pathLength: entry.path.length,
		};
	}

	private getQuickCommandOwnerText(commandId: string): string {
		const pluginId = commandId.split(":")[0]?.trim();
		if (!pluginId) {
			return "Obsidian";
		}

		const pluginManifest = (this.app as App & {
			plugins?: {
				plugins?: Record<string, { manifest?: { name?: string } }>;
			};
		}).plugins?.plugins?.[pluginId]?.manifest;
		return pluginManifest?.name?.trim() || "Obsidian";
	}

	private getQuickCommandDisplayName(commandName: string, ownerText: string): string {
		return this.getQuickCommandDisplayProjection(commandName, ownerText).displayName;
	}

	private getQuickCommandDisplayProjection(
		commandName: string,
		ownerText: string,
	): {
		displayName: string;
		displayOffset: number;
		ownerLength: number;
	} {
		const trimmedCommandName = commandName.trim();
		const trimmedOwnerText = ownerText.trim();
		if (!trimmedCommandName || !trimmedOwnerText) {
			return {
				displayName: trimmedCommandName,
				displayOffset: 0,
				ownerLength: 0,
			};
		}

		for (const separator of [":", "\uFF1A"]) {
			const prefix = trimmedOwnerText + separator;
			if (!trimmedCommandName.startsWith(prefix)) {
				continue;
			}
			const remainder = trimmedCommandName.slice(prefix.length);
			const strippedName = remainder.trim();
			if (strippedName.length > 0) {
				return {
					displayName: strippedName,
					displayOffset:
						prefix.length + (remainder.length - remainder.trimStart().length),
					ownerLength: trimmedOwnerText.length,
				};
			}
		}

		return {
			displayName: trimmedCommandName,
			displayOffset: 0,
			ownerLength: 0,
		};
	}

	private projectQuickCommandMatchPositions(
		commandName: string,
		displayName: string,
		ownerText: string,
		positions: number[],
	): {
		primaryPositions: number[];
		secondaryPositions: number[];
	} {
		if (positions.length === 0) {
			return { primaryPositions: [], secondaryPositions: [] };
		}

		const projection = this.getQuickCommandDisplayProjection(commandName, ownerText);
		if (projection.displayOffset === 0) {
			return {
				primaryPositions: positions.filter(
					(position) => position >= 0 && position < displayName.length,
				),
				secondaryPositions: [],
			};
		}

		const primaryPositions: number[] = [];
		const secondaryPositions: number[] = [];
		for (const position of positions) {
			if (position >= 0 && position < projection.ownerLength) {
				secondaryPositions.push(position);
				continue;
			}
			if (position < projection.displayOffset) {
				continue;
			}
			const displayPosition = position - projection.displayOffset;
			if (displayPosition >= 0 && displayPosition < displayName.length) {
				primaryPositions.push(displayPosition);
			}
		}

		return { primaryPositions, secondaryPositions };
	}

	private extractAliases(
		metadata: CachedMetadata | null,
		basename: string,
	): string[] {
		const aliases = parseFrontMatterAliases(metadata?.frontmatter) || [];
		return dedupeTexts(aliases).filter(
			(alias) => normalizeKey(alias) !== normalizeKey(basename),
		);
	}

	private extractHeadings(metadata: CachedMetadata | null): string[] {
		return dedupeTexts(
			(metadata?.headings ?? []).map((heading) => heading.heading),
		);
	}

	private getPathDepth(path: string): number {
		return path.split("/").length - 1;
	}

	private isPathLikeQuery(query: string): boolean {
		return /[\\/]|(?:^|\s)(?:path:|folder:)/iu.test(query);
	}

	private invalidateCache(): void {
		this.indexedEntriesCache = null;
		this.indexedQuickCommandEntriesCache = null;
	}
}

function dedupeTexts(values: string[]): string[] {
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const value of values) {
		const normalized = normalizeKey(value);
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		deduped.push(value.replace(/\s+/g, " ").trim());
	}
	return deduped;
}

function normalizeKey(text: string): string {
	return text.trim().toLocaleLowerCase();
}

function mergeSortedPositions(left: number[], right: number[]): number[] {
	if (left.length === 0) {
		return right;
	}
	if (right.length === 0) {
		return left;
	}
	return [...new Set([...left, ...right])].sort((a, b) => a - b);
}
