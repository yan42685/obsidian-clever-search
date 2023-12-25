import { App, TFile, Vault, parseFrontMatterAliases } from "obsidian";
import { DEFAULT_BLACKLIST_EXTENSION } from "src/globals/constants";
import type { IndexedDocument } from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { MyLib, getInstance } from "src/utils/my-lib";
import { container } from "tsyringe";
import { PluginSetting } from "../obsidian/setting";
import { Tokenizer } from "./tokenizer";

export class DataProvider {
	private readonly tokenizer = container.resolve(Tokenizer);
	private readonly vault = container.resolve(Vault);
	private readonly app = container.resolve(App);

	async generateAllIndexedDocuments(): Promise<IndexedDocument[]> {
		const fileRetriever = getInstance(FileRetriever);
		const filesToIndex = await fileRetriever.allFilesToBeIndexed();
		// MyLib.countFileByExtensions(filesToIndex);
		logger.debug(`${filesToIndex.length} files need to be indexed.`);
		// TODO: remove this line
		// files = files.slice(0, 100);
		return Promise.all(
			filesToIndex.map(async (file) => {
				if (fileRetriever.isContentIndexable(file)) {
					const metadata = this.app.metadataCache.getFileCache(file);
					return {
						path: file.path,
						basename: file.basename,
						aliases: (
							parseFrontMatterAliases(metadata?.frontmatter) || []
						).join(""),
						content: await this.vault.cachedRead(file),
					};
				} else {
					return {
						path: file.path,
						basename: file.basename,
					};
				}
			}),
		);
	}
}

export class FileRetriever {
	private readonly vault: Vault = container.resolve(Vault);
	private readonly setting: PluginSetting = container.resolve(PluginSetting);
	private static readonly CONTENT_INDEXABLE_EXTENSIONS = new Set(["md"]);
	private readonly extensionBlacklist;
	constructor() {
		this.extensionBlacklist = new Set([
			...DEFAULT_BLACKLIST_EXTENSION.map(MyLib.getExtension),
			...this.setting.excludeExtensions.map(MyLib.getExtension),
		]);
	}

	// @monitorDecorator
	async allFilesToBeIndexed(): Promise<TFile[]> {
		// get all files cached by obsidian
		const files = this.vault.getFiles();
		logger.info(`all files: ${files.length}`);
		MyLib.countFileByExtensions(files);

		// TODO: compare mtime and then filter
		const result = files.filter((file) => this.isExtensionSupported(file));
		logger.info(`files to be indexed: ${files.length}`);
		MyLib.countFileByExtensions(result);
		return result;
	}

	// if isContentIndexable(file) === true, then isPathIndexable(file) will always return true
	isContentIndexable(file: TFile): boolean {
		return FileRetriever.CONTENT_INDEXABLE_EXTENSIONS.has(file.extension);
	}
	isExtensionSupported(file: TFile): boolean {
		return !this.extensionBlacklist.has(file.extension);
	}
}
