import { stopWordsEnTargetUrl } from "src/utils/web/assets-provider";

export default {
	// notification
	"Reindexing...": "Reindexing...",
	"Indexing finished": "Indexing finished",
	"files need to be indexed. Obsidian may freeze for a while":
		"files need to be indexed. Obsidian may freeze for a while",
	"Omnisearch isn't installed": "Omnisearch isn't installed",
	"Omnisearch is installed but not enabled":
		"Omnisearch is installed but not enabled",
	"Database has been updated, a reindex is required": "Database has been updated, a reindex is required",

	// setting tab
	"Max items count": "Max items count",
	"Max items count desc":
		"Due to renderer's limited capabilities, this plugin can find thousands of results, but cannot display them all at once",
	"English word blacklist": "English word blacklist",
	"English word blacklist desc": `Exclude some meaningless English words like "do", "and", "them" from indexing, enhancing search and indexing speed. Modify the file at ${stopWordsEnTargetUrl} to tailor the list to your needs.`,
	"Chinese patch": "Chinese patch",
	"Chinese patch desc": "Better search result for Chinese",
	"Chinese word blacklist": "Chinese word blacklist",
	"Chinese word blacklist desc": `Activates only if the Chinese Patch is enabled. This excludes some meaningless Chinese words like "的", "所以", "尽管" listed in 'stop-words-zh.txt', improving search efficiency and speed. More details are listed in "English word blacklist" option`,
	"For Development": "For Development",
	"Collapse development setting by default":
		"Collapse development setting by default",
	"Support the Project": "Support the Project",
	"Support the Project desc":
		"Enjoying this plugin? Show your support with a star on GitHub!",
	"Visit GitHub": "Visit GitHub",
	"Reindex the vault": "Reindex the vault",
	Reindex: "Reindex",
	"Log level": "Log level",
};
