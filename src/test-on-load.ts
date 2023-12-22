import { container } from "tsyringe";
import type { IndexedDocument } from "./globals/search-types";
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
	logger.debug(Object.keys({} as IndexedDocument));
	const lexicalEngine = container.resolve(LexicalEngine);
	await lexicalEngine.init();
	const  results = await lexicalEngine.search("document");
	logger.debug("minisearch searching...");
	logger.debug(results);
}
