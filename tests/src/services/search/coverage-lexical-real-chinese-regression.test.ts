import { container } from "tsyringe";

jest.mock("src/utils/web/assets-provider", () => ({
	AssetsProvider: class MockAssetsProvider {},
}));

jest.mock("src/integrations/languages/chinese-patch", () => ({
	ChinesePatch: class MockChinesePatch {},
}));

function resetContainerState(): void {
	if ("reset" in container && typeof (container as any).reset === "function") {
		(container as any).reset();
	} else {
		container.clearInstances();
	}
}

function registerRealChineseTokenizerRuntime(
	segmentations: Record<string, string[]>,
): void {
	const {
		OuterSetting,
		DEFAULT_OUTER_SETTING,
	} = require("src/globals/plugin-setting");
	const { AssetsProvider } = require("src/utils/web/assets-provider");
	const { ChinesePatch } = require("src/integrations/languages/chinese-patch");

	const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
	setting.enableChinesePatch = true;
	setting.enableStopWordsZh = false;
	setting.enableStopWordsEn = false;

	container.register(OuterSetting, { useValue: setting });
	container.register(AssetsProvider, {
		useValue: {
			assets: {
				stopWordsZh: null,
				stopWordsEn: null,
			},
		},
	});
	container.register(ChinesePatch, {
		useValue: {
			cut: jest.fn((text: string) => segmentations[text] ?? [text]),
		},
	});
}

describe("coverage lexical real Chinese tokenizer regression", () => {
	beforeEach(() => {
		resetContainerState();
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
				setItem: jest.fn(),
				removeItem: jest.fn(),
			},
		};
	});

	afterEach(() => {
		delete (global as any).window;
		resetContainerState();
		jest.resetModules();
	});

	test("tokenizer keeps short Chinese and mixed-script queries split with real Chinese words", () => {
		registerRealChineseTokenizerRuntime({
			政治理论: ["政治", "理论"],
			快乐定义适用范围: ["快乐", "定义", "适用范围"],
			运行时访问: ["运行时", "访问"],
			问题排查: ["问题", "排查"],
		});

		const { Tokenizer } = require("src/services/search/tokenizer");
		const tokenizer = new Tokenizer() as {
			tokenize(text: string, mode: "index" | "search"): string[];
			tokenizeSequence(text: string, mode: "index" | "search"): string[];
		};

		expect(tokenizer.tokenizeSequence("政治理论", "search")).toEqual([
			"政治",
			"理论",
		]);

		expect(tokenizer.tokenizeSequence("快乐定义适用范围", "search")).toEqual([
			"快乐",
			"定义",
			"适用范围",
		]);

		expect(tokenizer.tokenize("projected token 运行时访问", "search")).toEqual([
			"projected",
			"token",
			"运行时",
			"访问",
		]);

		expect(tokenizer.tokenize("obsidian sync 问题排查", "search")).toEqual([
			"obsidian",
			"sync",
			"问题",
			"排查",
		]);

		expect(
			tokenizer.tokenizeSequence("关于快乐的定义和适用范围", "search"),
		).toEqual(["关于快乐的定义和适用范围"]);
	});
});
