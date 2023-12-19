import * as fsLib from "fs";
import * as pathLib from "path";
import { logger } from "./logger";

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
	// 尽量不要开启
	ALL = "",
}

// default dirs blacklist
const IGNORED_DIRECTORIES = [".obsidian", ".git", ".vscode"];

// TODO: 定义函数类型
export async function monitorExecution(fn: (...args: any[]) => Promise<void>) {
	const startTime = Date.now();
	await fn();
	const endTime = Date.now();

	const duration = formatMillis(endTime - startTime);
	logger.debug(`[${fn.name.replace(/^bound /, "")}] running time: ${duration}`);
}

/**
 * get a better view of milliseconds
 */

export function formatMillis(millis: number) {
	if (millis < 1000) {
		return `${millis} ms`;
	} else if (millis < 60000) {
		const seconds = Math.floor(millis / 1000);
		const milliseconds = millis % 1000;
		return `${seconds} s ${milliseconds} ms`;
	} else {
		const minutes = Math.floor(millis / 60000);
		const seconds = Math.floor((millis % 60000) / 1000);
		const milliseconds = millis % 1000;
		return `${minutes} min ${seconds} s ${milliseconds} ms`;
	}
}

// Invalid Function
// export function simulateEnterKeyPressOnOmniSearchModal() {
//     const omniSearchModal = document.querySelector('omnisearch-result');
// 	console.log(omniSearchModal);
//     if (!omniSearchModal) {
// 		new Notice("OmniSearch 模态框未找到");
//         return;
//     }

//     // 创建一个模拟 Enter 键的键盘事件
//     const enterKeyEvent = new KeyboardEvent('keydown', {
//         key: 'Enter',
//         code: 'Enter',
//         keyCode: 13, // Enter 键的 keyCode 是 13
//         bubbles: true, // 确保事件可以冒泡
//     });

// 	// NOTE: all hotkeys are disabled if a modal is open, so the following code is invalid
//     omniSearchModal.dispatchEvent(enterKeyEvent);
// }
