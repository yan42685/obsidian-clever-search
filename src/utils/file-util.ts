import * as fsLib from "fs";
import type { TFile } from "obsidian";
import os from "os";
import * as pathLib from "path";
import { singleton } from "tsyringe";
import { logger } from "./logger";
import { isDevEnvironment } from "./my-lib";

// for autocompletion
export const fsUtils = fsLib;
export const pathUtils = pathLib;

export enum FileType {
	PLAIN_TEXT,
	IMAGE,
	UNSUPPORTED,
}

@singleton()
export class FileUtil {
	// static SPLIT_EOL = /\r?\n|\r/;   // cross-platform end of line, used for strings.split()
	static readonly SPLIT_EOL = "\r"; // stay consistent with the logic that Obsidian uses to handle lines
	static readonly JOIN_EOL = os.EOL; // cross-platform end of line, used for string.join()
	private static readonly fileTypeMap: Map<string, FileType> = new Map();
	static {
		if (isDevEnvironment) {
			// no extension files are only used for development
			FileUtil.fileTypeMap.set("", FileType.PLAIN_TEXT);
		}
		FileUtil.fileTypeMap.set("md", FileType.PLAIN_TEXT);
		FileUtil.fileTypeMap.set("markdown", FileType.PLAIN_TEXT);
		FileUtil.fileTypeMap.set("txt", FileType.PLAIN_TEXT);
		FileUtil.fileTypeMap.set("jpg", FileType.IMAGE);
		FileUtil.fileTypeMap.set("png", FileType.IMAGE);
	}
	// private readonly setting: PluginSetting = getInstance(PluginSetting);
	// private readonly extensionBlacklist;
	// constructor() {
	// 	this.extensionBlacklist = new Set([
	// 		...DEFAULT_BLACKLIST_EXTENSION.map(FileUtil.getExtension),
	// 		...this.setting.excludeExtensions.map(FileUtil.getExtension),
	// 	]);
	// }

	static getFileType(path: string): FileType {
		const result = FileUtil.fileTypeMap.get(FileUtil.getExtension(path));
		// NOTE: shouldn't use `result ? FileType.UNSUPPORTED : result;`
		// because result might be 0 rather than undefined
		return result === undefined ? FileType.UNSUPPORTED : result;
	}

	static getBasename(filePath: string): string {
		return pathUtils.basename(filePath, pathUtils.extname(filePath));
	}

	static getExtension(filePath: string): string {
		return pathUtils.extname(filePath).slice(1);
	}

	static getFolderPath(filePath: string): string {
		const dirPath = pathUtils.dirname(filePath);
		if (dirPath === "." || dirPath === pathUtils.sep || dirPath === "/") {
			return "./";
		}
		return (
			dirPath.replace(new RegExp("\\" + pathUtils.sep, "g"), "/") + "/"
		);
	}

	static countFileByExtensions(files: TFile[]): Record<string, number> {
		const extensionCountMap = new Map<string, number>();
		const commonExtensions = ["no_extension", "md", "txt"];
		const uncommonExtensionPathMap = new Map<string, string[]>();
		files.forEach((file) => {
			const ext = file.extension || "no_extension";
			extensionCountMap.set(ext, (extensionCountMap.get(ext) || 0) + 1);
			if (!commonExtensions.includes(ext)) {
				const paths = uncommonExtensionPathMap.get(ext) || [];
				paths.push(file.path);
				uncommonExtensionPathMap.set(ext, paths);
			}
		});
		const countResult = Object.fromEntries(extensionCountMap);
		const uncommonPathsResult = Object.fromEntries(
			uncommonExtensionPathMap,
		);
		logger.trace(countResult);
		logger.trace(uncommonPathsResult);
		return countResult;
	}
}
