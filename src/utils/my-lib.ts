import * as fsLib from "fs";
import * as pathLib from "path";
import { LanguageEnum } from "src/globals/enums";
import { container, type InjectionToken } from "tsyringe";
import { logger } from "./logger";

// for autocompletion
export const fsUtils = fsLib;
export const pathUtils = pathLib;

export const isDevEnvironment = process.env.NODE_ENV === "development";
export const TO_BE_IMPL = "This branch hasn't been implemented";

// "Ctrl" for Windows/Linux;    "Mod" for MacOS
export const currModifier = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
	? "Mod"
	: "Ctrl";

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
	/**
	 * Appends elements from addition to host.
	 */
	static append<T>(host: T[], addition: T[]): T[] {
		for (const element of addition) {
			host.push(element);
		}
		return host;
	}

	/**
	 * Get current runtime language
	 */
	static getCurrLanguage(): LanguageEnum {
		// getItem("language") will return `null` if currLanguage === "en"
		const langKey = window.localStorage.getItem("language") || "en";
		if (langKey in LanguageEnum) {
			return LanguageEnum[langKey as keyof typeof LanguageEnum];
		} else {
			return LanguageEnum.other;
		}
	}

	static sleep(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
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
		logger.trace(
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
	try {
		return container.resolve(token);
	} catch (e) {
		const msg =
			"CleverSearch for developer:\nThere might be wrong usages for tsyringe:\n1. Inject an instance for static field\n2. Cycle dependencies without delay\n3. Unknown error";
		logger.warn(msg);
		logger.error(e);
		alert(msg);
		return -1 as any;
	}
}
