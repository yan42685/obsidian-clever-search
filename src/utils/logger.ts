class Logger {
	private logLevel: LogLevel = "debug";
	private levelWeights: { [level in LogLevel]: number } = {
		debug: 1,
		info: 2,
		warn: 3,
		error: 4,
		none: 5,
	};

	getLevel(): LogLevel {
		return this.logLevel;
	}
	setLevel(level: LogLevel) {
		this.logLevel = level;
	}

	info(...args: any[]) {
		if (this.shouldLog("info")) {
			console.info(
				`%c[info] ${this.getCallerName()}`,
				"color: blue;",
				...args,
			);
		}
	}

	debug(...args: any[]) {
		if (this.shouldLog("debug")) {
			console.debug(
				`%c[debug] ${this.getCallerName()}`,
				"color: green;",
				...args,
			);
		}
	}

	warn(...args: any[]) {
		if (this.shouldLog("warn")) {
			console.warn(
				`%c[warn] ${this.getCallerName()}`,
				"color: orange;",
				...args,
			);
		}
	}

	error(...args: any[]) {
		if (this.shouldLog("error")) {
			console.error(
				`%c[error] ${this.getCallerName()}`,
				"color: red;",
				...args,
			);
		}
	}
	private getCallerName() {
		// get stack info and match
		const match = (new Error().stack?.split("\n")[3] || "").match(
			/at (\S+)/,
		);
		return match ? `<${match[1]}> ` : "";
	}
	private shouldLog(level: LogLevel): boolean {
		return this.levelWeights[level] >= this.levelWeights[this.logLevel];
	}
}

// 不适合用大写字母，因为作为属性时，似乎只能用小写字母
export type LogLevel = "debug" | "info" | "warn" | "error" | "none";

export const logger = new Logger();
