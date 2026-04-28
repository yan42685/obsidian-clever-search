// @ts-nocheck
import * as fs from "fs";
import * as path from "path";
import { container } from "tsyringe";

function readWordSet(filename: string): Set<string> {
	const filePath = path.resolve(process.cwd(), "assets/for-program", filename);
	return new Set(
		fs
			.readFileSync(filePath, "utf8")
			.split(/\r?\n/u)
			.map((line) => line.trim().toLowerCase())
			.filter((line) => line.length > 0),
	);
}

function readJiebaBinary(): Promise<ArrayBuffer> {
	const filePath = path.resolve(
		process.cwd(),
		"assets/for-program/jieba_rs_wasm_bg.wasm",
	);
	return fs.promises.readFile(filePath).then((buffer) =>
		buffer.buffer.slice(
			buffer.byteOffset,
			buffer.byteOffset + buffer.byteLength,
		),
	);
}

export async function registerProductionTokenizerStartupDependencies(
	backend: "minisearch" | "coverage-lexical",
): Promise<void> {
	const {
		OuterSetting,
		DEFAULT_OUTER_SETTING,
	} = require("src/globals/plugin-setting");
	const { AssetsProvider } = require("src/utils/web/assets-provider");
	const { ChinesePatch } = require("src/integrations/languages/chinese-patch");
	const { Tokenizer } = require("src/services/search/tokenizer");
	const setting = JSON.parse(JSON.stringify(DEFAULT_OUTER_SETTING));
	setting.fileSearchBackend = backend;
	setting.isCaseSensitive = false;
	setting.enableChinesePatch = true;
	setting.enableStopWordsEn = true;
	setting.enableStopWordsZh = true;

	container.register(OuterSetting, { useValue: setting });
	container.register(AssetsProvider, {
		useValue: {
			assets: {
				jiebaBinary: readJiebaBinary(),
				stopWordsEn: readWordSet("stop-words-en.txt"),
				stopWordsZh: readWordSet("stop-words-zh.txt"),
			},
		},
	});

	const chinesePatch = container.resolve(ChinesePatch);
	await chinesePatch.initAsync();
	const probe = chinesePatch.cut("中文分词", true);
	if (probe.length === 1 && probe[0] === "中文分词") {
		throw new Error("production tokenizer benchmark failed to initialize jieba");
	}
	container.register(ChinesePatch, { useValue: chinesePatch });
	container.register(Tokenizer, { useValue: new Tokenizer() });
}

export async function createProductionTokenizerStartupEngine(
	EngineCtor: new () => any,
	backend: "minisearch" | "coverage-lexical",
): Promise<any> {
	await registerProductionTokenizerStartupDependencies(backend);
	return new EngineCtor();
}
