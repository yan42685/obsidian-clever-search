const isDevEnvironment = process.env.NODE_ENV === "development";

class Logger {
    info(...args: any[]) {
        if (isDevEnvironment) {
            console.info('%c[info]', 'color: blue;', ...args);
        }
    }

    debug(...args: any[]) {
        if (isDevEnvironment) {
            console.debug('%c[debug]', 'color: green;', ...args);
        }
    }

    warn(...args: any[]) {
        if (isDevEnvironment) {
            console.warn('%c[warn]', 'color: orange;', ...args);
        }
    }

    error(...args: any[]) {
        if (isDevEnvironment) {
            console.error('%c[error]', 'color: red;', ...args);
        }
    }
}

export const logger = new Logger();
