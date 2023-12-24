import * as fsLib from "fs";
import type { TFile } from "obsidian";
import * as pathLib from "path";
import { logger } from "./logger";

// for autocompletion
export const fsUtils = fsLib;
export const pathUtils = pathLib;

export const isDevEnvironment = process.env.NODE_ENV === "development";

// "Ctrl" for Windows/Linux;    "Mod" for MacOS
export const currModifier = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
	? "Mod"
	: "Ctrl";

// allowed extensions
export enum FileExtension {
	MD = ".md",
	TXT = ".txt",
	// 尽量不要开启
	ALL = "",
}

// default dirs blacklist
const IGNORED_DIRECTORIES = [".obsidian", ".git", ".vscode"];

export class MyLib {
	static extractDomainFromHttpsUrl(url: string): string {
		if (url.startsWith("http://")) {
			logger.error("Only support https, current url starts with http");
			return "";
		}

		const domainRegex = /^(https?:\/\/)?([\w.-]+)(?:\/|$)/;
		const match = url.match(domainRegex);
		if (match && match[2]) {
			return match[2];
		} else {
			return "";
		}
	}
	static getBasename(path: string) {
		// 提取文件名（包含扩展名）
		const filename = path.split("/").pop() || "";
		// 返回去掉扩展名的基本名称
		return filename.split(".").slice(0, -1).join(".") || filename;
	}

	static getExtension(path: string) {
		// 提取文件扩展名
		const parts = path.split(".");
		return parts.length > 1 ? parts.pop() || "" : "";
	}

	static countFileByExtensions(files: TFile[]): Record<string, number> {
		const extensionCountMap = new Map<string, number>();
		files.forEach((file) => {
			const ext = file.extension || "no_extension";
			extensionCountMap.set(ext, (extensionCountMap.get(ext) || 0) + 1);
		});
		const result = Object.fromEntries(extensionCountMap);
		logger.info(result);
		return result;
	}
}

export async function monitorExecution(
	fn: (...args: any[]) => Promise<any>,
	...args: any[]
) {
	const startTime = Date.now();
	await fn(...args); // Spread the arguments here
	const endTime = Date.now();

	const duration = formatMillis(endTime - startTime);
	logger.debug(
		`[${fn.name.replace(/^bound /, "")}] running time: ${duration}`,
	);
}


/**
 * A decorator for asynchronously measuring and logging the execution time of a class method.
 * @param target - The target class.
 * @param propertyKey - The method name.
 * @param descriptor - The method descriptor.
 * @returns A modified descriptor with execution time monitoring.
 *
 * @example
 * class Example {
 *   @monitorDecorator
 *   async myMethod(arg1, arg2) {
 *     // Method implementation...
 *   }
 * }
 */
export function monitorDecorator(
	target: any,
	propertyKey: string,
	descriptor: PropertyDescriptor,
) {
	const originalMethod = descriptor.value;

	descriptor.value = async function (...args: any[]) {
		const start = performance.now();
		const result = await originalMethod.apply(this, args);
		const end = performance.now();
		logger.debug(
			`Execution time for [${propertyKey}]: ${formatMillis(
				end - start,
			)}`,
		);
		return result;
	};

	return descriptor;
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
		return `${minutes} min ${seconds} s ${milliseconds.toFixed(2)} ms`;
	}
}