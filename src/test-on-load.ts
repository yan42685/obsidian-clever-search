import { container } from "tsyringe";
import { LexicalEngine } from "./services/search/search-helper";
import { logger } from "./utils/logger";

export async function testOnLoad() {
	// testRequest();

	// setTimeout(() => {
	// 	monitorExecution(async () => {
	// 		const plugin: CleverSearch = container.resolve(THIS_PLUGIN);
	// 		const vault = plugin.app.vault;
	// 		logger.debug(vault.getRoot().path); // /
	// 		logger.debug(vault.configDir); // .obsidian
	// 	});
	// }, 1300);

	await testLexicalSearch();

}

async function testLexicalSearch() {
	const lexicalEngine = container.resolve(LexicalEngine);
	await lexicalEngine.init();
	const resultsOr = await lexicalEngine.searchOr("document content of");
	const resultsAnd = await lexicalEngine.searchAnd("document content of");
	logger.debug(resultsOr);
	logger.debug(resultsAnd);
}
