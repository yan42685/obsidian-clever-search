import * as fsLib from "fs";
import * as pathLib from "path";

// for autocompletion
export const fsUtils = fsLib;
export const pathUtils = pathLib;

// "Ctrl" for Windows/Linux;    "Mod" for MacOS
export const currModifier = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
	? "Mod"
	: "Ctrl";

/**
 * Recursively get all files in a directory and its subdirectories
 * with specified extensions, excluding any files in the default blacklist,
 * such as ".obsidian/" ".git/" ".vscode/"
 */
export async function getAllFiles(
	dirs: string[],
	extensions: string[],
): Promise<string[]> {
	const results: string[] = [];
	const visitedDirs = new Set<string>();

	async function traverse(dir: string) {
		if (visitedDirs.has(dir)) {
			return; // Skip directories we've already visited
		}

		visitedDirs.add(dir);

		const list = await fsLib.promises.readdir(dir);

		for (const file of list) {
			const resolvedPath = pathLib.resolve(dir, file);

			if (
				IGNORED_DIRECTORIES.some((ignored) =>
					resolvedPath.includes(`${pathLib.sep}${ignored}`),
				)
			) {
				continue; // Skip directories in the default blacklist
			}

			const stat = await fsLib.promises.stat(resolvedPath);
			if (stat.isDirectory()) {
				await traverse(resolvedPath);
			} else {
				if (
					extensions.includes(
						pathLib.extname(resolvedPath).toLowerCase(),
					)
				) {
					results.push(resolvedPath);
				}
			}
		}
	}

	for (const dir of dirs) {
		await traverse(dir);
	}

	return results;
}

// allowed extensions
export enum FileExtension {
	MD = ".md",
	TXT = ".txt",
}

// default dirs blacklist
const IGNORED_DIRECTORIES = [".obsidian", ".git", ".vscode"];
