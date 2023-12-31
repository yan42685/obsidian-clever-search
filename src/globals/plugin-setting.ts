import type { LogLevel } from "src/utils/logger";
import { isDevEnvironment } from "src/utils/my-lib";


export class PluginSetting {
	mySetting: string;
	openInNewPane: boolean;
	logLevel: LogLevel;
	apiProvider1: ApiProvider;
	apiProvider2: ApiProvider;
	excludeExtensions: string[];
	search: SearchSetting;
}

export const DEFAULT_PLUGIN_SETTING: PluginSetting = {
	mySetting: "default",
	openInNewPane: true,
	logLevel: isDevEnvironment ? "debug" : "none",
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
		minTermLengthForPrefixSearch: 1,
		weightPath: 3,
		weightH1: 1.6,
		weightH2: 1.4,
		weightH3: 1.25,
		weightH4: 1.1,
		weightTagText: 1.1,
	},
};

export type ApiProvider = {
	domain: string;
	key: string;
};

export type SearchSetting = {
	fuzzyProportion: 0.1 | 0.2;
	minTermLengthForPrefixSearch: 1 | 2 | 3;
	weightPath: number;
	weightH1: number;
	weightH2: number;
	weightH3: number;
	weightH4: number;
	weightTagText: number;
};

export type LogLevelOptions = {
    [K in LogLevel]: K;
};