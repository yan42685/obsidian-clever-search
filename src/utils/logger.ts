const isDevEnvironment = process.env.NODE_ENV === "development";

class Logger {
	getCallerName() {
		// get stack info and match
		const match = (new Error().stack?.split("\n")[3] || "").match(
			/at (\S+)/,
		);
		return match ? `<${match[1]}> ` : "";
	}

	info(...args: any[]) {
		if (isDevEnvironment) {
			console.info(
				`%c[info] ${this.getCallerName()}`,
				"color: blue;",
				...args,
			);
		}
	}

	debug(...args: any[]) {
		if (isDevEnvironment) {
			console.debug(
				`%c[debug] ${this.getCallerName()}`,
				"color: green;",
				...args,
			);
		}
	}

	warn(...args: any[]) {
		if (isDevEnvironment) {
			console.warn(
				`%c[warn] ${this.getCallerName()}`,
				"color: orange;",
				...args,
			);
		}
	}

	error(...args: any[]) {
		if (isDevEnvironment) {
			console.error(
				`%c[error] ${this.getCallerName()}`,
				"color: red;",
				...args,
			);
		}
	}
}

export const logger = new Logger();
