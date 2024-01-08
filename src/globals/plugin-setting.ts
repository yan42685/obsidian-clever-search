import type { LogLevel } from "src/utils/logger";
import { isDevEnvironment } from "src/utils/my-lib";


export class PluginSetting {
	mySetting: string;
	logLevel: LogLevel;
	enableStopWordsEn: boolean;
	enableChinesePatch: boolean;
	enableStopWordsZh: boolean;
	apiProvider1: ApiProvider;
	apiProvider2: ApiProvider;
	excludeExtensions: string[];
	search: SearchSetting;
	ui: UISetting;
}

export const DEFAULT_PLUGIN_SETTING: PluginSetting = {
	mySetting: "default",
	logLevel: isDevEnvironment ? "debug" : "none",
	enableStopWordsEn: true,
	enableChinesePatch: false,
	enableStopWordsZh: true,
	apiProvider1: {
		domain: "",
		key: "",
	},
	apiProvider2: {
		domain: "",
		key: "",
	},
	excludeExtensions: [],
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
	ui: {
		openInNewPane: true,
		maxItemResults: 30,
		showedExtension: "except md"
	}
};

export type LogLevelOptions = {
    [K in LogLevel]: K;
};

export type ApiProvider = {
	domain: string;
	key: string;
};

export type SearchSetting = {
	fuzzyProportion: 0.1 | 0.2;
	minTermLengthForPrefixSearch: 1 | 2 | 3 | 4;
	weightFilename: number;
	weightFolder: number;
	weightTagText: number;
	weightHeading: number;
	// weightH1: number;
	// weightH2: number;
	// weightH3: number;
	// weightH4: number;
};


export type UISetting = {
	openInNewPane: boolean,
	maxItemResults: number,
	showedExtension: "none" | "except md" | "all",
}


// transparent for users
type InnerSetting = {
	search: {
		minTermLengthForPrefix: number,
	}
}

const innerSetting: InnerSetting = {
	search: {
		minTermLengthForPrefix: 3
	}
}
const inSetting = innerSetting