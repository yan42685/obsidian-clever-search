import { DataProvider } from "src/services/obsidian/user-data/data-provider";
import { logger } from "src/utils/logger";
import { getInstance, isDevEnvironment } from "src/utils/my-lib";
import { singleton } from "tsyringe";
import type { Message } from "./worker-types";

@singleton()
export class SearchClient {
	worker?: Worker;

	async createChildThreads() {
		if (isDevEnvironment) {
			logger.warn("web worker only enabled on dev environment now");
		} else {
			return;
		}
		logger.debug("init child threads...");
		const obsidianFs = getInstance(DataProvider).obsidianFs;
		// const workerPath =
		// 	".obsidian/plugins/clever-search/cs-search-worker.js";

		const workerPath =
			".obsidian/plugins/clever-search/dist/backend-worker.js";
		try {
			const workerScript = await obsidianFs.readBinary(workerPath);
			logger.debug(
				`worker script size (6x bigger than in production build): ${(
					workerScript.byteLength / 1000
				).toFixed(2)} KB`,
			);

			// 不直接new Worker创建child thread是为了绕过electron限制
			const blob = new Blob([workerScript], { type: "text/javascript" });
			const workerUrl = URL.createObjectURL(blob);
			this.worker = new Worker(workerUrl);

			// Receive messages from Worker
			this.worker.addEventListener("message", (event: any) => {
				console.log("Received from worker:\n", event.data);
			});
		} catch (error) {
			console.error("Error initializing worker:", error);
		}
	}

	async testImageSearch() {
		this.worker?.postMessage({type: "image-search"} as Message)
	}
}
