# Hybrid Search 设计文档

## 目标
当前 hybrid 搜索已经收敛为一条“小块优先”的本地检索链路：

- 只保留小块索引，不再维护大块索引
- 小块直接存储原文、起始行列和向量
- 本地召回使用 `BM25 + dense HNSW`
- 双路召回去重后，直接送 `qwen3-rerank`
- 最终结果按文件聚合，但排序基础仍然是小块

这版设计的重点不是做一个“通用检索框架”，而是在 Obsidian 插件场景里尽量用更低的复杂度换取：

- 可接受的本地搜索速度
- 可控的索引体积
- 对精确关键词和语义相关都还不错的召回
- 结构尽量简单，便于继续迭代

---

## 当前架构

目录结构：

```text
src/services/search/hybrid/
├── hybrid-types.ts
├── chunker.ts
├── embedder.ts
├── bm25.ts
├── hnsw.ts
├── hybrid-store.ts
├── reranker.ts
└── hybrid-engine.ts
```

各模块职责：

- `chunker.ts`
  - 把文件切成约 `300 token` 的小块
  - 小块带 overlap
  - 直接产出小块文本和起始行列信息
- `embedder.ts`
  - 调用千问 embedding API
  - 负责 token 预算检查与记账
  - 向量量化为 `int8` 或 `float16`
- `bm25.ts`
  - 本地 BM25 倒排索引
  - 保留 token 顺序与重复
  - 额外保存“位置桶”以支持近似 proximity bonus
- `hnsw.ts`
  - 本地 dense 向量 ANN 检索
  - 当前只维护小块 HNSW
- `hybrid-store.ts`
  - Dexie 行类型
  - BM25/HNSW 的 Blob 序列化与反序列化
- `reranker.ts`
  - 调用 `qwen3-rerank`
  - 搜索阶段 token 用量计入每周限额
- `hybrid-engine.ts`
  - 对外入口：索引、删除、加载、搜索

---

## 小块切分

当前不再有“大块 -> 小块”的两级结构。

`chunkFile(filePath, plainText)` 直接返回：

```ts
type ChunkerOutput = {
  chunks: RawChunk[];
};
```

`RawChunk` 包含：

```ts
type RawChunk = {
  filePath: string;
  text: string;
  startLine: number;
  startCol: number;
  endLine: number;
};
```

切分策略：

- 目标大小：`SMALL_CHUNK_TARGET = 300 token`
- 允许少量超出：`CHUNK_MAX_OVERFLOW_RATIO = 0.15`
- 保留 overlap：
  - `CHUNK_OVERLAP_MIN_RATIO = 0.14`
  - `CHUNK_OVERLAP_TARGET_RATIO = 0.16`
  - `CHUNK_OVERLAP_MAX_RATIO = 0.18`
- 尽量在句号、问号、感叹号、换行等边界附近切开

设计原因：

- 直接用小块就足够支撑当前 rerank 方案
- 去掉大块后，索引结构、持久化和搜索逻辑都明显更简单
- 小块直接存原文后，不再需要依赖大块做文本恢复

---

## 小块持久化

当前 `Chunk` 结构：

```ts
type Chunk = {
  id: number;
  filePath: string;
  text: string;
  startLine: number;
  startCol: number;
  endLine: number;
  vector: Int8Array;
  scale: number;
  vectorF16?: Uint16Array;
};
```

对应 Dexie 行：

```ts
type ChunkRow = {
  id?: number;
  filePath: string;
  text: string;
  startLine: number;
  startCol: number;
  endLine: number;
  vector: Blob;
  scale: number;
  precision: string;
  vectorF16?: Blob;
};
```

当前权衡：

- 优点：
  - 搜索结果展示直接用小块原文
  - 不需要依赖大块或回源文件做二次展开
  - 删除大块后整条链路更干净
- 代价：
  - overlap 会导致部分文本重复存储
  - 但在当前版本里，这比继续维护一套大块结构更划算

