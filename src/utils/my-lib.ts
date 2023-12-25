import * as fsLib from "fs";
import type { TFile } from "obsidian";
import * as pathLib from "path";
import { container, type InjectionToken } from "tsyringe";
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
		const commonExtensions=  ["no_extension", "md", "txt"]
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
		const uncommonPathsResult = Object.fromEntries(uncommonExtensionPathMap);
		logger.debug(countResult);
		logger.debug(uncommonPathsResult);
		return countResult;
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
		`<${fn.name.replace(/^bound /, "")}> Execution time: ${duration}`,
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
		const start = Date.now();
		const result = await originalMethod.apply(this, args);
		const end = Date.now();
		logger.debug(
			`<${
				target.constructor.name
			}-${propertyKey}> Execution time: ${formatMillis(end - start)}`,
		);
		return result;
	};

	return descriptor;
}

/**
 * get a better view of milliseconds
 */
export function formatMillis(millis: number): string {
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


export function getInstance<T>(token: InjectionToken<T>): T {
	return container.resolve(token);
}