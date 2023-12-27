import { App, FileSystemAdapter } from "obsidian";
import { getInstance } from "src/utils/my-lib";
import { singleton } from "tsyringe";

@singleton()
export class SearchClient {
	worker?: Worker;
	constructor() {
		const app: App = getInstance(App);
		const obsidianFs = app.vault.adapter as FileSystemAdapter;
		// const workerJsPath = obsidianFs.getFullPath("./cs-search-worker.js");
        // console.log(workerJsPath);



		// this.initWorker();
	}

	async initWorker() {
		try {
			const app: App = getInstance(App);
			const obsidianFs = app.vault.adapter as FileSystemAdapter;

			// 'await' the Promise to get the actual ArrayBuffer.
			const workerScript = await obsidianFs.readBinary(".obsidian/plugins/clever-search/cs-search-worker.js");

            // 不直接new Worker是为了绕过同源限制
			const blob = new Blob([workerScript], { type: "text/javascript" });
			const workerUrl = URL.createObjectURL(blob);
			this.worker = new Worker(workerUrl);

			// Send data to Worker
			const dataToShare = "hello";
			this.worker.postMessage(dataToShare);

			// Receive messages from Worker
			this.worker.addEventListener("message", (event: any) => {
				console.log("Received from worker:", event.data);
			});
		} catch (error) {
			console.error("Error initializing worker:", error);
		}
	}
}
