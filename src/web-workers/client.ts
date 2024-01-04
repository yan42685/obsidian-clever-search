import { DataProvider } from "src/services/obsidian/user-data/data-provider";
import { logger } from "src/utils/logger";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";

@singleton()
export class SearchClient {
	worker?: Worker;

	async createChildThreads() {
		logger.debug("init child threads...")
		try {
			const obsidianFs = getInstance(DataProvider).obsidianFs;
			// 'await' the Promise to get the actual ArrayBuffer.
			const workerScript = await obsidianFs.readBinary(".obsidian/plugins/clever-search/cs-search-worker.js");
			logger.debug(`worker script size: ${(workerScript.byteLength/1000).toFixed(2)} KB`);

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
		this.worker?.postMessage("tikToken")
	}
}
