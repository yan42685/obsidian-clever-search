import {
	App,
	FileSystemAdapter,
	TAbstractFile,
	TFile,
	TFolder,
	Vault,
	htmlToMarkdown,
	parseFrontMatterAliases,
	type CachedMetadata,
} from "obsidian";
import type { IndexedDocument } from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { TO_BE_IMPL, getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import { FileUtil } from "../../../utils/file-util";
import { PrivateApi } from "../private-api";
import { ViewRegistry, ViewType } from "../view-registry";

@singleton()
export class DataProvider {
	private readonly vault = getInstance(Vault);
	private readonly app = getInstance(App);
	private readonly supportedExtensions =
		getInstance(ViewRegistry).supportedExtensions();
	private readonly privateApi = getInstance(PrivateApi);
	private viewRegistry = getInstance(ViewRegistry);
	public readonly obsidianFs = this.vault.adapter as FileSystemAdapter;

	private static readonly contentIndexableViewTypes = new Set([
		ViewType.MARKDOWN,
	]);

	async generateAllIndexedDocuments(
		files: TFile[],
	): Promise<IndexedDocument[]> {
		return Promise.all(
			files.map(async (file) => {
				if (this.isContentIndexable(file)) {
					const metaData = this.app.metadataCache.getFileCache(file);
					if (
						this.viewRegistry.viewTypeByPath(file.path) ===
						ViewType.MARKDOWN
					) {
						return {
							path: file.path,
							basename: file.basename,
							folder: FileUtil.getFolderPath(file.path),
							aliases: this.parseAliases(metaData),
							tags: this.parseTags(metaData),
							headings: this.parseHeadings(metaData),
							content: await this.readPlainText(file),
						} as IndexedDocument;
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
		logger.debug(`all files: ${files.length}`);
		FileUtil.countFileByExtensions(files);

		const filesToIndex = files.filter((file) => this.isIndexable(file));
		logger.debug(`indexable files: ${filesToIndex.length}`);
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
		return (
			this.supportedExtensions.has(FileUtil.getExtension(path)) &&
			this.privateApi.isNotExcludedPath(path)
		);
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
		if (this.viewRegistry.viewTypeByPath(file.path) === ViewType.MARKDOWN) {
			const plainText = await this.vault.cachedRead(file);
			// return plainText;
			return file.extension === "html"
				? htmlToMarkdown(plainText)
				: plainText;
		} else {
			throw Error(
				`unsupported file extension as plain text to read, path: ${file.path}`,
			);
		}
	}

	async readPlainTextLines(fileOrPath: TFile | string): Promise<string[]> {
		return (await this.readPlainText(fileOrPath)).split(FileUtil.SPLIT_EOL);
	}

	private parseAliases(metadata: CachedMetadata | null): string {
		return (parseFrontMatterAliases(metadata?.frontmatter) || []).join(" ");
	}

	private parseTags(metaData: CachedMetadata | null): string {
		return metaData?.tags?.map((t) => t.tag.slice(1)).join(" ") || "";
	}

	private parseHeadings(metadata: CachedMetadata | null): string {
		return metadata?.headings?.map((h) => h.heading).join(" ") || "";
	}

	private isContentIndexable(file: TFile): boolean {
		return DataProvider.contentIndexableViewTypes.has(
			this.viewRegistry.viewTypeByPath(file.path),
		);
	}
}
