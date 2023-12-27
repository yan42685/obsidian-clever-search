import { App, TFile, Vault, parseFrontMatterAliases } from "obsidian";
import { DEFAULT_BLACKLIST_EXTENSION } from "src/globals/constants";
import { FileType, type IndexedDocument } from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { MyLib, TO_BE_IMPL, getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { PluginSetting } from "../obsidian/setting";
import { Tokenizer } from "./tokenizer";

@singleton()
export class DataProvider {
	private readonly tokenizer = getInstance(Tokenizer);
	private readonly vault = getInstance(Vault);
	private readonly app = getInstance(App);

	async generateAllIndexedDocuments(): Promise<IndexedDocument[]> {
		const fileRetriever = getInstance(FileRetriever);
		const filesToIndex = fileRetriever.allFilesToBeIndexed();
		return Promise.all(
			filesToIndex.map(async (file) => {
				if (fileRetriever.isContentIndexable(file)) {
					if (
						fileRetriever.getFileType(file.path) ===
						FileType.PLAIN_TEXT
					) {
						return {
							path: file.path,
							basename: file.basename,
							folder: MyLib.getFolderPath(file.path),
							aliases: this.parseAliases(file),
							content: await fileRetriever.readPlainText(file),
						};
					} else {
						throw new Error(TO_BE_IMPL);
					}
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

@singleton()
export class FileRetriever {
	private static readonly contentIndexableFileTypes = new Set([
		FileType.PLAIN_TEXT,
		FileType.IMAGE,
	]);
	private static readonly fileTypeMap: Map<string, FileType> = new Map();
	static {
		FileRetriever.fileTypeMap.set("", FileType.PLAIN_TEXT);
		FileRetriever.fileTypeMap.set("md", FileType.PLAIN_TEXT);
		FileRetriever.fileTypeMap.set("markdown", FileType.PLAIN_TEXT);
		FileRetriever.fileTypeMap.set("txt", FileType.PLAIN_TEXT);
		FileRetriever.fileTypeMap.set("jpg", FileType.IMAGE);
		FileRetriever.fileTypeMap.set("png", FileType.IMAGE);
	}
	private readonly vault: Vault = getInstance(Vault);
	private readonly setting: PluginSetting = getInstance(PluginSetting);
	private readonly extensionBlacklist;
	constructor() {
		this.extensionBlacklist = new Set([
			...DEFAULT_BLACKLIST_EXTENSION.map(MyLib.getExtension),
			...this.setting.excludeExtensions.map(MyLib.getExtension),
		]);
	}

	// @monitorDecorator
	allFilesToBeIndexed(): TFile[] {
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
	isContentIndexable(file: TFile): boolean {
		return FileRetriever.contentIndexableFileTypes.has(
			this.getFileType(file.path),
		);
	}

	getFileType(path: string): FileType {
		const result = FileRetriever.fileTypeMap.get(MyLib.getExtension(path));
		// NOTE: shouldn't use `result ? FileType.UNSUPPORTED : result;`
		// because result might be 0 rather than undefined
		return result === undefined ? FileType.UNSUPPORTED : result;
	}

	/**
	 * Reads the content of a plain text file.
	 * @param fileOrPath The file object or path string of the file to read.
	 * @returns The content of the file as a string.
	 * @throws Error if the file extension is not supported.
	 */
	async readPlainText(fileOrPath: TFile | string): Promise<string> {
		const file =
			typeof fileOrPath === "string"
				? (this.vault.getAbstractFileByPath(fileOrPath) as TFile)
				: fileOrPath;
		if (this.getFileType(file.path) === FileType.PLAIN_TEXT) {
			return this.vault.cachedRead(file);
		} else {
			throw Error(
				`unsupported file extension as plain text to read, path: ${file.path}`,
			);
		}
	}

	async readPlainTextLines(fileOrPath: TFile | string): Promise<string[]> {
		return (await this.readPlainText(fileOrPath)).split("\n");
	}

	private shouldIndex(file: TFile): boolean {
		// TODO: filter by extensions and paths
		return true;
	}
}
