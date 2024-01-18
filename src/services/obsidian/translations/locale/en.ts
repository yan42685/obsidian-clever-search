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
	"Database has been updated, a reindex is required":
		"Database has been updated, a reindex is required",

	// setting tab
	"Max items count": "Max items count",
	"Max items count desc":
		"Due to renderer's limited capabilities, this plugin can find thousands of results, but cannot display them all at once",

	"Floating window for in-file search": "Floating window for in-file search",
	"Floating window for in-file search desc": "Disable this option to use classic modal UI",

	"English word blacklist": "English word blacklist",
	"English word blacklist desc": `Exclude some meaningless English words like "do", "and", "them" from indexing, enhancing search and indexing speed. Modify the file at ${stopWordsEnTargetUrl} to tailor the list to your needs.`,
	"Chinese patch": "Chinese patch",
	"Chinese patch desc": "Better search result for Chinese",
	"Chinese word blacklist": "Chinese word blacklist",
	"Chinese word blacklist desc": `Activates only if the Chinese Patch is enabled. This excludes some meaningless Chinese words like "的", "所以", "尽管" listed in 'stop-words-zh.txt', improving search efficiency and speed. More details are listed in "English word blacklist" option`,


	// Advanced setting
	"Advanced": "Advanced",
	"Advanced.desc": "The previous settings cover most needs. For further customization, adjust the following options",

	"Excluded files": "Excluded files",
	Manage: "Manage",
	"Follow Obsidian Excluded Files": "Follow Obsidian Excluded Files",
	"Enter path...": "Enter path...",
	Add: "Add",

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
	"Reset floating window position": "Reset floating window position",
	"Reset floating window position desc": "In case the window is moved outside the visible area",
	"Reset position": "Reset position",

	"Support the Project": "Support the Project",
	"Support the Project desc":
		"Enjoying this plugin? Show your support with a star on GitHub!",
	"Visit GitHub": "Visit GitHub",
};
