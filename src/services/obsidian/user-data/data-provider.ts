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
import { OuterSetting } from "src/globals/plugin-setting";
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
	private readonly setting = getInstance(OuterSetting);
	private readonly privateApi = getInstance(PrivateApi);
	private readonly viewRegistry = getInstance(ViewRegistry);
	private readonly htmlParser = getInstance(HtmlParser);
	private excludedPaths: Set<string>;
	private supportedExtensions:Set<string>;
	public readonly obsidianFs = this.vault.adapter as FileSystemAdapter;

	private static readonly contentIndexableViewTypes = new Set([
		ViewType.MARKDOWN,
	]);

	constructor() {
		this.init();
	}

	// update internal states based on OuterSetting
	init() {
		this.excludedPaths = new Set(this.setting.excludedPaths)
		logger.info(`aaa ${this.setting.customExtensions.plaintext}`)
		this.supportedExtensions = new Set(this.setting.customExtensions.plaintext);
		logger.info(`bbb ${[...this.supportedExtensions]}`)
	}

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
			path.lastIndexOf("excalidraw.md") === -1 &&
			(this.setting.followObsidianExcludedFiles
				? this.privateApi.isNotObsidianExcludedPath(path)
				: true) &&
			(this.excludedPaths.size === 0
				? true
				: this.isNotCustomExcludedPath(path))
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
				? this.htmlParser.toMarkdown(plainText)
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

	private isNotCustomExcludedPath(path: string) {
		const parts = path.split("/");
		let currentPath = "";

		for (const part of parts) {
			currentPath += (currentPath ? "/" : "") + part;
			if (this.excludedPaths.has(currentPath)) {
				return false;
			}
		}
		return true;
	}
}

@singleton()
class HtmlParser {
	private readonly MARKDOWN_LINK_REGEX = /\[([^[\]]+)\]\([^()]*\)/g;
	private readonly MARKDOWN_ASTERISK_REGEX = /\*\*(.*?)\*\*/g;
	private readonly MARKDOWN_BACKTICK_REGEX = /`(.*?)`/g;

	toMarkdown(htmlText: string) {
		// use a replacement function to determine how to replace the matched content
		let cleanMarkdown = htmlToMarkdown(htmlText);
		// 使用替换函数来确定如何替换匹配到的内容
		cleanMarkdown = cleanMarkdown.replace(this.MARKDOWN_LINK_REGEX, "$1");
		cleanMarkdown = cleanMarkdown.replace(
			this.MARKDOWN_ASTERISK_REGEX,
			"$1",
		);
		cleanMarkdown = cleanMarkdown.replace(
			this.MARKDOWN_BACKTICK_REGEX,
			"$1",
		);
		return cleanMarkdown;
	}
}
