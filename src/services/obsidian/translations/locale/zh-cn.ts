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
	"hybridModal.weeklyTokenLimit": "每周 token 限额",
	"hybridModal.weeklyTokenLimit.desc":
		"每周（周一至周日）最多允许消耗的 token 数量，设为 0 表示不限制。",
	"hybridModal.maxResultCount": "混合搜索结果数量",
	"hybridModal.maxResultCount.desc":
		"每次混合搜索返回并展示的 rerank 结果数量。",
	"hybridModal.weeklyUsed": "本周已使用",
	"hybridModal.weeklyRemaining": "剩余额度",
	"hybridModal.unlimited": "不限",
	"hybridModal.weeklyLimitExceededNotice":
		"本周 token 用量已超过限制，剩余额度为 0。",
	"hybridModal.indexConcurrency": "索引并发数",
	"hybridModal.indexConcurrency.desc":
		"混合索引时并行调用 embedding 的文件数量。更高的值可能更快，但也更容易触发限流、超时或增加 UI 压力。",
	"hybridModal.vectorCompression": "向量量化",
	"hybridModal.vectorCompression.desc":
		"选择混合搜索向量的量化与存储方式。Int8 占用更小、搜索更快；Float16 占用更大，但在纯语义匹配时通常更稳定。修改后需要重建 hybrid 索引。",
	"hybridModal.vectorCompression.int8": "仅 Int8（更小、更快）",
	"hybridModal.vectorCompression.float16": "仅 Float16（语义召回更稳）",
	"hybridModal.fileRankStrategy": "文件排序策略",
	"hybridModal.fileRankStrategy.desc":
		"同一文件命中多个小块时，如何合并成文件级排序分数。",
	"hybridModal.fileRankStrategy.bestPlusSupport": "最佳小块 + 辅助支持",
	"hybridModal.fileRankStrategy.bestChunk": "仅最佳小块",
	"hybridModal.fileRankStrategy.sumTopChunks": "Top 小块累加",
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
	"hybridNotice.indexFallbackToBm25":
		"语义索引当前不可用，已降级为 BM25 索引。",
	"hybridNotice.searchFallbackToBm25":
		"语义搜索当前不可用，本次结果已降级为 BM25。",
	"File search backend": "文件搜索后端",
	"File search backend desc":
		"一键切换词法文件检索后端。MiniSearch 更保守稳定；自定义 BM25 在前缀匹配和元数据感知方面更强。",
	"fileSearchBackend.minisearch": "MiniSearch（稳定）",
	"fileSearchBackend.customBm25": "自定义 BM25",
};