---

## BM25 设计

### 基本思路

BM25 现在是小块级索引，一条小块就是一条 BM25 文档。

`addDocument(docId, text)` 时：

- 使用 `Tokenizer.tokenizeSequence()` 获取“保序且不去重”的 token 序列
- 这样 `tf`、`dl` 和 proximity 才有实际意义

### 词距信息

当前没有保存“精确 token 位置”，而是保存“位置桶”：

- `BM25_POSITION_BUCKET_SIZE = 4`
- 每 4 个 token 一个桶
- 每个 term 最多保留 `8` 个位置桶

这样做的目的：

- 保留近似 proximity 能力
- 显著降低 posting 体积

### proximity bonus

搜索时，如果 query 至少有两个词：

- 汇总各词在文档里的位置桶
- 计算覆盖所有 query term 的最小 span
- 转回近似 token 距离
- 加一个 bonus：

```ts
bonus = 200 / (approxTokenSpan + 1)
```

它的作用是：

- query 词彼此更靠近的小块，排位更前

### 持久化

BM25 不再使用 JSON 持久化。

当前做法：

- 二进制编码后存入 `hybridBm25Index`
- 只支持当前二进制格式
- 旧 JSON BM25 通过数据库版本升级自动失效并重建

这样做的原因：

- JSON 体积太大
- `number[]` + 对象层级的存储开销太高

---

## Dense HNSW 设计

当前只保留小块 HNSW。

参数：

- `M = 16`
- `efConstruction = 100`
- 搜索 `ef = 40`

向量精度：

- 默认 `int8`
- 可切换 `float16`

当前用途：

- 从语义角度召回 topK 小块
- 不再维护大块级 dense 索引

---

## 搜索流程

`HybridEngine.search(query, topK=20)` 的当前流程：

1. BM25 召回小块 `top25`
2. 如果语义可用：
   - query embedding
   - HNSW dense 召回小块 `top25`
3. 双路结果按小块 `id` 去重
4. 去重后的小块直接送 `qwen3-rerank`
5. rerank 结果按分数降序
6. 按文件聚合：
   - 文件顺序由该文件最高分小块决定
   - 文件内 subitems 按小块分数顺序排列

当前不再做：

- 大块排序
- RRF 融合
- 大块展开后再取小块

---

## rerank 设计

当前使用：

- 模型：`qwen3-rerank`
- instruct：`Retrieve semantically similar text.`

输入：

- query
- 去重后的小块原文列表

输出：

- rerank score

展示层：

- `subitem.score` 显示 rerank 分数
- 保留 3 位小数
- 直接显示原始小块全文

---

## 降级策略

### 索引阶段

如果 embedding 失败：

- 当前文件退回 BM25-only 建索引
- 记录 fallback notice

### 搜索阶段

如果 query embedding 失败：

- 只用 BM25 候选做 rerank

如果 rerank 失败：

- 直接按召回阶段顺序回退

---

## 数据库版本

当前数据库版本：`6`

升级目的：

- 移除大块表与大块 HNSW
- 移除旧 BM25 JSON 兼容
- 统一切到“小块直存原文”的结构

升级后会清空 hybrid 相关索引并自动重建。

---

## 当前已知取舍

### 优势

- 结构明显比“大块 + 小块双层”简单
- 结果展示更直接
- 小块已经足够支撑当前 rerank 实验方案
- BM25 体积比旧版下降很多，同时保留近似词距

### 局限

- 小块原文直存仍然会有 overlap 带来的重复文本
- BM25 的 proximity 现在是近似词距，不是精确词位
- 最终整体延迟在很多场景下仍会被远端 rerank 主导

---

## 后续可能方向

值得继续观察的方向：

- BM25 体积和召回质量的平衡是否已经足够
- 是否还需要进一步减少 chunk overlap
- 是否要为 hybrid 搜索加入更细的触发策略
- 是否需要把 storage stats 和查询统计做成开发命令
