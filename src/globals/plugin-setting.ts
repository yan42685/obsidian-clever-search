import type { LogLevel } from "src/utils/logger";
import { isDevEnvironment } from "src/utils/my-lib";

// exposed to users
export class OuterSetting {
	settingsSchemaVersion: number;
	customExtensions: {
		plaintext: string[];
	};
	releaseAnnouncements: ReleaseAnnouncementSetting;
	followObsidianExcludedFiles: boolean;
	excludedPaths: string[]; // NOTE: can't use Set() or it will be a non-iterable object after deserialization
	logLevel: LogLevel;
	fileSearchBackend: FileSearchBackend;
	hideWeaklyRelatedResults: boolean;
	weakFilePruneMode: WeakFilePruneMode;
	isCaseSensitive: boolean;
	isPrefixMatch: boolean;
	isFuzzy: boolean;
	enableStopWordsEn: boolean;
	enableChinesePatch: boolean;
	enableStopWordsZh: boolean;
	hybrid: HybridSetting;
	searchHistory: SearchHistorySetting;
	quickSwitchHistory: QuickSwitchHistorySetting;
	ui: UISetting;
}

const isChineseUser =
	typeof window !== "undefined" &&
	window.localStorage.getItem("language") === "zh";

export const DEFAULT_FILE_SEARCH_BACKEND = "coverage-lexical" as const;
export const DEFAULT_WEAK_FILE_PRUNE_MODE = "lenient" as const;
export const DEFAULT_HIDE_WEAKLY_RELATED_RESULTS = true as const;
export const CURRENT_OUTER_SETTING_SCHEMA_VERSION = 3 as const;

export const DEFAULT_OUTER_SETTING: OuterSetting = {
	settingsSchemaVersion: CURRENT_OUTER_SETTING_SCHEMA_VERSION,
	customExtensions: { plaintext: ["md"] },
	releaseAnnouncements: {
		seenVersions: [],
	},
	followObsidianExcludedFiles: true,
	excludedPaths: [],
	logLevel: isDevEnvironment ? "trace" : "info",
	fileSearchBackend: DEFAULT_FILE_SEARCH_BACKEND,
	hideWeaklyRelatedResults: DEFAULT_HIDE_WEAKLY_RELATED_RESULTS,
	weakFilePruneMode: DEFAULT_WEAK_FILE_PRUNE_MODE,
	isCaseSensitive: false,
	isPrefixMatch: true,
	isFuzzy: true,
	enableStopWordsEn: true,
	// TODO: traditional Chinese
	enableChinesePatch: isChineseUser ? true : false,
	enableStopWordsZh: isChineseUser ? true : false,
	hybrid: {
		enabled: false,
		autoShowResultsWhenLexicalEmpty: true,
		autoTriggerOnInput: true,
		autoTriggerDebounceMs: 400,
		embeddingProvider: "qwen",
		apiDomain: "",
		apiKey: "",
		weeklyTokenLimit: 3000000,
		maxResultCount: 10,
		indexConcurrency: 3,
		minIncrementalEmbedIntervalSec: 180,
		failedEmbeddingRetryIntervalMin: 10,
		vectorCompression: "int8",
		excludedPaths: [],
	},
	searchHistory: {
		enabled: true,
		maxItems: 5000,
		showSuggestions: true,
		enableGhostCompletion: true,
		sources: {
			history: true,
			file: true,
			alias: true,
			heading: true,
			path: true,
			recentFile: true,
		},
		entries: [],
	},
	quickSwitchHistory: {
		enabled: true,
		maxItems: 5000,
		navigationEntries: [],
		quickCommandEntries: [],
	},
	ui: {
		openInNewPane: true,
		maxItemResults: 30,
		floatingWindowForInFile: true,
		showedExtension: "except md",
		// collapseDevSettingByDefault: isDevEnvironment ? false : true,
		collapseDevSettingByDefault: false,
		inFileFloatingWindowTop: "2.7em",
		inFileFloatingWindowLeft: "2.5em",
	},
};

export type LogLevelOptions = {
	[K in LogLevel]: K;
};

export type FileSearchBackend =
	| "minisearch"
	| "coverage-lexical";

export type WeakFilePruneMode =
	| "off"
	| "lenient"
	| "strict";

export function isFileSearchBackend(value: unknown): value is FileSearchBackend {
	return value === "minisearch" || value === "coverage-lexical";
}

export function normalizeFileSearchBackend(
	value: unknown,
): FileSearchBackend {
	return isFileSearchBackend(value) ? value : DEFAULT_FILE_SEARCH_BACKEND;
}

export function isWeakFilePruneMode(value: unknown): value is WeakFilePruneMode {
	return value === "off" || value === "lenient" || value === "strict";
}

