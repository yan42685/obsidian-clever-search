import { App, TAbstractFile, TFile, Vault, parseFrontMatterAliases } from "obsidian";
import type { IndexedDocument } from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { TO_BE_IMPL, getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { FileType, FileUtil } from "../../utils/file-util";
import { Tokenizer } from "../search/tokenizer";

@singleton()
export class DataProvider {
	private readonly tokenizer = getInstance(Tokenizer);
	private readonly vault = getInstance(Vault);
	private readonly app = getInstance(App);
	private readonly supportedExtensions = new Set(["md"]);

	private static readonly contentIndexableFileTypes = new Set([
		FileType.PLAIN_TEXT,
		FileType.IMAGE,
	]);

	async generateAllIndexedDocuments(): Promise<IndexedDocument[]> {
		const filesToIndex = this.allFilesToBeIndexed();
		return Promise.all(
			filesToIndex.map(async (file) => {
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

	private parseAliases(file: TFile) {
		const metadata = this.app.metadataCache.getFileCache(file);
		return (parseFrontMatterAliases(metadata?.frontmatter) || []).join("");
	}

	// @monitorDecorator
	allFilesToBeIndexed(): TFile[] {
		// get all fileRefs cached by obsidian
		const files = this.vault.getFiles();
		logger.info(`all files: ${files.length}`);
		FileUtil.countFileByExtensions(files);

		// TODO: compare mtime and then filter
		const filesToIndex = files.filter((file) => this.shouldIndex(file));
		logger.info(`files to be indexed: ${filesToIndex.length}`);
		FileUtil.countFileByExtensions(filesToIndex);

		return filesToIndex;
	}

	shouldIndex(fileOrFolder: TAbstractFile): boolean {
		if (!(fileOrFolder instanceof TFile)) {
			return false;
		}
		// TODO: filter by extensions and paths
		return this.supportedExtensions.has(FileUtil.getExtension(fileOrFolder.path));
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

	private isContentIndexable(file: TFile): boolean {
		return DataProvider.contentIndexableFileTypes.has(
			FileUtil.getFileType(file.path),
		);
	}
}
