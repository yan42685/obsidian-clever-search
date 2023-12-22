import { container } from "tsyringe";
import { PluginSettings } from "./services/obsidian/settings";
import { LexicalEngine } from "./services/search/search-helper";
import { logger } from "./utils/logger";
import { HttpClient } from "./utils/web/http-client";

export async function testOnLoad() {
	const settings = container.resolve(PluginSettings);
	// ====== API Request =====
	// const httpClient = container.resolve(HttpClient);	
	// httpClient.testRequest();

	// ====== vault files =====
	// setTimeout(() => {
	// 	monitorExecution(async () => {
	// 		const plugin: CleverSearch = container.resolve(THIS_PLUGIN);
	// 		const vault = plugin.app.vault;
	// 		logger.debug(vault.getRoot().path); // /
	// 		logger.debug(vault.configDir); // .obsidian
	// 	});
	// }, 1300);


	// await testLexicalSearch();
}

async function testLexicalSearch() {
	const lexicalEngine = container.resolve(LexicalEngine);
	await lexicalEngine.init();
	const resultsOr = await lexicalEngine.searchOr("document content of");
	const resultsAnd = await lexicalEngine.searchAnd("document content of");
	logger.debug(resultsOr);
	logger.debug(resultsAnd);
}
