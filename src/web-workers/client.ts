import { DataProvider } from "src/services/obsidian/user-data/data-provider";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";

@singleton()
export class SearchClient {
	worker?: Worker;

	async createChildThreads() {
		logger.debug("init child threads...");
		const obsidianFs = getInstance(DataProvider).obsidianFs;
		const workerPath =".obsidian/plugins/clever-search/cs-search-worker.js";
		if (!obsidianFs.exists(workerPath)) {
			logger.debug(`${workerPath} doesn't exist`);
			return;
		}
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

	async testTickToken() {
		this.worker?.postMessage("tikToken");
	}
}
