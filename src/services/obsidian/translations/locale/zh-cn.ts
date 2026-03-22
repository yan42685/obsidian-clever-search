export default {
	"Reindexing...": "正在重建索引...",
	"Indexing finished": "索引完成",
	"Database has been updated, a reindex is required":
		"数据库版本已更新，需要重新建立索引",
	"Hybrid search": "混合搜索",
	"Hybrid search desc":
		"混合词法搜索与语义搜索。当 embedding 或 rerank 链路失败时，会自动降级为词法结果。",
	Manage: "管理",
	Update: "更新",
	Add: "添加",
	Clear: "清空",
	Enable: "启用",
	"Enter path...": "输入路径...",
	"Search history": "搜索历史",
	"Search history desc": "为搜索框提供基于已成功确认查询的轻量补全。只有确认过的搜索才会被记录进历史。",
	"Enable search history": "启用搜索历史",
	"Enable search history desc": "基于已确认过的搜索记录启用历史记录、候选框和影子补全。",
	"Search history suggestions": "自动触发历史候选框",
	"Search history suggestions desc": "输入时自动显示历史搜索候选框。在搜索模态框中可按 Ctrl+R 手动开关候选框。只有确认过的搜索才会被记录。",
	"Search history ghost completion": "自动显示影子补全提示",
	"Search history ghost completion desc": "自动显示最佳历史记录的影子补全提示，并可用 Tab 接受补全。只有确认过的搜索才会被记录。",
	"Search history max items": "搜索历史最大条数",
	"Search history max items desc": "保留的搜索历史记录最大条数，当前最高支持 10000 条。",
	"Clear search history": "清空搜索历史",
	"Clear search history desc": "删除已保存的搜索词记录。",
	Recent: "最近",
	"hybridModal.desc":
		"混合搜索结合了词法搜索与千问语义检索。索引阶段使用 text-embedding-v4，搜索阶段使用 qwen3-rerank，接口返回的 token 用量会计入每周限额。当语义链路失败时，结果会自动降级为词法搜索。",
	"hybridModal.apiDomain": "API 域名",
	"hybridModal.apiDomain.desc":
		"留空默认使用 dashscope.aliyuncs.com。若使用代理，只需填写域名即可。",
	"hybridModal.apiKey": "API Key",
	"hybridModal.apiKeyNotice":
		"这里显示的 token 以千问接口返回的 usage 为准。当前混合搜索会使用 text-embedding-v4 和 qwen3-rerank，请确认 API Key 已开通这两个模型。",
	"hybridModal.autoShowResultsWhenLexicalEmpty": "词法无结果时自动展示 hybrid",
	"hybridModal.weeklyTokenLimit": "每周 token 限额",
	"hybridModal.weeklyTokenLimit.desc":
		"每周（周一至周日）最多允许消耗的 token 数量，设为 0 表示不限制。",
	"hybridModal.maxResultCount": "混合搜索结果数量",
	"hybridModal.maxResultCount.desc":
		"每次混合搜索返回并展示的 rerank 结果数量。",
	"hybridModal.weeklyUsed": "本周已使用",
	"hybridModal.weeklyRemaining": "本周剩余额度",
	"hybridModal.unlimited": "不限",
	"hybridModal.weeklyLimitExceededNotice":
		"本周 token 用量已超过限制，本周剩余额度为 0。",
	"hybridModal.indexConcurrency": "索引并发数",
	"hybridModal.indexConcurrency.desc":
		"混合索引时并行调用 embedding 的文件数量。更高的值可能更快，但也更容易触发限流、超时或增加 UI 压力。",
	"hybridModal.vectorCompression": "向量量化",
	"hybridModal.vectorCompression.desc":
		"选择混合搜索向量的量化与存储方式。Int8 占用更小、搜索更快；Float16 占用更大，但在纯语义匹配时通常更稳定。修改后需要重建 hybrid 索引。",
	"hybridModal.vectorCompression.int8": "仅 Int8（更小、更快）",
	"hybridModal.vectorCompression.float16": "仅 Float16（语义召回更稳）",
	"hybridModal.excludedPaths": "排除路径（混合索引）",
	"hybridModal.tokenStats": "Token 使用统计",
	"hybridModal.tokenStats.loading": "正在加载统计...",
	"hybridModal.weeklyUsage": "本周 token 使用",
	"hybridModal.dailyTop": "今日 Top 20 文件",
	"hybridModal.weeklyTop": "本周 Top 20 文件",
	"hybridModal.monthlyTop": "本月 Top 20 文件",
	"hybridModal.noData": "暂无数据",
	"hybridModal.file": "文件",
	"hybridModal.tokens": "Tokens",
	"hybridModal.tokenStats.pinned": "置顶",
	"hybridModal.estimatedSavings": "估算节省 Token",
	"hybridModal.estimatedSavings.weekly": "由于增量 chunk embedding 技术，本周估算节省 ",
	"hybridModal.estimatedSavings.total": "累计估算节省 ",
	"hybridNotice.indexFallbackToBm25":
		"语义索引当前不可用，已降级为 BM25 索引。",
	"hybridNotice.searchFallbackToBm25":
		"语义搜索当前不可用，本次结果已降级为 BM25。",
	"File search backend": "文件搜索后端",
	"File search backend desc":
		"一键切换词法文件检索后端。MiniSearch 更保守稳定；自定义 BM25 在前缀匹配和元数据感知方面更强。",
	"fileSearchBackend.minisearch": "MiniSearch（稳定）",
	"fileSearchBackend.customBm25": "自定义 BM25",
	"Manage hybrid search": "管理混合搜索",
	"hybridModal.manageIntro":
		"在这里可以集中管理 hybrid 搜索的接口配置、token 预算、排序策略和索引范围。",
	"hybridModal.todayUsed": "本日",
	"hybridModal.thisWeekUsed": "本周",
	"hybridModal.thisMonthUsed": "本月",
	"hybridModal.autoShowResultsWhenLexicalEmpty.desc":
		"在普通库内搜索中，如果词法搜索结果为 0，且查询长度至少为 3，则自动展示 hybrid 结果。第一次触发会立即执行，之后连续出现 0 结果时会以 500 ms 的 trailing debounce 展示最后一次对应的 hybrid 结果。展示 hybrid 结果后，搜索框仍然处于 lexical 搜索模式。",
	"hybridModal.autoFallbackFailed.title":
		"词法结果为 0，且 hybrid 搜索也失败了。",
	"hybridModal.autoFallbackFailed.possibleCauses": "可能原因：",
	"hybridModal.autoFallbackFailed.cause.api":
		"API Key、API 域名或模型权限不可用或无效。",
	"hybridModal.autoFallbackFailed.cause.network":
		"网络、供应商超时、限流或额度问题阻塞了语义链路。",
	"hybridModal.autoFallbackFailed.cause.index":
		"Hybrid 语义索引不可用、不完整，或仍在加载中。",
	"files need to be indexed. Obsidian may freeze for a while":
		"有文件需要建立索引，Obsidian 可能会暂时卡顿。",
	"Omnisearch isn't installed": "未安装 Omnisearch。",
	"Omnisearch is installed but not enabled": "Omnisearch 已安装，但尚未启用。",
	"Semantic init time":
		"本地模型建立索引的速度大约为每秒 100-500 词。在此期间请不要关闭 Obsidian。",
	"Semantic init finished": "语义引擎已就绪",
	"Downloading aiHelper": "正在下载 clever-search-ai-helper.zip（972 MB）...",
	"Download success": "下载成功",
	"Download failure": "下载 clever-search-ai-helper.zip 失败",
	"Download manually": "手动下载",
	"Max items count": "最大结果条数",
	"Max items count desc":
		"受渲染器能力限制，插件可以找到成千上万条结果，但无法一次性全部显示。",
	"Floating window for in-file search": "文件内搜索使用浮动窗口",
	"Floating window for in-file search desc":
		"再次执行“文件内搜索”命令会关闭已存在的浮动窗口。关闭此选项可改为使用经典模态框。",
	"Case sensitive": "区分大小写",
	"Prefix match": "前缀匹配",
	"Character fuzzy allowed": "允许字符级模糊匹配",
	"English word blacklist": "英文停用词",
	"English word blacklist desc":
		"将 do、and、them 等意义较弱的英文词排除出索引，可提升搜索与建索引速度。可按需修改 stop-words-en.txt。",
	"Chinese patch": "中文补丁",
	"Chinese patch desc": "为中文提供更好的搜索结果",
	"Chinese word blacklist": "中文停用词",
	"Chinese word blacklist desc":
		"仅在启用中文补丁时生效。会将 stop-words-zh.txt 中列出的一些中文虚词排除出索引，以提升搜索效率与速度。",
	"Advanced": "高级设置",
	"Advanced.desc": "前面的设置已覆盖大多数需求，如需进一步自定义，可调整以下选项。",
	"Semantic search": "语义搜索",
	"Introduction": "介绍",
	"Introduction.desc":
		"语义搜索目前仅支持 Windows，且更适合中小型库。如果库内超过 800 万词，初次建索引可能需要数十小时。你需要将下载压缩包中的 .cache 文件夹解压到 C:\\Users\\<当前用户>，然后运行 clever-search-ai-helper.exe 启动语义引擎。语义搜索主要用于补充词法搜索，在精确匹配上通常不如词法搜索。",
	"Server type": "服务类型",
	"Server type.desc":
		"如果使用本地服务，需要在后台运行 Clever Search AI Helper。远程服务短期内不会实现。",
	"local": "本地",
	"Utilities": "工具",
	"Test connection": "测试连接",
	"Download": "下载",
	"Additional Information": "补充说明",
	"Additional Information.desc":
		"启用语义搜索且 ai-helper 正在运行时，重建索引会同时作用于词法与语义引擎；每次插件加载时语义引擎也会自动执行增量索引。为避免阻塞语义搜索，后续文件修改不会实时更新语义索引。",
	"Excluded files": "排除文件",
	"Follow Obsidian Excluded Files": "跟随 Obsidian 排除文件设置",
	"Customize extensions": "自定义扩展名",
	"extensionModal.desc":
		"自定义你希望建立索引的文件扩展名。默认情况下，Obsidian 原生不支持的文件类型（如 txt）会由外部程序打开。若希望在 Obsidian 内打开它们，可能需要安装 obsidian-custom-file-extension-plugin 或 obsidian-vscode-editor 等插件。",
	"extensionModal.plaintextName": "纯文本",
	"extensionModal.plaintextDesc":
		"扩展名之间请用空格或换行分隔。请不要包含 pdf、jpg、mp4 等无法用记事本打开的二进制文件，否则可能导致索引异常。此外，HTML 文件在索引与搜索时通常更慢，因为需要先转换为干净的 Markdown；同时由于 API 限制，HTML 文件似乎也无法自动滚动到指定位置。",
	"For Development": "开发选项",
	"Collapse development setting by default": "默认折叠开发设置",
	"Reindex the vault": "重建整个库的索引",
	"Reindex": "重建索引",
	"Log level": "日志级别",
	"Reset floating window position": "重置浮动窗口位置",
	"Reset floating window position desc":
		"当浮动窗口被拖到可视区域之外时，可用此项重置位置。",
	"Reset position": "重置位置",
	"Support the Project": "支持项目",
	"Support the Project desc": "如果这个插件对你有帮助，欢迎去 GitHub 点个 Star。",
	"Visit GitHub": "访问 GitHub",
};
