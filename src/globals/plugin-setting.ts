import type { LogLevel } from "src/utils/logger";
import { isDevEnvironment } from "src/utils/my-lib";

// exposed to users
export class OuterSetting {
	customExtensions: {
		plaintext: string[];
	};
	followObsidianExcludedFiles: boolean;
	excludedPaths: string[]; // NOTE: can't use Set() or it will be a non-iterable object after deserialization
	logLevel: LogLevel;
	isCaseSensitive: boolean;
	isPrefixMatch: boolean;
	isFuzzy: boolean;
	enableStopWordsEn: boolean;
	enableChinesePatch: boolean;
	enableStopWordsZh: boolean;
	apiProvider1: ApiProvider;
	apiProvider2: ApiProvider;
	ui: UISetting;
	semantic: SemanticSetting;
}

const isChineseUser = window.localStorage.getItem("language") === "zh";

export const DEFAULT_OUTER_SETTING: OuterSetting = {
	customExtensions: { plaintext: ["md"] },
	followObsidianExcludedFiles: true,
	excludedPaths: [],
	logLevel: isDevEnvironment ? "trace" : "info",
	isCaseSensitive: false,
	isPrefixMatch: true,
	isFuzzy: true,
	enableStopWordsEn: true,
	// TODO: 繁体中文
	enableChinesePatch: isChineseUser ? true : false,
	enableStopWordsZh: isChineseUser ? true : false,
	apiProvider1: {
		domain: "",
		key: "",
	},
	apiProvider2: {
		domain: "",
		key: "",
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
	semantic: {
		isEnabled: false,
		serverType: "local"
	}
};

export type LogLevelOptions = {
	[K in LogLevel]: K;
};

export type ApiProvider = {
	domain: string;
	key: string;
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

export type SemanticSetting = {
	isEnabled: boolean
	serverType: "local" | "remote"
}

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
