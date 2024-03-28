import { LanguageEnum } from "src/globals/enums";
import { container, type InjectionToken } from "tsyringe";
import { logger } from "./logger";

export const isDevEnvironment = process.env.NODE_ENV === "development";
export const TO_BE_IMPL = "This branch hasn't been implemented";
export const SHOULD_NOT_HAPPEN = "this branch shouldn't be reached by design";

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
	 * deep version of Object.assign   (will change the target)
	 */
	static mergeDeep<T>(target: T, ...sources: T[]): T {
		if (!sources.length) return target;
		const source = sources.shift();

		if (isObject(target) && isObject(source)) {
			for (const key in source) {
				if (isObject(source[key])) {
					if (!target[key as keyof T])
						// @ts-ignore
						Object.assign(target, { [key]: {} });
					// @ts-ignore
					MyLib.mergeDeep(target[key as keyof T], source[key]);
				} else {
					// @ts-ignore
					Object.assign(target, { [key]: source[key] });
				}
			}
		}

		return MyLib.mergeDeep(target, ...sources);
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
 * A decorator for measuring and logging the execution time of a class method.
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

	descriptor.value = function (...args: any[]) {
		const start = Date.now();
		const result = originalMethod.apply(this, args);
		const logExecutionTime = () => {
			const end = Date.now();
			logger.trace(
				`<${
					target.constructor.name
				}-${propertyKey}> Execution time: ${formatMillis(end - start)}`,
			);
		};
		if (result instanceof Promise) {
			return result.then((res) => {
				logExecutionTime();
				return res;
			});
		} else {
			logExecutionTime();
			return result;
		}
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

function isObject(item: any): boolean {
	return item && typeof item === "object" && !Array.isArray(item);
}