export function normalizeWeakFilePruneMode(
	value: unknown,
): WeakFilePruneMode {
	return isWeakFilePruneMode(value) ? value : DEFAULT_WEAK_FILE_PRUNE_MODE;
}

export function normalizeHideWeaklyRelatedResults(value: unknown): boolean {
	return typeof value === "boolean"
		? value
		: DEFAULT_HIDE_WEAKLY_RELATED_RESULTS;
}

export function toLegacyWeakFilePruneMode(
	hideWeaklyRelatedResults: boolean,
): WeakFilePruneMode {
	return hideWeaklyRelatedResults ? DEFAULT_WEAK_FILE_PRUNE_MODE : "off";
}
export type HybridSetting = {
	enabled: boolean;
	autoShowResultsWhenLexicalEmpty: boolean;
	autoTriggerOnInput: boolean;
	autoTriggerDebounceMs: number;
	embeddingProvider: HybridEmbeddingProvider;
	apiDomain: string;
	apiKey: string;
	weeklyTokenLimit: number; // 0 = unlimited
	maxResultCount: number;
	indexConcurrency: number;
	minIncrementalEmbedIntervalSec: number;
	failedEmbeddingRetryIntervalMin: number;
	vectorCompression: HybridVectorCompression;
	excludedPaths: string[];
};

export type ReleaseAnnouncementSetting = {
	seenVersions: string[];
};

export type HybridEmbeddingProvider = "qwen" | "openai";

export type HybridVectorCompression = "int8" | "float16";

export type SearchHistoryNavigationKind =
	| "file"
	| "alias"
	| "heading"
	| "path"
	| "recent"
	| "quickCommand";

export type SearchHistoryEntry = {
	queryText: string;
	timestamp: number;
	count?: number;
	selectionCount?: number;
	selectionTimestamp?: number;
};

export type SearchHistoryMaxItems = 20 | 50 | 100 | 1000 | 3000 | 5000 | 10000;
export type SearchAutocompleteSourceSettings = {
	history: boolean;
	file: boolean;
	alias: boolean;
	heading: boolean;
	path: boolean;
	recentFile: boolean;
};

export type SearchHistorySetting = {
	enabled: boolean;
	maxItems: SearchHistoryMaxItems;
	showSuggestions: boolean;
	enableGhostCompletion: boolean;
	sources: SearchAutocompleteSourceSettings;
	entries: SearchHistoryEntry[];
};

export type QuickSwitchHistoryQueryEntry = {
	queryText: string;
	timestamp: number;
	count?: number;
};

export type QuickSwitchHistoryEntry = {
	path: string;
	primaryText: string;
	secondaryText?: string;
	kind: SearchHistoryNavigationKind;
	openLinkText: string;
	timestamp: number;
	count?: number;
	lastDateKey?: string;
	recentDateKeys?: string[];
	dayStreak?: number;
	queries?: QuickSwitchHistoryQueryEntry[];
};

export type QuickSwitchHistorySetting = {
	enabled: boolean;
	maxItems: SearchHistoryMaxItems;
	navigationEntries: QuickSwitchHistoryEntry[];
	quickCommandEntries: QuickSwitchHistoryEntry[];
};

/** One record per (filePath, dateKey) where dateKey = "YYYY-MM-DD" */
export type HybridTokenRecord = {
	id?: number;
	filePath: string;
	dateKey: string; // "YYYY-MM-DD"
	tokens: number;
};

export type HybridTokenSavingRecord = {
	id?: number;
	scope: "week" | "total";
	periodKey: string;
	tokens: number;
};

export type HybridTokenBudgetResetRecord = {
	id?: number;
	periodKey: string;
	tokens: number;
};

export type UISetting = {
	openInNewPane: boolean;
	maxItemResults: number;
	floatingWindowForInFile: boolean;
	showedExtension: "none" | "except md" | "all";
	collapseDevSettingByDefault: boolean;
	inFileFloatingWindowTop: string;
	inFileFloatingWindowLeft: string;
	inFileFloatingWindowWidth?: string;
	inFileFloatingWindowHeight?: string;
};

// ========== transparent for users ==========
type InnerSetting = {
	search: {
		fuzzyProportion: number;
		minTermLengthForPrefixSearch: number;
		weightFilename: number;
		weightFolder: number;
		weightTagText: number;
		weightHeading: number;
		// weightH1: number;
		// weightH2: number;
		// weightH3: number;
		// weightH4: number;
	};
};

export const innerSetting: InnerSetting = {
	search: {
		fuzzyProportion: 0.2,
		minTermLengthForPrefixSearch: 2,
		weightFilename: 3,
		weightFolder: 2,
		weightTagText: 1.15,
		weightHeading: 1.27,
		// weightH1: 1.6,
		// weightH2: 1.4,
		// weightH3: 1.25,
		// weightH4: 1.1,
	},
};
