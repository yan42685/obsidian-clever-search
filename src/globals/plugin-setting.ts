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
	enableStopWordsEn: false,
	enableChinesePatch: false,
	enableStopWordsZh: false,
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
		weightPath: 3,
		weightH1: 1.6,
		weightH2: 1.4,
		weightH3: 1.25,
		weightH4: 1.1,
		weightTagText: 1.1,
	},
	ui: {
		openInNewPane: true,
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
	weightPath: number;
	weightH1: number;
	weightH2: number;
	weightH3: number;
	weightH4: number;
	weightTagText: number;
};


export type UISetting = {
	openInNewPane: boolean,
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