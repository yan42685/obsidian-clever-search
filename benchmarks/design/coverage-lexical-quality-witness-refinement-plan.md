# Coverage Lexical Quality Witness Refinement Plan

Date: 2026-03-31

## 背景

上一轮 `metadata priority` 改动已经把 `familyCountSummary` 和 metadata 单归属计数搭起来了，也把最终排序改成了 count-first 前缀加 route-specific detail comparator。

但 benchmark 和 guardrail case 表明，当前版本仍然存在一个明确问题：

- 某些 query 下，metadata count 会比正文质量信号更早、更硬地介入排序
- 这会把“主题上很像 / 锚点很多”的页面抬到前面
- 而真正最像直接答案的页面，虽然正文里有更强的 exact wording、顺序、局部窗口证据，却因为这些信号出现得太晚而失去翻盘机会

这不是 recall 问题，而是 ranking comparator 的语义问题。

## 目标

把当前排序语义从“metadata count 更早发声” refinement 成：

`metadata-first with body-quality guardrails`

也就是：

1. 保留 metadata 分布在最终排序里的优先级
2. 不抹平现有 route 差异
3. 让强正文 witness 在必要时能越过一部分 metadata count 压制
4. 避免 `folder / headings / tags` 这类 broad-topic metadata 过早压住明显更像答案的正文结果

## 非目标

这一轮先不做下面这些事情：

- 不重写 recall lane 结构
- 不直接改 planner 路由判定规则
- 不把三条 route 合并成单一路由
- 不推翻 `familyCountSummary`
- 不覆盖用户当前未提交的 planner 改动

## 需要解决的核心冲突

### 冲突 A：Metadata Count 先手过强

当前 count-first 语义在 `metadata-first` 和 `body-with-anchor` route 下，倾向于先看：

- `metadataMatchedFamilyCount`
- `basenameMatchedFamilyCount`
- `aliasesMatchedFamilyCount`
- `folderMatchedFamilyCount`
- `headingsMatchedFamilyCount`
- `tagsMatchedFamilyCount`

这会让“索引页 / 映射页 / 主题页 / 概览页”在许多 query 下抢先。

### 冲突 B：Body Quality Witness 进场太晚

当前能代表“正文像答案”的信号分散在后面的 detail comparator 里：

- `coreBody.exactWeight`
- `coreBody.coverageCount`
- `localEvidence.primary`
- `localEvidence.support`
- `phraseBridgeCount`
- `phraseBridgeWeight`
- `tailCoreWeight`

这些信号虽然存在，但它们现在更像尾部 tie-breaker，而不是可以在关键时刻纠偏的“强证据”。

### 冲突 C：Strong Anchor Metadata 与 Broad Topic Metadata 没有被显式区分

在产品语义上，下面几类 metadata 的强度并不一样：

- `basename`
- `aliases`
- `folder`
- `headings`
- `tags`

其中：

- `basename` 和强 `aliases` 更像页面身份或显式锚点
- `folder` 更像主题语境
- `headings`、`tags` 更像辅助补充

如果仅靠 count 前缀逐项比较，会让弱 metadata 也获得过强优先级。

## 设计原则

### 原则 1：先保留 coverage，再讨论优先级

`totalMatchedFamilyCount` 继续保留在最前面。

它代表这篇文档总体上接住了多少 query family，是大方向正确的第一层。

### 原则 2：把“正文强证据”显式化

不要再把正文质量完全散落在 detail comparator 的末尾，而是抽出一个显式的 witness 层。

这个 witness 不要求完全替代 metadata count，而是作为护栏：

- metadata count 明显更强时，仍然可以赢
- 但若另一侧有明显更强的正文 witness，就不该被 `folder/headings/tags` 轻易压下去

### 原则 3：强 metadata 与弱 metadata 分层

下一轮要把 metadata 分成两档来理解：

- strong metadata:
  - `basename`
  - `aliases`
- broad metadata:
  - `folder`
  - `headings`
  - `tags`

这样才能实现你想要的“metadata 优先，但不是所有 metadata 都能无条件压过正文”。

### 原则 4：保留 route，但让 route 控制护栏阈值

route 不再只是“完全不同排序哲学”，而更像“哪类证据更早发声”的模板：

- `body-first`
  - 正文 witness 最容易提前介入
- `body-with-anchor`
  - strong metadata 和 body witness 都可以早介入
- `metadata-first`
  - metadata 默认优先，但 body witness 仍保留有限翻盘通道

## 推荐实现方向

## Phase 0：基准锚点与护栏样本冻结

执行前先重新跑一轮 benchmark，作为本轮 refinement 的锚点。

保留上一轮 baseline，同时新增一个“quality witness guardrail”观察面板，至少固定追踪这些 query：

- `config data rollout`
- `config data roll`
- `legacy wiki links after project rename`
- `cache restore after outage replay steps`
- `pod mounts token and secret together`

每个 query 记录：

- 目标文档路径
- 变更前 top 10 排名
- 目标文档的 rank
- 排在它前面的 competing docs
- competing docs 是靠 metadata 领先还是靠 body 领先

