import { App, TFile } from "obsidian";
import { container } from "tsyringe";
import { PluginSetting } from "./services/obsidian/setting";
import { LexicalEngine, SearchHelper } from "./services/search/search-helper";
import { logger } from "./utils/logger";
import { monitorExecution } from "./utils/my-lib";

export async function testOnLoad() {
	const settings = container.resolve(PluginSetting);
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

	monitorExecution(testLexicalSearch);
	// monitorExecution(async () => await testLexicalSearch());
	// testLexicalSearch();
}
function getApp() {
	return container.resolve(App);
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
	// logger.debug(resultsOr);
	// logger.debug(resultsAnd);
	const vault = getApp().vault;
	const tFile = vault.getAbstractFileByPath(resultsOr[0]?.id);
	if (tFile instanceof TFile) {
		const content = await vault.cachedRead(tFile);
		logger.info(content);
	} else {
		logger.info(`not a TFile: ${tFile}`);
	}
}
