import {
	App,
	type HeadingCache,
	TAbstractFile,
	TFile,
	TFolder,
	Vault,
	parseFrontMatterAliases,
	type CachedMetadata,
} from "obsidian";
import { OuterSetting } from "src/globals/plugin-setting";
import type { IndexedDocument } from "src/globals/search-types";
import { parseTextHeadingOutline } from "src/services/search/hybrid/chunker";
import type { HeadingOutlineEntry } from "src/services/search/hybrid/hybrid-types";
import { FileSnapshotStore } from "src/services/search/shared/file-snapshot-store";
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
	private readonly fileSnapshotStore = getInstance(FileSnapshotStore);
	private excludedPaths: Set<string>;
	private supportedExtensions: Set<string>;

	private static readonly contentIndexableViewTypes = new Set([
		ViewType.MARKDOWN,
	]);

	constructor() {
		this.init();
	}

	// update internal states based on OuterSetting
	init() {
		this.excludedPaths = new Set(this.setting.excludedPaths);
		this.supportedExtensions = new Set(
			this.setting.customExtensions.plaintext,
		);
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
				? this.vault.getAbstractFileByPath(fileOrPath)
				: fileOrPath;
		if (file instanceof TFile) {
			if (
				this.viewRegistry.viewTypeByPath(file.path) ===
				ViewType.MARKDOWN
			) {
				return await this.fileSnapshotStore.readCurrentFileText(file);
			} else {
				throw Error(
					`unsupported file extension as plain text to read, path: ${file.path}`,
				);
			}
		} else {
			return "";
		}
	}

	async readPlainTextLines(fileOrPath: TFile | string): Promise<string[]> {
		return (await this.readPlainText(fileOrPath)).split(FileUtil.SPLIT_EOL);
	}

	getFileByPath(path: string): TFile | null {
		const file = this.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	getHeadingOutline(fileOrPath: TFile | string): HeadingOutlineEntry[] {
		const file =
			typeof fileOrPath === "string"
				? this.vault.getAbstractFileByPath(fileOrPath)
				: fileOrPath;
		if (!(file instanceof TFile)) {
			return [];
		}

		const metadata = this.app.metadataCache.getFileCache(file);
		return this.parseHeadingOutline(metadata);
	}

	getHeadingOutlineForText(
		fileOrPath: TFile | string,
		plainText: string,
	): HeadingOutlineEntry[] {
		const textOutline = parseTextHeadingOutline(plainText);
		if (textOutline.length > 0) {
			return textOutline;
		}
		return this.getHeadingOutline(fileOrPath);
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

	private parseHeadingOutline(
		metadata: CachedMetadata | null,
	): HeadingOutlineEntry[] {
		return (metadata?.headings ?? [])
			.map((heading) => this.toHeadingOutlineEntry(heading))
			.filter((heading): heading is HeadingOutlineEntry => heading !== null);
	}

	private toHeadingOutlineEntry(
		heading: HeadingCache,
	): HeadingOutlineEntry | null {
		const title = heading.heading?.replace(/\s+/g, " ").trim();
		if (!title) {
			return null;
		}

		return {
			line: heading.position.start.line,
			level: heading.level,
			title,
		};
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