如果这一轮改动后 benchmark 回退，需要先看这些 guardrail case：

- 若 guardrail 变好、整体 benchmark 轻微下降，再判断 benchmark 是否覆盖不足
- 若 guardrail 和总体 benchmark 一起变差，则优先视为排序语义有问题

## Phase 1：新增显式 Body Quality Witness 摘要层

在 [coverage-lexical-types.ts](/C:/Users/alex/Documents/Test-Vault/.obsidian/plugins/obsidian-clever-search/src/services/search/coverage-lexical/coverage-lexical-types.ts) 新增一个摘要结构，推荐命名：

`CoverageLexicalBodyQualityWitnessSignal`

建议字段如下：

- `exactBodyFamilyCount`
  - 正文里以 exact 方式命中的 family 数
- `orderedCorePairCount`
  - 正文局部窗口中按顺序出现的核心 pair 数
- `exactPhraseCoverageCount`
  - 与 query phrase signature 对齐的覆盖数
- `compactWitnessWindowScore`
  - 由主窗口紧凑度和覆盖度组合出的 witness 分数
- `dominantBodyWitnessScore`
  - 一个归一化后的总 witness 分，用于前置护栏判断

说明：

- 这里不是要引入全新信息源
- 优先从现有信号派生
- 如果现有信号不够，再补最小必需的中间计数

优先复用的数据来源：

- `coreBody`
- `localEvidence.primary`
- `localEvidence.support`
- `phraseBridgeCount`
- `metadataIdentity.phraseCoverageCount`

不建议第一版就引入额外复杂特征，如：

- 新的全文扫描
- 新的 recall lane
- 大量 planner explain 级推断

## Phase 2：在 signal 构建阶段统一生成 witness

在 [coverage-lexical-engine.ts](/C:/Users/alex/Documents/Test-Vault/.obsidian/plugins/obsidian-clever-search/src/services/search/coverage-lexical/coverage-lexical-engine.ts) 的 signal 构建阶段完成 witness 派生，要求：

- witness 必须和现有 `familyCountSummary` 一起构建
- witness 的各字段尽量来自已有局部窗口与 exact/prefix/fuzzy 统计
- 生成逻辑要是纯函数，便于单测

建议拆一个专门 helper，例如：

- `buildBodyQualityWitnessSignal(...)`

该 helper 的职责：

- 汇总 exact body family 的覆盖强度
- 汇总主局部窗口的顺序与紧凑性
- 形成可比较的 witness summary

这一阶段先不改 comparator，只补结构和构建测试。

## Phase 3：把 comparator 拆成三层，而不是一个长前缀

当前排序大致是：

1. total count
2. route-specific count prefix
3. detail comparator

下一轮建议改成：

1. `totalMatchedFamilyCount`
2. route-aware early guardrail stage
3. metadata/body count stage
4. route-specific detail stage

其中第二层是新增的关键层。

### 3.1 Early Guardrail Stage

目标是判断：

“右边虽然 metadata count 更强，但左边是否已经拿出了足够强的正文 witness，以至于不应继续被 broad metadata 压制？”

建议提供一个显式 comparator，例如：

- `compareEarlyQualityGuardrails(left, right, plan)`

推荐语义：

- `body-first`
  - body witness 可以早于全部 metadata count 介入
- `body-with-anchor`
  - body witness 可以早于 `folder/headings/tags` 介入，但通常不应轻易压过强 `basename/aliases`
- `metadata-first`
  - body witness 只在“明显强于对手”时介入，且优先只压过 broad metadata，不轻易压过强 `basename/aliases`

### 3.2 Metadata / Body Count Stage

这一层不再是一条完全线性的 metadata count 链，而是建议改成：

- `strong metadata count`
  - `basenameMatchedFamilyCount`
  - `aliasesMatchedFamilyCount`
- `bodyMatchedFamilyCount`
- `broad metadata count`
  - `folderMatchedFamilyCount`
  - `headingsMatchedFamilyCount`
  - `tagsMatchedFamilyCount`

推荐的默认顺序：

- `totalMatchedFamilyCount`
- early guardrail stage
- `metadataMatchedFamilyCount`
- `basenameMatchedFamilyCount`
- `aliasesMatchedFamilyCount`
- `bodyMatchedFamilyCount`
- `folderMatchedFamilyCount`
- `headingsMatchedFamilyCount`
- `tagsMatchedFamilyCount`

这不是最终唯一方案，但它比“把 body count 一直放到最后”更符合当前 benchmark 暴露的问题。

### 3.3 Route-Specific Detail Stage

detail comparator 仍保留，但需要把一部分最强的 witness 逻辑前移到 early guardrail stage。

保留在 detail stage 的内容：

- 细粒度 exact/prefix/fuzzy 比较
- char comparator
- phrase bridge 余量比较
- local window 的剩余 tie-break
- tail weight

也就是说，下一轮不是删除 detail stage，而是把其中最能代表“像答案”的部分前移。

## Phase 4：明确 witness 的翻盘边界

