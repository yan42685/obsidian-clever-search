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
		return Promise.all(
			filesToIndex.map(async (file) => {
				if (fileRetriever.isContentReadable(file)) {
					return {
						path: file.path,
						basename: file.basename,
						folder: MyLib.getFolderPath(file.path),
						aliases: this.parseAliases(file),
						content: await fileRetriever.readContent(file),
					};
				} else {
					return {
						path: file.path,
						basename: file.basename,
						folder: MyLib.getFolderPath(file.path),
					};
				}
			}),
		);
	}

	private parseAliases(file: TFile) {
		const metadata = this.app.metadataCache.getFileCache(file);
		return (parseFrontMatterAliases(metadata?.frontmatter) || []).join("");
	}
}

export class FileRetriever {
	private static readonly plainTextExtensions = new Set(["md", "txt", ""]);
	private static readonly readableExtensions = new Set([
		...FileRetriever.plainTextExtensions,
	]);
	private readonly vault: Vault = container.resolve(Vault);
	private readonly setting: PluginSetting = container.resolve(PluginSetting);
	private readonly extensionBlacklist;
	constructor() {
		this.extensionBlacklist = new Set([
			...DEFAULT_BLACKLIST_EXTENSION.map(MyLib.getExtension),
			...this.setting.excludeExtensions.map(MyLib.getExtension),
		]);
	}

	// @monitorDecorator
	async allFilesToBeIndexed(): Promise<TFile[]> {
		// get all fileRefs cached by obsidian
		const files = this.vault.getFiles();
		logger.info(`all files: ${files.length}`);
		MyLib.countFileByExtensions(files);

		// TODO: compare mtime and then filter
		const result = files.filter((file) => this.shouldIndex(file));
		logger.info(`files to be indexed: ${files.length}`);
		MyLib.countFileByExtensions(result);

		return result;
	}
	isContentReadable(file: TFile): boolean {
		return FileRetriever.readableExtensions.has(file.extension);
	}
	async readContent(file: TFile): Promise<string> {
		if (FileRetriever.plainTextExtensions.has(file.extension)) {
			return this.vault.cachedRead(file);
		} else {
			throw Error(
				`unsupported file extension to read, path: ${file.path}`,
			);
		}
	}
	async readContentByPath(path: string): Promise<string> {
		const file = this.vault.getAbstractFileByPath(path) as TFile
		return this.readContent(file);
	}

	private shouldIndex(file: TFile): boolean {
		// TODO: filter by extensions and paths
		return true;
	}
}
