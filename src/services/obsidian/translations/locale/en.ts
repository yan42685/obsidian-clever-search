import { pathUtil } from "src/utils/file-util";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const electron = require("electron");
const userDataPath = (electron.app || electron.remote.app).getPath("userData");

const assetsDir = pathUtil.join(userDataPath, "clever-search");
export const stopWordsEnTargetUrl = pathUtil.join(
	assetsDir,
	"stop-words-en.txt",
);

export default {
	// notification
	"Reindexing...": "Reindexing...",
	"Indexing finished": "Indexing finished",
	"hybridNotice.indexFallbackToBm25": "Indexing finished, but semantic indexing is unavailable. Results are currently downgraded to BM25.",
	"hybridNotice.searchFallbackToBm25": "Semantic search is unavailable. Current results have been downgraded to BM25.",
	"files need to be indexed. Obsidian may freeze for a while":
		"files need to be indexed. Obsidian may freeze for a while",
	"Omnisearch isn't installed": "Omnisearch isn't installed",
	"Omnisearch is installed but not enabled":
		"Omnisearch is installed but not enabled",
	"Database has been updated, a reindex is required":
		"Database has been updated, a reindex is required",
	"Semantic init time": "The local model indexes at a speed of approximately 100-500 words per second. During this time, please do not close Obsidian.",
	"Semantic init finished": "Semantic engine is ready",

	"Downloading aiHelper": "Downloading clever-search-ai-helper.zip (972 MB)...",
	"Download success": "Successfully downloaded",
	"Download failure": "Failed to download clever-search-ai-helper.zip  ",
	"Download manually": "Download manually",

	// setting tab
	"Max items count": "Max items count",
	"Max items count desc":
		"Due to renderer's limited capabilities, this plugin can find thousands of results, but cannot display them all at once",

	"Floating window for in-file search": "Floating window for in-file search",
	"Floating window for in-file search desc": "Execute 'in-file search' command again will close the existing floating window. Disable this option to use classic modal UI",
	"Search history": "Search history",
	"Search history desc": "Offer lightweight autocomplete from queries you have previously confirmed successfully. Only confirmed searches are recorded into history.",
	"Enable search history": "Enable search history",
	"Enable search history desc": "Record and use only confirmed searches for history suggestions and ghost completion.",
	"Search history suggestions": "Auto search history suggestions",
	"Search history suggestions desc": "Automatically show the history candidate popup while typing. Press Ctrl+R in the search modal to toggle the popup manually. Only confirmed searches are recorded.",
	"Search history ghost completion": "Auto ghost completion hint",
	"Search history ghost completion desc": "Automatically show the best matched history suffix as a ghost completion and accept it with Tab. Only confirmed searches are recorded.",
	"Search history max items": "Search history max items",
	"Search history max items desc": "Maximum number of history queries to keep. Supports up to 10000 entries.",
	"Clear search history": "Clear search history",
	"Clear search history desc": "Remove all saved search queries.",
	Recent: "recent",
	Clear: "Clear",

	"Case sensitive": "Case sensitive",
	"Prefix match":"Prefix match",
	"Character fuzzy allowed": "Character fuzzy allowed",

	"English word blacklist": "English word blacklist",
	"English word blacklist desc": `Exclude some meaningless English words like "do", "and", "them" from indexing, enhancing search and indexing speed. Modify the file at ${stopWordsEnTargetUrl} to tailor the list to your needs.`,
	"Chinese patch": "Chinese patch",
	"Chinese patch desc": "Better search result for Chinese",
	"Chinese word blacklist": "Chinese word blacklist",
	"Chinese word blacklist desc": `Activates only if the Chinese Patch is enabled. This excludes some meaningless Chinese words like "的", "所以", "尽管" listed in 'stop-words-zh.txt', improving search efficiency and speed. More details are listed in "English word blacklist" option`,


	// Advanced setting
	"Advanced": "Advanced",
	"Advanced.desc": "The previous settings cover most needs. For further customization, adjust the following options",

	// semantic search
	"Semantic search": "Semantic search",
	"Introduction": "Introduction",
	"Introduction.desc": "Semantic search is only supported on the Windows system. It is only recommended for small and medium-sized vault. If a vault has more than 8 million words, the initial indexing may take dozens of hours. You need to extract the .cache folder from the downloaded archive and place it in C:\\Users\\<current user>. Then, run clever-search-ai-helper.exe to start the semantic engine. Semantic search is intended to complement lexical search and is not as effective in exact matching as lexical search.",
	"Enable": "Enable",
	"Server type": "Server type",
	"Server type.desc": "For local server, Clever Search AI Helper needs to run in the background. For remote server, it will not be implemented in the short term.",
	"local": "local",
	"Utilities": "Utilities",
	"Test connection": "Test connection",
	"Download": "Download",
	"Additional Information": "Additional Information",
	"Additional Information.desc": "When semantic search is turned on and ai-helper is running, Reindex will be applied to both lexical and semantic engine; each time this plugin is loaded, the semantic engine will automatically perform an incremental index, and subsequent file modifications will not update the index to avoid blocking semantic search.",

	"Hybrid search": "Hybrid search",
	"Hybrid search desc": "Hybrid lexical plus semantic search with graceful fallback to lexical-only results when the Qwen embedding or rerank path fails.",
	"Manage hybrid search": "Manage hybrid search",

	"hybridModal.manageIntro": "Configure the hybrid pipeline here, including provider access, token budget, ranking, and indexing scope.",
	"hybridModal.desc": "Hybrid search combines lexical search with Qwen-based semantic retrieval. Indexing uses text-embedding-v4, search reranking uses qwen3-rerank, and both provider-reported token costs are counted toward the weekly limit. If the semantic path fails (network error, quota exceeded, etc.), results automatically fall back to lexical search.",
	"hybridModal.apiDomain": "API domain",
	"hybridModal.apiDomain.desc": "Leave blank to use dashscope.aliyuncs.com. For custom/proxy endpoints enter the domain only (e.g. my-proxy.example.com).",
	"hybridModal.apiKey": "API key",
	"hybridModal.apiKeyNotice": "Token values shown here come from the provider response usage fields. Hybrid search currently uses text-embedding-v4 and qwen3-rerank, so confirm your API key has access to both models.",
	"hybridModal.autoShowResultsWhenLexicalEmpty": "Auto show hybrid when lexical is empty",
	"hybridModal.autoShowResultsWhenLexicalEmpty.desc": "In normal vault search, if lexical results are 0 and the query length is at least 3, automatically show hybrid results. The first trigger is immediate, then repeated zero-result queries are trailing-debounced by 500 ms. After hybrid results are shown, the modal still remains in lexical search mode.",
	"hybridModal.autoFallbackFailed.title": "Lexical results are 0, and hybrid search also failed.",
	"hybridModal.autoFallbackFailed.possibleCauses": "Possible reasons:",
	"hybridModal.autoFallbackFailed.cause.api": "API key, API domain, or model permission is unavailable or invalid.",
	"hybridModal.autoFallbackFailed.cause.network": "Network, provider timeout, rate limit, or quota issue blocked the semantic path.",
	"hybridModal.autoFallbackFailed.cause.index": "Hybrid semantic index is unavailable, incomplete, or still loading.",
	"hybridModal.weeklyTokenLimit": "Weekly token limit",
	"hybridModal.weeklyTokenLimit.desc": "Maximum tokens to consume per week (Mon–Sun). Set to 0 for unlimited.",
	"hybridModal.maxResultCount": "Hybrid result count",
	"hybridModal.maxResultCount.desc": "How many reranked hybrid results to return and display per search.",
	"hybridModal.weeklyUsed": "This week used",
	"hybridModal.indexConcurrency": "Index concurrency",
	"hybridModal.indexConcurrency.desc": "How many files to embed in parallel during hybrid indexing. Higher values may be faster but can increase rate limits, timeouts, and UI pressure.",
	"hybridModal.vectorCompression": "Vector quantization",
	"hybridModal.vectorCompression.desc": "Choose how hybrid vectors are quantized and stored. Int8 uses less disk and searches faster; Float16 uses more disk and is usually more stable on purely semantic matches. Changing this requires rebuilding the hybrid index.",
	"hybridModal.vectorCompression.int8": "Int8 only (smaller, faster)",
	"hybridModal.vectorCompression.float16": "Float16 only (more stable semantic recall)",
	"hybridModal.fileRankStrategy": "File ranking",
	"hybridModal.fileRankStrategy.desc": "How to merge multiple matched chunks from the same file into one file-level rank.",
	"hybridModal.fileRankStrategy.bestPlusSupport": "Best chunk + support",
	"hybridModal.fileRankStrategy.bestChunk": "Best chunk only",
	"hybridModal.fileRankStrategy.sumTopChunks": "Sum of top chunks",
	"hybridModal.weeklyRemaining": "Remaining quota",
	"hybridModal.unlimited": "Unlimited",
	"hybridModal.weeklyLimitExceededNotice": "This week's token usage already exceeds the limit. Remaining quota is 0.",
	"hybridModal.excludedPaths": "Excluded paths (hybrid indexing)",
	"hybridModal.tokenStats": "Token usage statistics",
	"hybridModal.tokenStats.loading": "Loading stats...",
	"hybridModal.todayUsed": "Today",
	"hybridModal.thisWeekUsed": "This week",
	"hybridModal.thisMonthUsed": "This month",
	"hybridModal.weeklyUsage": "This week's token usage",
	"hybridModal.dailyTop": "Top 20 files today",
	"hybridModal.weeklyTop": "Top 20 files this week",
	"hybridModal.monthlyTop": "Top 20 files this month",
	"hybridModal.noData": "No data yet.",
	"hybridModal.file": "File",
	"hybridModal.tokens": "Tokens",
	"hybridModal.tokenStats.pinned": "Pinned",

	"Excluded files": "Excluded files",
	Manage: "Manage",
	"Follow Obsidian Excluded Files": "Follow Obsidian Excluded Files",
	"Enter path...": "Enter path...",
	Add: "Add",
	Update: "Update",

	"Customize extensions": "Customize extensions",
	"extensionModal.desc":
		"Customize the file extensions you would like to index. By default, file types not natively supported by Obsidian, such as 'txt', will be opened with an external program. To open these files within Obsidian, you may need to install plugins like 'obsidian-custom-file-extension-plugin' or 'obsidian-vscode-editor'.",
	"extensionModal.plaintextName": "Plaintext",
	"extensionModal.plaintextDesc":
		"Extensions should be separated by a space or a newline character. Please do not include binary filetypes like 'pdf', 'jpg', 'mp4', etc, that can't be opened with notepad. Including them might cause indexing issues. Additionally, the indexing and searching of HTML files may be slower because they require conversion to clean Markdown format first. Furthermore, due to the extremely limited API, it seems impossible to automatically scroll to specific locations within HTML files.",

	// for development
	"For Development": "For Development",
	"Collapse development setting by default":
		"Collapse development setting by default",
	"Reindex the vault": "Reindex the vault",
	Reindex: "Reindex",
	"Log level": "Log level",
	"File search backend": "File search backend",
	"File search backend desc":
		"Switch lexical file retrieval with one click. MiniSearch is the conservative choice; Custom BM25 is better at prefix-heavy and metadata-aware matching.",
	"fileSearchBackend.minisearch": "MiniSearch (stable)",
	"fileSearchBackend.customBm25": "Custom BM25",
	"Reset floating window position": "Reset floating window position",
	"Reset floating window position desc": "In case the window is moved outside the visible area",
	"Reset position": "Reset position",

	"Support the Project": "Support the Project",
	"Support the Project desc":
		"Enjoying this plugin? Show your support with a star on GitHub!",
	"Visit GitHub": "Visit GitHub",
};