这一步非常重要，否则 comparator 会变得不可解释。

建议把翻盘规则写成显式约束：

- 强 `basename/aliases` 优势，不能被轻微 body witness 轻易翻盘
- `folder/headings/tags` 优势，可以被明显更强的 body witness 翻盘
- 若双方 metadata 强度接近，而一方正文 witness 明显更强，则正文一方应赢
- 若双方正文 witness 都弱，则回退到 metadata/body count 决策

可以把这个约束实现成阈值或门槛判断，例如：

- dominant body witness 必须超过对手一定差值
- 只有当对手的 metadata 优势主要来自 `folder/headings/tags` 时，witness 才能提前接管

第一版不追求数学最优，追求规则可解释、可测试。

## Phase 5：新增分层测试，不只测最终排序结果

在 [coverage-lexical-ranking.test.ts](/C:/Users/alex/Documents/Test-Vault/.obsidian/plugins/obsidian-clever-search/tests/src/services/search/coverage-lexical-ranking.test.ts) 增补四类测试。

### 5.1 纯 comparator 单测

直接构造 signal，验证：

- strong metadata 仍能压过普通 body
- 强 body witness 能压过 broad metadata
- `metadata-first` route 下，body witness 只有明显领先时才能翻盘
- `body-with-anchor` route 下，body witness 可以在 `folder/headings/tags` 之前介入

### 5.2 Guardrail 样本单测

把 benchmark 里的关键对照缩成小样本测试：

- `exact-quality-witness` 对 `exact-quality-loose`
- `wikilink-drift` 对 `project-rename-map` 和 `old-project-index`
- `cache-restore-checklist` 对 `cache-replay-runbook`

这些测试要能直接表达：

- 哪篇是 metadata 更强
- 哪篇是 body quality 更强
- comparator 最终为什么应该这样判

### 5.3 Route 差异测试

同一组成的 signal，在不同 route 下应当有不同结果：

- `body-first`
- `body-with-anchor`
- `metadata-first`

这样可以防止我们“名义上保留 route，实际上已经抹平”。

### 5.4 真实 benchmark 回归

除了现有 benchmark，再新增一个轻量 guardrail suite，作为开发期快速回归：

- 用极少数固定 query
- 快速输出目标文档 rank
- 失败时直接告诉我们是 body witness 被 metadata count 压住了，还是相反

## Phase 6：Benchmark 评估规则

实施后必须重跑：

- coverage lexical ranking tests
- recall suite
- planner tests
- search-service bootstrap
- coverage lexical benchmark

评估顺序建议是：

1. 先看 recall 是否保持
2. 再看 guardrail case 是否修复
3. 再看整体 benchmark 指标
4. 最后看是否引入新的 file-lookup 回退

判断标准：

- 如果 `quality_guardrail`、`mixed_anchor`、`body_path_anchor` 明显恢复，同时 file-lookup 类 case 不退化，可以接受小幅整体波动
- 如果 `basename` 主导的真实文件查找明显退化，则说明 guardrail 太激进
- 如果 `folder/headings/tags` 相关 query 提升明显，但正文答案型 query 继续下滑，则说明 witness 还不够早或不够强

## 推荐的最小落地顺序

为了降低风险，这一轮建议按下面顺序执行，而不是一次性混改：

1. 新增 `CoverageLexicalBodyQualityWitnessSignal`
2. 在 engine 中构建 witness summary，但暂不改排序
3. 先补纯 signal / comparator 单测
4. 加入 early guardrail stage
5. 只把 `bodyMatchedFamilyCount` 提前到 `folder/headings/tags` 之前
6. 跑 benchmark
7. 如仍有问题，再调 witness 阈值，而不是继续堆新信号

这样做的好处是：

- 每一步都能单独验证
- 便于判断问题来自 signal 定义、guardrail 逻辑，还是 count 顺序
- 不会把 planner、recall、ranker 三个层面同时搅乱

## 架构层面的建议

这一轮不需要大改搜索架构，但需要把排序架构整理得更自然一点。

推荐把 ranker 从“按 route 写三段长 comparator”收束成下面的结构：

- shared count comparator
- early quality guardrail comparator
- route policy comparator
- fallback detail comparator

这样 route 的职责会更清晰：

- 决定哪些证据可以更早发声
- 决定 body witness 的翻盘阈值
- 决定 strong metadata 与 body witness 冲突时谁优先

而不是让 route 既控制 count 前缀，又控制 detail 顺序，最后很难解释。

## 交付物

- 一份新的 refinement 设计文档
- `CoverageLexicalBodyQualityWitnessSignal` 类型
- witness 构建 helper
- early guardrail comparator
- 分层 comparator 单测
- benchmark guardrail 评估记录

## 完成标准

完成这一轮，不要求所有 benchmark 指标绝对最优，但至少要满足：

- `quality_guardrail` 不再明显退化
- `mixed_anchor` 和 `body_path_anchor` 至少部分恢复
- basename / folder 文件查找语义不被破坏
- recall 不下降
- comparator 规则可以用清晰语言解释，不依赖“碰巧调参”
