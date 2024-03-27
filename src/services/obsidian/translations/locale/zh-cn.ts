import { stopWordsEnTargetUrl } from "./en";


export default {
	// notification
	"Reindexing...": "重建索引中...",
	"Indexing finished": "索引完成",
	"files need to be indexed. Obsidian may freeze for a while":
		"文件需要被索引, Obsidian 可能会卡顿一会儿",
	"Omnisearch isn't installed": "未安装 Omnisearch",
	"Omnisearch is installed but not enabled": "安装了 Omnisearch 但是没有启用",
	"Database has been updated, a reindex is required":
		"数据库已更新，需要重建索引",
	"Semantic init time": "本地模型索引速度大约是 200-800 字每秒，在此期间请不要关闭 Obsidian",
	"Semantic init finished": "语义引擎已就绪",

	"Downloading aiHelper": "正在下载 clever-search-ai-helper.zip (972 MB)...",
	"Download success": "下载成功",
	"Download failure": "clever-search-ai-helper.zip 下载失败  ",
	"Download manually": "点此手动下载",

	// setting tab
	"Max items count": "最大候选项数",
	"Max items count desc":
		"虽然本插件可以搜索到成千上万个结果，但由于底层渲染器性能限制，不能即时渲染所有结果",

	"Floating window for in-file search": "文件内搜索使用悬浮窗口 UI",
	"Floating window for in-file search desc": "再次执行 '文件内搜索' 命令会关闭已有的悬浮窗口。关闭这个选项将使用模态框 UI",

	"English word blacklist": "英文单词黑名单",
	"English word blacklist desc": `建立索引时，忽略一些含义模糊的单词，比如 "do", "and", "them", 可以加快索引和搜索速度，但是这些单词不会被搜索到. 可以在 ${stopWordsEnTargetUrl} 按需修改单词黑名单`,
	"Chinese patch": "中文搜索优化",
	"Chinese patch desc": "更好的中文搜索结果",
	"Chinese word blacklist": "中文词语黑名单",
	"Chinese word blacklist desc": `只在开启中文搜索优化时生效。忽略 "的", "所以", "尽管" 等词语，详细列表在 "stop-words-zh.txt"。详见 "英文单词黑名单" 选项`,


	"Advanced": "进阶设置",
	"Advanced.desc": "之前的设置通常能满足大多数使用场景，如果你想有更个性化的设置，可以调整下面的选项",


	// semantic search
	"Semantic search": "语义搜索",
	"Introduction": "介绍",
	"Introduction.desc": "语义搜索只支持 Windows 系统。仅推荐中小型资料库使用, 如果某个仓库有超过1500万字, 初次索引可能需要几十个小时。将下载的压缩包解压出的 .cache 文件夹放在 C:\\Users\\<current user>, 然后运行 clever-search-ai-helper.exe 来启动语义引擎。语义搜索旨在作为词汇搜索的补充，在精确匹配上效果是不如词汇搜索的",
	"Enable": "启用",
	"Server type": "服务器类型",
	"Server type.desc": "对于本地服务器，clever-search-ai-helper.exe 需要在后台运行; 远程服务器短期内不会实现",
	"local": "本地",
	"Utilities": "实用功能",
	"Test connection": "测试连接",
	"Download": "下载",
	"Additional Information": "补充信息",
	"Additional Information.desc": "在开启语义搜索并运行 ai-helper 的情况下，重新索引 会同时应用于词汇引擎和语义引擎；每次加载插件的时候，语义引擎会自动进行一次增量索引，之后修改文件不会更新索引以避免阻塞语义搜索。",

	"Excluded files": "忽略文件",
	Manage: "管理",
	"Follow Obsidian Excluded Files": "跟随 Obsidian 忽略文件设置",
	"Enter path...": "请输入路径...",
	Add: "添加",

	"Customize extensions": "自定义后缀名",
	"extensionModal.desc":
		"自定义希望索引的文件后缀名。默认情况下 Obsidian 不原生支持的文件类型，如 'txt'，将通过外部程序打开。要在 Obsidian 内打开这些文件，可能需要安装插件，如 'obsidian-custom-file-extension-plugin' 或 'obsidian-vscode-editor'。",
	"extensionModal.plaintextName": "纯文本",
	"extensionModal.plaintextDesc":
		"后缀名使用空格或换行符分隔。请不要在此处包含 'pdf'、'jpg'、'mp4' 等无法用记事本打开的二进制文件，否则可能会导致索引问题。另外，索引和搜索 HTML 文件可能会更慢，因为它们首先需要转换为干净的 Markdown 格式。此外，受 API 限制, 自动滚动到 HTML 文件中的特定位置似乎不可行。",



	"For Development": "开发设置",
	"Collapse development setting by default": "默认折叠开发设置",
	"Reindex the vault": "重新索引全库",
	Reindex: "重新索引",
	"Log level": "日志等级",
	"Reset floating window position": "重置悬浮窗口位置",
	"Reset floating window position desc": "如果窗口被拖到看不见的位置, 可以点此按钮重置",
	"Reset position": "重置位置",

	"Support the Project": "支持这个项目",
	"Support the Project desc":
		"如果觉得本插件对你有帮助，希望能到 GitHub 点个 star",
	"Visit GitHub": "访问 GitHub",
};
