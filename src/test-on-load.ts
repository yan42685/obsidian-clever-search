import { container } from "tsyringe";
import { PluginSettings } from "./services/obsidian/settings";
import { LexicalEngine, SearchHelper } from "./services/search/search-helper";
import { logger } from "./utils/logger";

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

	// testStemmer();
	// testTsyringe();

	await testLexicalSearch();
}

function testStemmer() {
	const words = ["gifs;d", "gifs", "哈哈", "很多只猫", "analyzers"];
}

function testTsyringe() {
	const obj1 = container.resolve(SearchHelper);
	const obj2 = container.resolve(SearchHelper);
	// in tsyringe, the default scope for class is singleton, so it should output "true"
	logger.info(`test equal: ${obj1 === obj2}`);
}

async function testLexicalSearch() {
	const lexicalEngine = container.resolve(LexicalEngine);
	await lexicalEngine.init();
	const query = "camera community";
	const resultsOr = await lexicalEngine.searchOr(query);
	const resultsAnd = await lexicalEngine.searchAnd(query);
	logger.debug(resultsOr);
	logger.debug(resultsAnd);
}
