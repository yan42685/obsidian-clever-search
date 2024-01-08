import { App, FileSystemAdapter, TAbstractFile, TFile, TFolder, Vault, parseFrontMatterAliases } from "obsidian";
import type { IndexedDocument } from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { TO_BE_IMPL, getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { FileType, FileUtil } from "../../../utils/file-util";
import { Tokenizer } from "../../search/tokenizer";
import { PrivateApi } from "../private-api";

@singleton()
export class DataProvider {
	private readonly tokenizer = getInstance(Tokenizer);
	private readonly vault = getInstance(Vault);
	private readonly app = getInstance(App);
	private readonly supportedExtensions = new Set(["md"]);
	private readonly privateApi = getInstance(PrivateApi);
	public readonly obsidianFs = this.vault.adapter as FileSystemAdapter

	private static readonly contentIndexableFileTypes = new Set([
		FileType.PLAIN_TEXT,
		FileType.IMAGE,
	]);

	async generateAllIndexedDocuments(files: TFile[]): Promise<IndexedDocument[]> {
		return Promise.all(
			files.map(async (file) => {
				if (this.isContentIndexable(file)) {
					if (
						FileUtil.getFileType(file.path) === FileType.PLAIN_TEXT
					) {
						return {
							path: file.path,
							basename: file.basename,
							folder: FileUtil.getFolderPath(file.path),
							aliases: this.parseAliases(file),
							content: await this.readPlainText(file),
						};
					} else {
						throw new Error(TO_BE_IMPL);
					}
				} else {
					return {
						path: file.path,
						basename: file.basename,
						folder: FileUtil.getFolderPath(file.path),
					};
				}
			}),
		);
	}

	// @monitorDecorator
	allFilesToBeIndexed(): TFile[] {
		// get all fileRefs cached by obsidian
		const files = this.vault.getFiles();
		logger.info(`all files: ${files.length}`);
		FileUtil.countFileByExtensions(files);

		const filesToIndex = files.filter((file) => this.isIndexable(file));
		logger.info(`indexable files: ${filesToIndex.length}`);
		FileUtil.countFileByExtensions(filesToIndex);

		return filesToIndex;
	}

	isIndexable(fileOrPath: TFile | TAbstractFile | string): boolean {
		if (fileOrPath instanceof TFolder) {
			return false;
		}
		let path: string;
		if (typeof fileOrPath === "string") {
			path = fileOrPath;
		} else {
			path = fileOrPath.path;
		}
		// TODO: filter by extensions and paths
		return this.supportedExtensions.has(FileUtil.getExtension(path)) && this.privateApi.isNotExcludedPath(path);
	}

	// @monitorDecorator
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
		if (FileUtil.getFileType(file.path) === FileType.PLAIN_TEXT) {
			return this.vault.cachedRead(file);
		} else {
			throw Error(
				`unsupported file extension as plain text to read, path: ${file.path}`,
			);
		}
	}

	async readPlainTextLines(fileOrPath: TFile | string): Promise<string[]> {
		return (await this.readPlainText(fileOrPath)).split(FileUtil.SPLIT_EOL);
	}

	private parseAliases(file: TFile) {
		const metadata = this.app.metadataCache.getFileCache(file);
		return (parseFrontMatterAliases(metadata?.frontmatter) || []).join("");
	}

	private isContentIndexable(file: TFile): boolean {
		return DataProvider.contentIndexableFileTypes.has(
			FileUtil.getFileType(file.path),
		);
	}
}
