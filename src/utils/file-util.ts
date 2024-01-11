import * as fsLib from "fs";
import type { TFile } from "obsidian";
import * as pathLib from "path";
import { singleton } from "tsyringe";
import { logger } from "./logger";

// for autocompletion
export const fsUtil = fsLib;
export const pathUtil = pathLib;

@singleton()
export class FileUtil {
	// static SPLIT_EOL = /\r?\n|\r/;   // cross-platform end of line, used for strings.split()
	static readonly SPLIT_EOL = "\n"; // stay consistent with the logic that Obsidian uses to handle lines
	// static readonly JOIN_EOL = os.EOL; // cross-platform end of line, used for string.join()
	static readonly JOIN_EOL = "\n";

	static getBasename(filePath: string): string {
		return pathUtil.basename(filePath, pathUtil.extname(filePath));
	}

	static getExtension(filePath: string): string {
		return pathUtil.extname(filePath).slice(1);
	}

	static getFolderPath(filePath: string): string {
		const dirPath = pathUtil.dirname(filePath);
		if (dirPath === "." || dirPath === pathUtil.sep || dirPath === "/") {
			return "./";
		}
		return dirPath.replace(new RegExp("\\" + pathUtil.sep, "g"), "/") + "/";
	}

	static countFileByExtensions(files: TFile[]): Record<string, number> {
		const extensionCountMap = new Map<string, number>();
		files.forEach((file) => {
			const ext = file.extension || "no_extension";
			extensionCountMap.set(ext, (extensionCountMap.get(ext) || 0) + 1);
		});
		const countResult = Object.fromEntries(extensionCountMap);
		logger.trace(countResult);
		return countResult;
	}

	// use ObsidianFs instead
	// static doesFileExist(path: string): boolean {
	// 	return fsUtil.existsSync(path);
	// }
}
