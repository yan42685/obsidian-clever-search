const isDevEnvironment = process.env.NODE_ENV === "development";

class Logger {
    async info(message: string) {
        if (isDevEnvironment) {
            console.info(`[info] %c${message}`, 'color: blue;');
        }
    }

    async debug(message: string) {
        if (isDevEnvironment) {
            console.debug(`[debug] %c${message}`, 'color: green;');
        }
    }

    async warn(message: string) {
        if (isDevEnvironment) {
            console.warn(`[warn] %c${message}`, 'color: orange;');
        }
    }

    async error(message: string) {
        if (isDevEnvironment) {
            console.error(`[error] %c${message}`, 'color: red;');
        }
    }
}

export const logger = new Logger();
