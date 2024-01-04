import { singleton } from "tsyringe";
import { fsUtil, pathUtil } from "../file-util";
import { logger } from "../logger";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const electron = require("electron");
const userDataPath = (electron.app || electron.remote.app).getPath(
    "userData",
);

const assetsDir = pathUtil.join(userDataPath, "clever-search");

const unpkgUrl = "https://unpkg.com/";
const tiktokenSourceUrl = unpkgUrl + "@dqbd/tiktoken@1.0.7/tiktoken_bg.wasm";
const tiktokenTargetUrl = pathUtil.join(assetsDir,
	"tiktoken_bg.wasm",
);

@singleton()
export class AssetsDownloader {
	async start() {
		logger.info("start downloading assets...");
        logger.info(`target dir: ${assetsDir}`);
		logger.info("tiktoken source url: " + tiktokenSourceUrl);
		logger.info("tiktoken target url: " + tiktokenTargetUrl);
        
		await this.downloadFile(tiktokenTargetUrl, tiktokenSourceUrl);
	}

	async downloadFile(targetPath: string, sourceUrl: string): Promise<void> {
		// check if the file already exists
		try {
			await fsUtil.promises.access(targetPath);
			logger.trace("file exists:", targetPath);
			return;
		} catch (error) {
			if (error.code !== "ENOENT") throw error; // rethrow if it's an error other than "file not found"
		}

		// create dir recursively if not exists
		const targetDir = pathUtil.dirname(targetPath);
		await fsUtil.promises
			.mkdir(targetDir, { recursive: true })
			.catch((error) => {
				if (error.code !== "EEXIST") throw error; // only ignore the error if the directory already exists
			});

		// download the file
		const response = await fetch(sourceUrl);
		if (!response.ok)
			throw new Error(`unexpected response ${response.statusText}`);

		try {
			await fsUtil.promises.writeFile(
				targetPath,
				Buffer.from(await response.arrayBuffer()),
			);
            logger.info(`successfully download from ${sourceUrl}`);
		} catch (error) {
			logger.error(`failed to download ${sourceUrl}`);
			throw error;
		}
	}
}
