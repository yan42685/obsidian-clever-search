import { devOption } from "src/globals/dev-option";

class Logger {
	private logLevel: LogLevel = "debug";
	private levelWeights: { [level in LogLevel]: number } = {
		trace: 1,
		debug: 2,
		info: 3,
		warn: 4,
		error: 5,
		none: 6,
	};

	getLevel(): LogLevel {
		return this.logLevel;
	}

	setLevel(level: LogLevel) {
		this.logLevel = level;
	}

	trace(...args: any[]) {
		if (this.shouldLog("trace")) {
			if (devOption.traceLog) {
				console.groupCollapsed(
					`%c[trace] ${this.getCallerName()}\n`,
					"color: #5f6368;font-weight: 400;",
					...args,
				);
				console.trace();
				console.groupEnd();
			} else {
				console.log(
					`%c[trace] ${this.getCallerName()}\n`,
					"color: #5f6368;",
					...args,
				);
			}
		}
	}

	debug(...args: any[]) {
		if (this.shouldLog("debug")) {
			if (devOption.traceLog) {
				console.groupCollapsed(
					`%c[debug] ${this.getCallerName()}\n`,
					"color: #379237;font-weight: 400;",
					...args,
				);
				console.trace();
				console.groupEnd();
			} else {
				console.debug(
					`%c[debug] ${this.getCallerName()}\n`,
					// "color: #96C291;",
					"color: #379237",
					...args,
				);
			}
		}
	}

	info(...args: any[]) {
		if (this.shouldLog("info")) {
			console.info(
				`%c[info] ${this.getCallerName()}\n`,
				"color: blue;",
				...args,
			);
		}
	}

	warn(...args: any[]) {
		if (this.shouldLog("warn")) {
			console.warn(
				`%c[warn] ${this.getCallerName()}\n`,
				"color: orange;",
				...args,
			);
		}
	}

	error(...args: any[]) {
		if (this.shouldLog("error")) {
			console.error(
				`%c[error] ${this.getCallerName()}\n`,
				"color: red;",
				...args,
			);
		}
	}
	
	private getCallerName() {
		const stackLines = new Error().stack?.split("\n");
		// Skip the first three lines and find the actual caller
		const callerLine = stackLines?.slice(3).find(
			(line) =>
				// if pass a template literal, such as `show: ${value}` to methods of logger,
				// there will be two more stack lines above the actual caller
				!line.includes("eval") && !line.includes("Array.map")
		);
		// for node.js child thread in obsidian
		if (callerLine?.startsWith("    at blob:")) {
			return "child-thread";
		}
		const match = callerLine?.match(/at (\S+)/);
		return match ? `<${match[1]}> ` : "failed to parse caller";
	}

	private shouldLog(level: LogLevel): boolean {
		return this.levelWeights[level] >= this.levelWeights[this.logLevel];
	}
}

// 不适合用大写字母，因为作为属性时，似乎只能用小写字母
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "none";

export const logger = new Logger();
