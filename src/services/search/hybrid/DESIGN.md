# Hybrid Search 设计文档

## 背景与目标

在原有 Lexical（BM25 via MiniSearch）和 Semantic（外部 AI helper）之外，新增一条完全内置的 hybrid 搜索路径：
- 不依赖外部 AI helper 进程
- 直接调用 OpenAI Embedding API（text-embedding-3-small, dim=512）
- BM25 + 双层向量（小块 + 大块）三路 RRF 融合
- 无 API key 时自动降级到纯 BM25

---

## 用户决策（已确认）

| 项目 | 决策 |
|------|------|
| 向量精度主路径 | int8 量化 |
| Rescoring 分支 | float16（留口子，可切换） |
| BM25 proximity | 要，存 delta 编码 positions |
| 向量层 | 小块 + 大块双层 |
| Web Worker | 暂不用 |
| Embedding 模型 | OpenAI text-embedding-3-small, dimensions=512 |

---

## 模块结构（7 个文件）

```
src/services/search/hybrid/
├── hybrid-types.ts    — 所有类型定义 + 常量
├── chunker.ts         — 文本切块（大块 + 小块）
├── embedder.ts        — OpenAI 嵌入 + int8/float16 量化 + LRU 缓存
├── bm25.ts            — 内存 BM25 倒排索引
├── hnsw.ts            — HNSW 向量图（纯 TS 实现）
├── hybrid-store.ts    — Dexie 行类型 + Blob 序列化工具
└── hybrid-engine.ts   — 对外入口：indexFile / deleteFile / search
```

---

## chunker.ts

**输入:** `filePath + plainText`
**输出:** `{ bigChunks: RawBigChunk[], chunks: RawChunk[] }`

### 大块（BigChunk）切分策略
1. 按 ATX 标题（`#` / `##` / `###`）分 section
2. section 内按空行（`\n\n`）进一步分段落
3. 段落合并：目标 500 chars，超过时 flush
4. 超长段落（> 900 chars）：在句号 / 换行处切断
5. 每个大块保留所属标题作为 prefix（提升 BM25 权重）

### 小块（Chunk）切分策略
- 对每个大块做滑动窗口：目标 150 chars，overlap 30 chars
- 记录 `bigChunkIdx`（临时索引，入库后换成真实 id）

### 行号映射
- 预构建 `lineOffsets[]`（每行起始 char offset）
- 二分查找 offset → line number，O(log n)

---

## embedder.ts

- 批量调用 OpenAI API，batch size = 100
- 返回 float32[]，已 L2 归一化
- **int8 量化:** `scale = max(|v[i]|)`，`int8[i] = round(v[i] / scale * 127)`
- **float16 量化:** 手动 IEEE 754 half-precision 转换，存 `Uint16Array`
- **Query LRU 缓存:** `Map<string, {vec, scale, ts}>`，50 条，TTL 10 min
- 无 API key → 抛 `NoApiKeyError`，hybrid-engine 捕获后降级到纯 BM25

---

## bm25.ts

### 数据结构（全内存）
```
termDict:    Map<string, {termId, df}>
postings:    Map<termId, PostingList>   // 按 docId 排序
docLengths:  Map<bigChunkId, number>
docCount:    number
avgBigChunkLen: number
```

### 索引时
- 复用现有 `Tokenizer.tokenize()`
- 预计算 `tf_norm = tf*(k1+1) / (tf + k1*(1 - b + b*dl/avgdl))`，k1=1.5，b=0.75
- positions 存 delta 编码 uint16[]

### 搜索时
- `score = Σ tf_norm * ln((N - df + 0.5) / (df + 0.5) + 1)`
- **Proximity bonus:** 找多 term 最小 span → `+200 / (span + 1)`（滑动窗口算法）

### 持久化
- 整个索引 JSON → Blob → IndexedDB 单条记录（`hybridBm25Index` 表，id=0）

---

## hnsw.ts

**参数:** M=16, efConstruction=100, ef=40

### 距离函数
```
dot = Σ a[i] * b[i]          // int32 累加，防溢出
sim = dot / (scaleA * scaleB * 127²)   // 近似余弦相似度
dist = 1 - sim
```

### 核心操作
- `insert(id, int8Vec, scale, vecF16?)` — 随机层级，逐层建邻居
- `search(queryVec, queryScale, topK, ef)` — 贪心下降 + 候选集扩展
- `delete(id)` — lazy deletion，记录 `deletedSet`
- `needsRebuild()` — `deletedSet.size > nodes.size * 0.2` 时触发重建
- `rebuild()` — 过滤已删节点，重新 insert

### float16 Rescoring 分支
- `precision='float16'` 时，search 先取 top-50，再用 float16 向量精确重排

### 持久化
- 序列化为 plain object（Map → Array）→ JSON → Blob

---

## hybrid-store.ts

扩展 `DexieWrapper`，版本 2 → 3，新增 6 张表：

| 表名 | 用途 |
|------|------|
| `hybridChunks` | 小块：id, bigChunkId, filePath, vector(Blob), scale, precision |
| `hybridBigChunks` | 大块：id, filePath, text, startLine, endLine, chunkIds(JSON), vector?, scale? |
| `hybridBm25Index` | BM25 整体序列化，id=0 单条 |
| `hybridHnswSmall` | 小块 HNSW 图序列化，id=0 单条 |
| `hybridHnswBig` | 大块 HNSW 图序列化，id=0 单条 |
| `hybridDocRefs` | 增量更新用，path + updateTime |

---

## hybrid-engine.ts

### 对外接口
```ts
indexFile(filePath, plainText)  // 切块 → embed → 建索引 → 持久化
deleteFile(filePath)            // 删除该文件所有数据，更新内存索引
search(query, topK=20)          // 三路 RRF → FileItem[]
isReady()                       // DB 加载完成
canSearch()                     // false 时降级纯 BM25
```

### 搜索流程（三路 RRF）
```
1. embed(query) → queryVec（带 LRU 缓存）
2. hnswSmall.search → [{chunkId, score}]
   → rollup by bigChunkId（取 maxScore）
3. hnswBig.search → [{bigChunkId, score}]
4. bm25.search → [{bigChunkId, score}]
5. RRF(k=60):
   score = 1/(60+rank_vec_small)
         + 0.7/(60+rank_vec_big)   ← 大块语义更模糊，权重略低
         + 1/(60+rank_bm25)
6. 按 filePath 聚合，取每文件 top bigChunks
7. 返回 FileItem[]（复用现有类型）
```

### 降级策略
- `NoApiKeyError` → `_canSearch = false` → 只走 BM25
- 任何 embed 失败 → 同上，不影响 BM25 结果

---

## 接入现有代码

| 复用点 | 用途 |
|--------|------|
| `Tokenizer.tokenize()` | BM25 分词 |
| `FileItem / FileSubItem` | 搜索结果类型 |
| `DexieWrapper` | 存储（版本升级） |
| `getInstance / monitorDecorator` | DI + 性能监控 |
| `OuterSetting.apiProvider1.key` | OpenAI API key 读取 |
| `DataProvider.readPlainText()` | 文件内容读取 |
| `DataManager.docOperationsHandler` | 文件增删时同步更新 hybrid 索引 |
| `SearchService` | 暴露 `hybridEngine` 实例 + `searchInVaultHybrid()` |
| `MountedModal.svelte` | `isHybrid` prop 触发 hybrid 搜索路径 |
| `CommandRegistry.addDevCommands()` | dev 模式下注册 "Hybrid search" 命令 |
