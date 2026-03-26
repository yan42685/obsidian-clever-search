import { container } from "tsyringe";

jest.mock("src/utils/web/assets-provider", () => ({
	AssetsProvider: class MockAssetsProvider {},
}));

jest.mock("src/integrations/languages/chinese-patch", () => ({
	ChinesePatch: class MockChinesePatch {},
}));

describe("Tokenizer", () => {
	beforeEach(() => {
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		(global as any).window = {
			localStorage: {
				getItem: jest.fn(() => "zh"),
			},
		};
	});

	afterEach(() => {
		delete (global as any).window;
		if ("reset" in container && typeof (container as any).reset === "function") {
			(container as any).reset();
		} else {
			container.clearInstances();
		}
		jest.resetModules();
	});

	test("drops whitespace and punctuation-only tokens from the Chinese segmentation path", () => {
		const {
			OuterSetting,
			DEFAULT_OUTER_SETTING,
		} = require("src/globals/plugin-setting");
		const { AssetsProvider } = require("src/utils/web/assets-provider");
		const { ChinesePatch } = require("src/integrations/languages/chinese-patch");
		const { Tokenizer } = require("src/services/search/tokenizer");

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
				cut: jest.fn((text: string) => {
					if (text.startsWith("ContributionWidget")) {
						return ["ContributionWidget", "：", "来自"];
					}
					if (text.startsWith("Vran")) {
						return [" ", "Vran", "，", "功能", "挺全"];
					}
					return [];
				}),
			},
		});

		const tokenizer = new Tokenizer() as InstanceType<typeof Tokenizer>;
		const tokens = tokenizer.tokenizeSequence(
			"ContributionWidget：来自 Vran，功能挺全",
			"index",
		);

		expect(tokens).toEqual([
			"ContributionWidget",
			"来自",
			"Vran",
			"功能",
			"挺全",
		]);
	});
});
