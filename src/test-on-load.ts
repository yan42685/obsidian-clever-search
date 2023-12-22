import { container } from "tsyringe";
import { LexicalEngine } from "./services/search/search-helper";
import { logger } from "./utils/logger";
import { testRequest } from "./utils/web/http-client";

export async function testOnLoad() {
	testRequest();
	// setTimeout(() => {
	// 	monitorExecution(async () => {
	// 		const plugin: CleverSearch = container.resolve(THIS_PLUGIN);
	// 		const vault = plugin.app.vault;
	// 		logger.debug(vault.getRoot().path); // /
	// 		logger.debug(vault.configDir); // .obsidian
	// 	});
	// }, 1300);
	const lexicalEngine = container.resolve(LexicalEngine);
	await lexicalEngine.init();
	const results = await lexicalEngine.search("document content of");
	// logger.debug("minisearch searching...");

	logger.debug(results);



	// console.log(logger.getLevel())
}
