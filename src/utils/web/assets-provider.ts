import { PluginSetting } from "src/globals/plugin-setting";
import { singleton } from "tsyringe";
import { FileUtil, fsUtil, pathUtil } from "../file-util";
import { logger } from "../logger";
import { getInstance } from "../my-lib";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const electron = require("electron");
const userDataPath = (electron.app || electron.remote.app).getPath("userData");

const assetsDir = pathUtil.join(userDataPath, "clever-search");

const unpkgUrl = "https://unpkg.com/";
const tiktokenSourceUrl = unpkgUrl + "@dqbd/tiktoken@1.0.7/tiktoken_bg.wasm";
const tiktokenTargetUrl = pathUtil.join(assetsDir, "tiktoken_bg.wasm");
const stopWordsSourceUrl = "https://raw.githubusercontent.com/goto456/stopwords/master/baidu_stopwords.txt"
const stopWordsTargetUrl = pathUtil.join(assetsDir, "baidu_stopwords.txt");
const jiebaSourceUrl =
	unpkgUrl + "jieba-wasm@0.0.2/pkg/web/jieba_rs_wasm_bg.wasm";


const UTF_8 = "utf-8";
@singleton()
export class AssetsProvider {
	readonly jiebaTargetUrl = pathUtil.join(assetsDir, "jieba_rs_wasm_bg.wasm");

	private readonly setting = getInstance(PluginSetting);
	private readonly commonAssets: CommonAssets = { stopWords: new Set<string> };

	async initAsync() {
		await this.downloadAssets();
		await this.loadCommonAssets();
	}

	async loadFileAsync(path: string): Promise<ArrayBuffer | null> {
		try {
			return await fsUtil.promises.readFile(path);
		} catch (e) {
			logger.error(`failed to load ${path}`);
			throw new Error(e);
		}
	}

	getCommonAssets(): CommonAssets {
		return this.commonAssets;
	}

	private async downloadAssets() {
		logger.trace("Downloading assets...");
		logger.trace(`target dir: ${assetsDir}`);
		// logger.info("tiktoken source url: " + tiktokenSourceUrl);
		// logger.info("tiktoken target url: " + tiktokenTargetUrl);
		// await this.downloadFile(tiktokenTargetUrl, tiktokenSourceUrl);
		if (this.setting.enableCjkPatch) {
			await this.downloadFile(this.jiebaTargetUrl, jiebaSourceUrl);
		}
		await this.downloadFile(stopWordsTargetUrl, stopWordsSourceUrl);
	}

	private async loadCommonAssets() {
		logger.trace("Loading common assets...");
		this.commonAssets.stopWords = new Set(
			(
				await fsUtil.promises.readFile(stopWordsTargetUrl, {
					encoding: UTF_8,
				})
			).split(FileUtil.SPLIT_EOL),
		);
	}

	private async downloadFile(
		targetPath: string,
		sourceUrl: string,
	): Promise<void> {
		// check if the file already exists
		try {
			await fsUtil.promises.access(targetPath);
			logger.trace("file exists:", targetPath);
			return;
		} catch (error) {
			if (error.code !== "ENOENT") throw error; // rethrow if it's an error other than "file not found"
		}

		// create dir recursively if not exists
		const targetDir = pathUtil.dirname(targetPath);
		await fsUtil.promises
			.mkdir(targetDir, { recursive: true })
			.catch((error) => {
				if (error.code !== "EEXIST") throw error; // only ignore the error if the directory already exists
			});

		// download the file
		const response = await fetch(sourceUrl);
		if (!response.ok)
			throw new Error(`unexpected response ${response.statusText}`);

		try {
			await fsUtil.promises.writeFile(
				targetPath,
				Buffer.from(await response.arrayBuffer()),
			);
			logger.info(`successfully download from ${sourceUrl}`);
		} catch (error) {
			logger.error(`failed to download ${sourceUrl}`);
			throw error;
		}
	}
}

type CommonAssets = {
	stopWords: Set<string>;
};
