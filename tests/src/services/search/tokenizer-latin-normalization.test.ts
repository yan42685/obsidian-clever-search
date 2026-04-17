import { container } from "tsyringe";

jest.mock("src/utils/web/assets-provider", () => ({
	AssetsProvider: class MockAssetsProvider {},
}));

jest.mock("src/integrations/languages/chinese-patch", () => ({
	ChinesePatch: class MockChinesePatch {},
}));

describe("Tokenizer latin normalization", () => {
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

	test("normalizes latin tokens and offset tokens to lowercase nfkc output", () => {
		const {
			OuterSetting,
			DEFAULT_OUTER_SETTING,
		} = require("src/globals/plugin-setting");
		const { AssetsProvider } = require("src/utils/web/assets-provider");
		const { ChinesePatch } = require("src/integrations/languages/chinese-patch");
		const { Tokenizer } = require("src/services/search/tokenizer");

		const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
		setting.enableChinesePatch = false;
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
				cut: jest.fn(() => []),
			},
		});

		const tokenizer = new Tokenizer() as InstanceType<typeof Tokenizer>;

		expect(tokenizer.tokenizeSequence("ＦreeFont CorpSrcWinSong", "index")).toEqual([
			"freefont",
			"free",
			"font",
			"corpsrcwinsong",
			"corp",
			"src",
			"win",
			"song",
		]);
		expect(
			tokenizer.tokenizeSequenceWithOffsets("ＦreeFont CorpSrcWinSong", "search"),
		).toEqual(
			expect.arrayContaining([
				{ token: "freefont", start: 0, end: 8 },
				{ token: "free", start: 0, end: 4 },
				{ token: "font", start: 4, end: 8 },
				{ token: "corpsrcwinsong", start: 9, end: 23 },
				{ token: "corp", start: 9, end: 13 },
				{ token: "src", start: 13, end: 16 },
				{ token: "win", start: 16, end: 19 },
				{ token: "song", start: 19, end: 23 },
			]),
		);
	});
});
