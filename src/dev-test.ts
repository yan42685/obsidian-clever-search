import { App, TFile } from "obsidian";
import { PluginSetting } from "./globals/plugin-setting";
import { SearchService } from "./services/obsidian/search-service";
import { LexicalEngine } from "./services/search/search-engine";
import { logger } from "./utils/logger";
import { getInstance, monitorExecution } from "./utils/my-lib";

export async function devTest() {
	const settings = getInstance(PluginSetting);
	// ====== API Request =====
	// const httpClient = getInstance(HttpClient);
	// httpClient.testRequest();

	// ====== vault files =====
	// setTimeout(() => {
	// 	monitorExecution(async () => {
	// 		const plugin: CleverSearch = getInstance(THIS_PLUGIN);
	// 		const vault = plugin.app.vault;
	// 		logger.debug(vault.getRoot().path); // /
	// 		logger.debug(vault.configDir); // .obsidian
	// 	});
	// }, 1300);

	// testStemmer();
	// testTsyringe();
	// testUnsupportedExtensions();

	monitorExecution(testLexicalSearch);
	// monitorExecution(async () => await testLexicalSearch());
	// testLexicalSearch();
	logger.trace("test");
}
function getApp() {
	return getInstance(App);
}

function testStemmer() {
	const words = ["gifs;d", "gifs", "哈哈", "很多只猫", "analyzers"];
}

function testTsyringe() {
	const obj1 = getInstance(SearchService);
	const obj2 = getInstance(SearchService);
	// in tsyringe, the default scope for class is singleton, so it should output "true"
	logger.info(`test equal: ${obj1 === obj2}`);
}

function testUnsupportedExtensions() {
	const vault = getApp().vault as any;
	logger.info(vault.getConfig("showUnsupportedFiles"));
}

async function testLexicalSearch() {
	const lexicalEngine = getInstance(LexicalEngine);
	// await lexicalEngine.initAsync();
	// const query = "camera communiy";
	const query = "whoknowthisfolder/whereisit";
	const resultsOr = await lexicalEngine.searchFiles(query, "or");
	const resultsAnd = await lexicalEngine.searchFiles(query, "and");

	logger.debug(resultsOr);
	// logger.debug(resultsAnd);
	const vault = getApp().vault;
	const tFile = vault.getAbstractFileByPath(resultsOr[0]?.path);
	if (tFile) {
		if (tFile instanceof TFile) {
			// const content = await vault.cachedRead(tFile);
			logger.info(`find first one: ${tFile.path}`);
		} else {
			logger.info(`it's a folder: ${tFile}`);
		}
	} else {
		logger.info(`no document is found`)
	}
}
