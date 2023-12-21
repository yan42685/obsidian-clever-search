import { container } from "tsyringe";
import type CleverSearch from "./main";
import { THIS_PLUGIN } from "./utils/constants";
import { logger } from "./utils/logger";
import { monitorExecution } from "./utils/my-lib";
import { testRequest } from "./utils/web/http-client";

export function testOnLoad() {
	testRequest();
	setTimeout(() => {
		monitorExecution(async () => {
			const plugin: CleverSearch = container.resolve(THIS_PLUGIN);
			const vault = plugin.app.vault;
			logger.debug(vault.getRoot().path); // /
			logger.debug(vault.configDir); // .obsidian
			// logger.debug(vault.getFiles().length);  // super fast

			// vault.cachedRead()



			
			// const dir = container.resolve(PluginManager).vaultPath + "abc";
			// const allFiles = await getAllFiles([dir], [FileExtension.ALL]);
			// console.log(`count: ${allFiles.length}`);

			// logger.debug(`count: ${allFiles.length}`);
			// logger.debug(allFiles);
		});
	}, 3000);
}
