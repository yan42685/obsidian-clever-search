import { App, TFile, Vault, parseFrontMatterAliases } from "obsidian";
import { DEFAULT_BLACKLIST_EXTENSION } from "src/globals/constants";
import type { IndexedDocument } from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { MyLib } from "src/utils/my-lib";
import { container } from "tsyringe";
import { PluginSetting } from "../obsidian/setting";
import { Tokenizer } from "./tokenizer";

export class DataProvider {
	private readonly tokenizer = container.resolve(Tokenizer);
	private readonly vault = container.resolve(Vault);
	private readonly app = container.resolve(App);

	async generateAllIndexedDocuments(): Promise<IndexedDocument[]> {
		const filesToIndex = await new FileRetriever().getFilesToBeIndexed();
		// MyLib.countFileByExtensions(filesToIndex);
		logger.debug(`${filesToIndex.length} files need to be indexed.`);
		// TODO: remove this line
		// files = files.slice(0, 100);
		return Promise.all(
			filesToIndex.map(async (file) => {
				const metadata = this.app.metadataCache.getFileCache(file);
				return {
					path: file.path,
					basename: file.basename,
					aliases: (
						parseFrontMatterAliases(metadata?.frontmatter) || []
					).join(""),
					content: await this.vault.cachedRead(file),
				};
			}),
		);
	}
}

class FileRetriever {
	private readonly vault: Vault = container.resolve(Vault);
	private readonly setting: PluginSetting = container.resolve(PluginSetting);
	private readonly extensionBlackSet;
	constructor() {
		this.extensionBlackSet = new Set([
			...DEFAULT_BLACKLIST_EXTENSION.map(MyLib.getExtension),
			...this.setting.excludeExtensions.map(MyLib.getExtension),
		]);
	}

	// @monitorDecorator
	async getFilesToBeIndexed(): Promise<TFile[]> {
		// TODO: compare mtime and then filter
		// get all files cached by obsidian
		const files = this.vault.getFiles();
		logger.info(`files count: ${files.length}`);
		MyLib.countFileByExtensions(files);
		// 当直接传递this.isFileIndexable给filter时，isFileIndexable方法就脱离了其原始对象FileRetriever的上下文
		// 需要显式绑定, 显式绑定有两种方法，
		// 1. this.isFileIndexable.bind(this)
		// 2. (file) => this.isFileIndexable(file)   因为箭头函数不会创建this上下文
		return files.filter(this.isFileIndexable.bind(this));
	}

	private isFileIndexable(file: TFile): boolean {
		// logger.debug(`${file.path} -- ${file.extension}`);

		return this.isExtensionValid(file);
	}
	private isExtensionValid(file: TFile): boolean {
		return !this.extensionBlackSet.has(file.extension);
	}
}
