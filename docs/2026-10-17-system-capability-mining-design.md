# 系统功能挖掘 · 详细设计档案

> **版本**：v1.1 · 2026-10-17（WorkBuddy 审查后修订）
> **状态**：设计定稿，待 S1 样张验证
> **修订记录**：
> - v1.0：初稿
> - v1.1：P0-1 queries 移入正文 fenced 块（frontmatter 承载不了自定义字段）；P0-2 tags 先用 concept 不发明新词；P1-3 UI 改动面补全为 5 处 + scope 改名 capability；P1-4 动态探测降级为构建期常量；P1-5 段① 自实现不依赖外部 CLI；P2 五条措辞对齐
> **归属**：dsh-knj-obsidian 插件的第五个 ingest 通道
> **前置**：[DeepWiki-Open 方法考古](../../references/deepwiki-open-方法考古-代码逆向为-wiki-的提示词与工程配置.md) · SDD 三件套分析 · llm-wiki 理论底座

---

## 目录

1. [目标与定位](#1-目标与定位)
2. [架构总览](#2-架构总览)
3. [能力页 Schema](#3-能力页-schema)
4. [入口枚举器](#4-入口枚举器)
5. [三段管线](#5-三段管线)
6. [任务状态机与断点续传](#6-任务状态机与断点续传)
7. [四条不变量（I1–I4）](#7-四条不变量i1i4)
8. [增量与变化管理](#8-增量与变化管理)
9. [上下文管理策略](#9-上下文管理策略)
10. [UI 接入](#10-ui-接入)
11. [工程实施计划](#11-工程实施计划)
12. [验收标准](#12-验收标准)
13. [来源与致谢](#13-来源与致谢)

---

## 1. 目标与定位

### 1.1 解决什么问题

把一个工作区代码库转换成**通用知识库**——让 agent 和人**既能回答问题，也能定位改动**。这是软件的「认知层」，不是「改动说明书」。

两种消费场景同等重要：

| 场景 | 典型问题 | 页面需要提供 |
|---|---|---|
| **问答**（主） | 「知识检索是怎么实现的？」「语义双通道怎么融合？」「为什么兜底门是 2 不是 3？」 | 它是什么 / 工作原理 / 关键设计决策 / 常见陷阱 |
| **改动** | 「我要改打分权重，改哪？」「删了 wiki_drill 会断什么？」 | 入口 / 模块与符号 / 行号 / 影响面 |

能力页按**问答优先**组织，改动信息作为其中几节——而不是反过来。

### 1.2 不解决什么

- ❌ 不做使用文档 / 教程（那是 `skills/` 的职责）
- ❌ 不做 API 参考（那是 `references/` 的职责）
- ❌ 不替代 code-understand / code-review（那是读侧工具）
- ❌ 不做符号级页面（粒度爆炸，[pemographer 类方案的反面教材](#13-来源与致谢)）
- ❌ **不是"改动说明书"**——改动定位只是它的一种用法

### 1.3 产出物

| 产物 | 位置 | 读者 | 生成方式 |
|---|---|---|---|
| **能力页**（一页一个功能） | `projects/capability-<名>.md` | agent（迭代前读） | 挖掘管线 |
| **index.md 目录树** | `.wiki/index.md`（既有） | 人（快速定位） | **从能力页自动汇总** |
| **挖掘状态文件** | `.wiki/_system/capability-mining/` | 管线自身 | 脚本维护 |
| **manifest 反向索引** | `.wiki/_system/capability-mining/manifest.yml` | 增量检测用 | 脚本维护 |

**关键决策**：只写能力页一份正文；index.md 是能力页的自动视图（零额外成本、零漂移风险）。

### 1.4 三层知识结构

```
第 1 层  projects/capability-*.md       功能索引（改这个功能看这里）
第 2 层  concepts/ / references/ / ...   结论与踩坑（既有页，会话蒸馏继续产出）
第 3 层  Sources: 路径:行               代码证据（点开就能改）
```

能力页是**索引层**：它自己不承载长结论，而是告诉你「改这里会碰到哪些知识、哪些代码、哪些坑」——结论仍然沉淀回 concepts/。第 2 层沉淀踩坑与原理，第 3 层提供精确定位。

---

## 2. 架构总览

### 2.1 三个来源的融合

```
┌─ 运营层（怎么跑完）─────────── 来源：SDD 三件套 ────┐
│  入口枚举确定化（路由/Controller/注册面）               │
│  线索导航 = 任务清单（可数、可对账、可断点续传）           │
│  状态机 + 超时重试 + 每轮节流 + 上下文六策略              │
└────────────────────────────────────────────┘
┌─ 证据层（怎么让产物可信）───── 来源：DeepWiki-Open ──┐
│  Sources: 路径:起-止 行级引用                           │
│  <details> 源文件块（≥5 个文件）                        │
│  Mermaid 全竖排 graph TD                               │
│  ⚠️ 堵死假引用：声明源 ⊆ 实际读过的源                     │
└────────────────────────────────────────────┘
┌─ 治理层（怎么让产物不过期）── 来源：llm-wiki + 本插件 ─┐
│  confidence + lifecycle（draft→reviewed→verified）      │
│  ^[inferred] 推断标记                                   │
│  manifest 反向索引 → 三级检测 → 四级路由                  │
│  [[wikilink]] 图谱 + tier（core/supporting/peripheral）  │
│  I1 引用密度 / I2 连通 / I3 自检索 / I4 漂移              │
│  queries: 问法捕获 → 任务语言可发现                       │
└────────────────────────────────────────────┘
```

### 2.2 系统位置

```
现有四个 ingest 通道：
  ① wiki-ingest   （文档/URL → 知识页）
  ② wiki-capture  （会话讨论 → 知识页）
  ③ wiki-collect  （枚举/表结构 → 结构页）  ← 确定性 miner
  ④ wiki-distill  （会话归档 → 知识页）

新增第五个：
  ⑤ wiki-capability-mining（代码 → 功能索引页）  ← 本设计
```

### 2.3 与既有系统的关系

| 既有能力 | 本设计如何复用 |
|---|---|
| `wiki_ingest` 工具 | 能力页最终经 `wiki_ingest` 入库 |
| `wiki_checkpoint` | 批次纪律第一步：入库前先建还原点 |
| `wiki_query` / `wiki_drill` | 检索能力页（I3 自检索用） |
| `wiki_lint` | I1–I4 不变量挂进 lint 或独立检查器 |
| `indexOnly` 快速层 | index.md 自动汇总走既有构建器 |
| `BATCH_DISCIPLINE` | 启动器触发指令直接复用 |

---

## 3. 能力页 Schema

### 3.1 Frontmatter

```yaml
---
title: 知识检索                          # 必填：功能的中文简称
category: projects                       # 固定为 projects
tags: [concept]                          # P0-2 修正：先用词表已有词，不发明 capability 新词
tier: core                               # core / supporting / peripheral
confidence: inferred                     # 功能页是推断产物，默认 inferred
source: capability-mining:v2026.10.172   # 来源标记（版本号）
summary: 一句话说清这个功能由哪些入口与模块组成  # ≤120 字，index.md 汇总用（flatField 单行化）
created: 2026-10-17T…                    # wiki_ingest 自动写入
updated: 2026-10-17T…                    # 同上
---
```

### 3.2 正文十段式（问答优先，改动作附加）

```markdown
<details><summary>Relevant source files</summary>

- [src/tools.ts](src/tools.ts)
- …（≥5 个）

</details>

## 它是什么
（1–2 段：这个功能是什么、为什么存在、边界在哪——**问答场景的主入口**）

## 工作原理
（数据流/调用链：请求怎么进、经过哪些阶段、产出什么）
（mermaid graph TD 在这里——**问答最常被问的就是"怎么走的"**）

## 入口与触发面
（表格：入口名 | 必填参数 | 何时该用 | 底层内核——**问答问"怎么用"与改动问"从哪进"共用**）

## 组成模块与职责
（表格：文件 | 职责 | 关键符号——**问答问"这个行为在哪实现"用**）

## 关键设计决策
（为什么这么做：[[decision 页]] / 取舍 / 曾经踩过的路——**问答深水区**）

## 数据与结构依赖
（[[wikilink]] 到 tables/ / dictionaries/ / 相关结论页）

## 常见陷阱
（[[pitfall 页链接]]：这里容易错在哪、历史事故——**问答问"为什么这么写"用**）

## 改动提示
（改这里要注意什么 + 影响面「谁调用了这些符号」——**改动场景专用**）

## 行为证据
（关键测试断言：测试文件名 + 断言内容——问答问"怎么验证的"、改动怕破坏时用）

## 关联功能
（[[capability-xxx]] 互相连接；暂无则省略此节）

## 任务问法
（**问答式 + 任务式都要收**：既问"怎么实现的"，也问"改哪里"）

```queries
知识检索是怎么实现的
语义双通道怎么融合的
为什么兜底门是 2 不是 3
改检索排序 / 调打分权重
检索结果串了别的库
```

## Sources
- `src/tools.ts:724-773`（…）
- …
```

**核心变化（相对 v1.0）**：`## 工作原理` 从"调用链/数据流"升格为独立主节并前移；`## 关键设计决策` 新增（回答"为什么"）；`## 常见陷阱` 与 `## 改动提示` 拆开（前者是知识，后者是操作）。

```sources
[
  {"path":"src/tools.ts","hash":"sha256:…","symbols":["wiki_query","SEMANTIC_FALLBACK_MIN_CANDIDATES"]},
  {"path":"src/retriever.ts","hash":"sha256:…","symbols":["retrieve","frontMatch","MATCH_SCORE"]},
  {"path":"src/semantic-index.ts","hash":"sha256:…","symbols":["collectionIdOf","runOfflineSearch"]},
  {"path":"src/semantic-hits.ts","hash":"sha256:…","symbols":["semanticRuntimeFor"]},
  {"path":"src/drill.ts","hash":"sha256:…","symbols":["drillQuery","fuseSeedRanks"]}
]
```
```

### 3.3 正文内 fenced 块设计（queries 与 sources 同构）

**为什么不放 frontmatter**：`wiki_ingest` 的 `pages` 入参 schema 是 `additionalProperties: false`（tools.ts:252），**没有 `queries` 字段**；`writePage()` 整份重建 frontmatter、只写固定 11 键（vault-store.ts），**任何额外键在下次写入时静默消失**；且 `flatField()` 会把多行值拍平为单行。→ frontmatter 承载不了自定义字段。

**解法**：与 `sources` 指纹块同构——用正文 ` ``` ` fenced code block 承载，零 schema 变更，lint / 检索侧按需解析。

**两个 fenced 块**：

| 块名 | 位置 | 内容 | 消费者 |
|---|---|---|---|
| ```` ```queries ```` | 正文末尾（Sources 之前） | 每行一条任务问法 | I3 自检索（与标题一起作为检索目标） |
| ```` ```sources ```` | 正文末尾（最末） | JSON：path + hash + symbols | I4 漂移检测（check-drift.mjs） |

**sources 字段**：

| 字段 | 类型 | 用途 |
|---|---|---|
| `path` | string | 仓库相对路径（正斜杠） |
| `hash` | string | 文件 SHA-256（挖掘时计算） |
| `symbols` | string[] | 该页声明的关键符号名（用于二级核对） |

### 3.4 抄改拒清单

| 决定 | 来源 | 依据 |
|---|---|---|
| **抄** `<details>` 源文件块 ≥5 文件 | DeepWiki | Obsidian 原生渲染；后处理可重建 |
| **抄** `Sources: 路径:起-止` 行级引用 | DeepWiki | agent 可直接 read 到那段代码 |
| **抄** Mermaid 全竖排 `graph TD` | DeepWiki | 大规模验证的约束 |
| **抄** 九段式骨架 | DeepWiki | 结构可预期、可 lint |
| **改** 交叉链接 → `[[wikilink]]` | 本地 | Obsidian 的本命；图谱与反链 |
| **改** 结构来源 → 代码关系驱动 | 本地 | DeepWiki 用 file_tree 猜是弱点 |
| **改** 引用链接 → 纯文本 `路径:行` | 本地 | 无 web 主机，不拼 URL |
| **增** 「改动提示」节 | 本地 | 直接服务迭代目标 |
| **增** 「行为证据」节 | 本地 | 测试断言 = 功能契约 |
| **增** 「工作原理」独立主节 + 「关键设计决策」节 | 本地 | 通用知识库的问答主场景 |
| **增** 「任务问法」节（queries fenced 块） | 本地 | 同时收问答式与任务式问法；解决改写式查询 2/10 短板 |
| **增** `sources` 指纹块 | 本地 | 漂移检测的载体 |
| **拒** 一符号一页 / 一文件一节 | — | 粒度爆炸 |
| **拒** 整库重蒸 | — | 增量对账更先进 |
| **拒** `graph LR` | DeepWiki | 它自己 wiki 页提示词禁 LR，codemap 却允许——不一致 |

### 3.5 P2 级勘误（WorkBuddy 审查后修订）

| 项 | 勘误前 | 勘误后 |
|---|---|---|
| WikiPage 字段数 | "固定 9 字段" | **9 必填 + summary/tier 2 可选**（types.ts:20-42） |
| wiki_search_semantic 行号 | tools.ts:1148 | **tools.ts:1121**（实测） |
| frontMatch | 未注明可见性 | **私有函数**（retriever.ts:310，未导出）——grep 级核对可用，AST 导出级会漏 |
| I4 的 lint 侧数据流 | 未说明 | I4 挂在 `check-drift.mjs`（脚本自有 project_root），**不挂 wiki_lint**（lint 只面对 vault，无代码仓库根） |
| index.md 分节 | 未说明 | 能力页会混进 `projects` 节与其它 projects 页并列；如需独立「功能索引」节，在 SECTION_TITLES 加一项（可选） |

---

## 4. 入口枚举器

### 4.1 功能边界的来源

**功能边界由代码事实决定，不由模型直觉决定**（DeepWiki 的核心弱点：用 file_tree+README 猜）。

### 4.2 三类适配器

| 适配器 | 扫什么 | 适用场景 |
|---|---|---|
| **前端路由** | `router/index.ts` / `router.ts` 中的路由配置（path、name、component） | Vue/React/Angular SPA |
| **后端 Controller** | `@RequestMapping` / `@GetMapping` 等注解方法 | Java Spring |
| **进程内注册面** | 工具注册（`ctx.tools.register`）、HTTP 路由（`webServer.register`）、宿主钩子（`ctx.on`）、`bin` 命令 | DSH 插件 / Node 进程 |

本仓库属第三类。适配器的职责是**产出一份入口清单**（确定性输出，非 LLM 生成）：

```yaml
# .wiki/_system/capability-mining/entries.yml
tools:
  - name: wiki_query
    file: src/tools.ts
    line: 724
  - name: wiki_search_semantic
    file: src/tools.ts
    line: 1148
  ...
routes:
  - path: /api/obsidian-wiki/search
    file: src/routes.ts
    line: 210
  ...
hooks:
  - event: agent/session-start
    file: src/trigger.ts
    line: 1396
  ...
```

### 4.3 功能候选聚类

入口清单到手后，按「文件 + 符号调用关系」聚成功能簇：

```
wiki_query + wiki_search_semantic + wiki_drill + wiki_read + GET /search
  → 都指向 src/tools.ts / src/retriever.ts / src/semantic-index.ts
  → 聚成功能「知识检索」

wiki_ingest + wiki_capture + wiki_normalize_tags + POST /import
  → 都指向 src/tools.ts / src/importer.ts
  → 聚成功能「知识写入」

agent/session-start + agent/pre-step + agent/turn-stopping + tools/pre-execute
  → 都指向 src/trigger.ts
  → 聚成功能「主动触发」
```

聚类可以由 agent 做（读入口清单 + 调用关系，判断哪些入口属于同一个功能），但**入口清单本身是确定性的**。

### 4.4 线索导航（中间产物）

每个功能产出一个 YAML 骨架文件（对标 SDD 的「源代码线索导航」）：

```yaml
# .wiki/_system/capability-mining/clue-知识检索.yml
overview:
  function_name: 知识检索
  entries:
    - type: tool
      name: wiki_query
      file: src/tools.ts
      line: 724
    - type: route
      path: /api/obsidian-wiki/search
      file: src/routes.ts
      line: 210
  modules:
    - file: src/tools.ts
      symbols: [wiki_query, SEMANTIC_FALLBACK_MIN_CANDIDATES]
    - file: src/retriever.ts
      symbols: [retrieve, frontMatch, MATCH_SCORE]
    - file: src/semantic-index.ts
      symbols: [collectionIdOf, runOfflineSearch]
    - file: src/semantic-hits.ts
      symbols: [semanticRuntimeFor]
    - file: src/drill.ts
      symbols: [drillQuery, fuseSeedRanks]
  related_pages:
    - "qmd-全局索引库的跨库噪声与两道防线"
    - "语义融合会顶掉正确的词面-top1"
```

**纪律**：线索导航落盘（可审计、可 diff、可断点恢复），正文从它生成。**线索导航里的文件与符号列表 = 任务清单**，一个功能一个任务，严禁合并/遗漏/编造。

---

## 5. 三段管线

### 5.1 段① 结构——候选文件集 + 焦点地图

| 项 | 内容 |
|---|---|
| **工具** | **`enumerate-entries.mjs` 自实现**（P1-5 修订：不依赖外部 `obsidian-wiki` CLI——它在 Python Scripts 目录、不在本仓库 package.json、版本未锁定，换机即断。入口扫描是确定性 grep/AST，自实现成本低于引入外部依赖） |
| **可选增强** | `obsidian-wiki code-understand`（本机已验可用的 Python CLI）——**有则用、无则跳过**，不是管线依赖；装上后可提供跨文件引用证据 |
| **排除清单** | node_modules/dist/build/target/vendor/.git/锁文件/压缩产物（参照 DeepWiki 的 repo.json，但**自己实现 glob**——它那版精确匹配导致 `*.min.js` 等条目永远无效） |
| **保留测试文件** | ✅（反用 DeepWiki 的 `is_implementation` 启发式——测试断言是功能契约，是行为证据的最硬来源） |
| **输出** | 焦点地图：承重文件/符号 + `file:line` 引用 + 依赖关系 |

### 5.2 段② 关系——功能候选清单

| 项 | 内容 |
|---|---|
| **输入** | 焦点地图 + 入口清单（entries.yml） |
| **操作** | 按文件 + 符号调用关系将入口聚成功能簇 |
| **辅助** | 本地图引擎 `buildGraph`（页面 wikilink 图）+ code-understand 的跨文件引用 |
| **限制** | `rg` 与 `codegraph` 本机未装，跨文件引用证据偏弱；装上可增强 |
| **输出** | 线索导航文件（每功能一个 `.yml`） |

### 5.3 段③ 聚合——逐页两阶段生成

**两阶段**（来源：DeepWiki 的 CODEMAP_SKELETON → ENRICH 范式）：

| 阶段 | 产出 | 关键纪律 |
|---|---|---|
| **骨架阶段** | JSON 结构：每节含 `citation = {file_path, start_line, end_line, snippet(verbatim)}` | ① snippet 必须是逐字子串（不允许改写）② 信息不足宁可少写一节，不编造 ③ `sources` 指纹在此阶段锁定 |
| **填充阶段** | 正文：九段式 prose + mermaid 图 + wikilink | ① 只填 prose 与图，**不许增删骨架的节与引用** ② mermaid 全竖排 |

**行号核对**：落盘前由工具（grep / AST 定位）核对每个 `Sources: 路径:行` 的行号，**LLM 不得凭记忆写行号**（实测：隔几轮编辑，4 个锚点行号全偏）。

---

## 6. 任务状态机与断点续传

### 6.1 状态文件

```yaml
# .wiki/_system/capability-mining/tasks.yml
meta:
  version: "1.0"
  project_root: "D:/dsh-knj/dsh-knj-obsidian"
  last_mining_commit: "46b69b6"
  generated_at: "2026-10-17 14:00:00"

tasks:
  - index: 1
    function_name: 知识检索
    status: 挖掘完成          # 待挖掘 | 挖掘中 | 挖掘完成 | 挖掘失败 | retired
    attempt_count: 1
    start_time: "2026-10-17 14:00:00"
    end_time: "2026-10-17 14:03:00"
    page_id: capability-知识检索
    retry_count: 0
```

### 6.2 状态机规则（照抄 SDD）

| 规则 | 值 | 依据 |
|---|---|---|
| 超时阈值 | **10 分钟**（单任务） | SDD wiki-bootstrap 的实测值 |
| 超时处置 | 重置为 `待挖掘`，`attempt_count + 1` | SDD 4.1 |
| 最大重试 | **3 次**，超后标 `挖掘失败` | SDD 4.1 |
| 每轮节流 | **≤5 个任务** | SDD indexmd 的显式节流 |
| 执行模式 | **严格串行**，禁止并行 | SDD 的核心原则 |
| 路径铁律 | 所有文件必须在 `_system/capability-mining/` 或 `projects/` 内 | SDD 的防跑偏 |

### 6.3 断点续传流程

```
读取 tasks.yml → 超时重置检查 → 取下一个 待挖掘 任务
→ 更新状态为 挖掘中（记录 start_time、attempt_count+1）
→ 创建线索导航（如不存在）
→ 段③ 聚合（骨架 → 填充 → 行号核对 → lint）
→ 更新状态为 挖掘完成（记录 end_time、page_id）
→ 处理下一个任务
```

中断恢复：下次执行时，`挖掘中` 超过 10 分钟的任务自动重置为 `待挖掘`。

---

## 7. 四条不变量（I1–I4）

### 7.1 定义

| # | 不变量 | 判据 | 不合格处置 |
|---|---|---|---|
| **I1** | **引用密度** | 正文 ≥5 条 `路径:行` 引用，且覆盖 ≥3 个不同文件 | **不入库**（最严） |
| **I2** | **连通性** | ≥2 个 `[[wikilink]]` 指向既有页（优先 pitfall / concept） | 黄牌：孤岛页 |
| **I3** | **可发现性** | 用页面标题自检索必须 **Top1**；用 `queries` 块中任一短语自检索必须进 **Top5**（S1 判据）→ S2 检索侧消费 queries 块后收紧为 Top1 | 黄牌：找不到 = 白写 |
| **I4** | **新鲜度** | `sources` 指纹中任一文件的 hash 变了 → 标 `stale` | 黄牌：该功能需重新检查 |

**I3 判据的修订理由（S1 实测）**：能力页是**索引层**，不该抢概念页的召回——实测「语义双通道怎么融合的」的 Top1 是 `语义融合会顶掉正确的词面-top1`（**这是正确的**，那页专门讲这个）。硬要能力页 Top1 等于要求索引层压过知识层，方向就错了。故：
- 标题自检索 → **Top1**（能力页必须能被自己的名字找到）
- queries 短语 → **Top5**（保证它在候选里，agent 能看到并点进去）
- S2 检索侧把 queries 块并入标题层匹配（类似 aliases）后，再收紧到 Top1

### 7.2 实现方式

- **I1**：lint 解析正文，正则提取 `路径:数字` 或 `路径:数字-数字` 模式，计数 + 去重文件
- **I2**：lint 解析 `[[wikilink]]`，检查目标页是否已存在于库中
- **I3**：`retrieve(store, title)` 必须 Top1；`retrieve(store, queries[i])` 必须 Top5（S1）；S2 检索侧消费 queries 后收紧 Top1
- **I4**：读取 `sources` 指纹块，对每个 path 重算 SHA-256，与存储值比对

### 7.3 S1 实测的 I3 边界（重要）

S1 样张实测结果（2026-10-17）：

| 查询 | 排名 | 判据 | 结论 |
|---|---|---|---|
| 「知识检索」（标题） | **1** | Top1 | ✓ |
| 「知识检索是怎么实现的」 | **1** | Top5 | ✓ |
| 「语义双通道怎么融合的」 | 4 | Top5 | ✓（Top1 是 `语义融合会顶掉正确的词面-top1`，**合理**） |
| 「为什么兜底门是 2 不是 3」 | 4 | Top5 | ✓ |
| 「wiki_query 和 wiki_search_semantic 的区别」 | 5 | Top5 | ✓ |
| 「改检索排序 / 调打分权重」 | 8 | Top5 | ✗（任务式问法天然弱） |
| 「检索结果串了别的库」 | 8 | Top5 | ✗ |

**结论**：问答式问法 5/5 进 Top5；任务式问法（"改X"）2/2 进不去（第 8 名）。原因是任务意图与能力页的描述性正文天然不匹配，**必须靠检索侧消费 queries 块解决**——光把短语写进正文，bigram 会被稀释。

### 7.4 I3 的阶段化判据（S1 实测后定稿）

| 阶段 | 标题 | 问答式问法 | 任务式问法 | 依据 |
|---|---|---|---|---|
| **S1**（当前） | Top1 | **Top5** | 不判（记录基线） | 检索侧尚未消费 queries 块 |
| **S2**（检索侧接入后） | Top1 | Top3 | **Top5** | queries 并入标题层匹配（类似 aliases） |

**S1 验收线**：I1 全过 + I2 全过 + I3 标题 Top1 且问答式 ≥80% 进 Top5 + I4 骨架通过。

### 7.3 为什么不靠提示词

DeepWiki 的教训：它把「≥5 源文件 + Sources 引用」写在提示词里，**但最终保证在后处理代码**（`post_process_wiki_content` 用已知 `filePaths` 重建 `<details>` 块）。我们的 I1–I4 同理：**提示词给方向，lint 卡底线**。

---

## 8. 增量与变化管理

### 8.1 问题拆解

| 代码变什么 | 对能力页的影响 | 该做什么 | 成本 |
|---|---|---|---|
| 加注释/空行 | 行号偏移 | **只更新 sources 里的数字** | 秒级 |
| 函数内部逻辑改（签名不变） | 模块职责描述可能过时 | 更新正文对应段落 | 分钟级 |
| 函数改名/搬走/删了 | 模块表引用了不存在的符号 | 该节重写 | 分钟级 |
| 新工具/新路由注册 | 新功能或既有功能加入口 | 新建页 / 更新入口表 | 视规模 |
| 工具删了/路由去了 | 功能退役 | 标 `retired`，不删页 | 秒级 |
| 核心架构重构 | 功能边界本身变了 | **整页重挖**（只挖这一页） | 贵 |

### 8.2 三级变化检测（从便宜到贵）

#### 第一级：入口清单 diff（最便宜）

```
重新跑入口适配器 → diff 新旧 entries.yml
  新增入口 → 新功能候选 → 建新页
  消失入口 → 该功能 retired
  入口没变 → 进第二级
```

#### 第二级：符号级核对（精准判断「真变了还是只是偏了」）

```
文件 hash 变了 → grep 确认 symbols 还在不在
  ├─ 在，行号偏了 → 只更新行号（机械修正）
  ├─ 在但签名变了 → 标 stale:signatures-changed
  └─ 不在了 → 标 stale:symbol-removed
```

#### 第三级：git diff 集成

```powershell
git diff --name-only <上次挖掘commit>..HEAD
```

配 manifest 反向索引精确定位受影响页。

### 8.3 manifest 反向索引

```yaml
# .wiki/_system/capability-mining/manifest.yml
src/tools.ts:
  - capability-知识检索
  - capability-知识写入
  - capability-主动触发
src/retriever.ts:
  - capability-知识检索
src/trigger.ts:
  - capability-主动触发
last_mining_commit: 46b69b6
```

### 8.4 四级更新路由

| 处置 | 触发条件 | 动作 | 成本 |
|---|---|---|---|
| **行号修正** | 符号在、行号偏了 | 机械更新 sources 行号 | **秒级** |
| **局部更新** | 某模块符号变了但入口没变 | 只重读该模块文件，更新那一节 | **分钟级** |
| **整页重挖** | 入口变了 / 多模块符号消失 | 走完整管线（线索导航→骨架→正文），**只挖这一页** | 视规模 |
| **新建/退役** | 入口清单 diff 出新增/消失 | 新建 / 标 retired | 秒级判定 |

### 8.5 退役处置

入口消失 → `confidence` 改为 `ambiguous`，`summary` 注明「入口已移除 @ 日期」。**不删页**（历史仍有价值；如果将来入口回来了，页面还在）。

---

## 9. 上下文管理策略

来源：SDD 三件套的六策略，适配到本场景。

| 策略 | 本设计的做法 |
|---|---|
| **分模块独立挖掘** | 每个功能独立挖掘，完成一个再下一个（严格串行） |
| **分层读取** | 入口文件（tools.ts）→ 内核文件（retriever.ts）→ 支撑文件（semantic-*.ts），按线索导航的模块顺序 |
| **增量生成** | 先骨架（JSON 结构化）→ 再填充（prose + mermaid），两个阶段分开落盘 |
| **智能文件筛选** | 只读线索导航中声明的文件，不读全库 |
| **代码摘要提取** | 只提取函数签名/注册表/路由路径，不读完整实现（骨架阶段）；填充阶段按需选读 |
| **大模块拆分** | 单功能涉及 >10 个文件时，拆成「核心功能」+「扩展功能」两页 |

### 9.1 Windows 路径/编码纪律

来源：SDD indexmd-bootstrap 的实战教训 + 本仓库的 PowerShell 写坏 UTF-8 事故。

- 状态文件与线索导航用** Node 脚本**读写（UTF-8 无 BOM），**不用 PowerShell 的 Set-Content**
- 路径统一正斜杠（`/`），存储与比较时保持一致
- 递归枚举用 `os.scandir`（Node `fs.readdirSync` with `withFileTypes`），不用 shell glob

---

## 10. UI 接入

### 10.1 边栏蒸馏启动器

**Scope 值**：新增 `'capability'`，**不复用 `'both'`**（`'both'` 在既有 `buildCollectTrigger` 里的语义是"enum+db 合并采集"，复用会留下类型语义债）。

```typescript
export type DistillScope = 'enum' | 'db' | 'both' | 'capability' | 'sessions'
```

**需要改动的 5 处**（P1-3 修订，WorkBuddy 核出的完整清单）：

| # | 位置 | 行号（当前） | 改什么 |
|---|---|---|---|
| 1 | `SCOPE_LABELS` | 47–61 | 加 `{ value: 'capability', label: '系统功能挖掘', detail: '…' }` |
| 2 | `deliver()` 守卫 | 304–306 | 删 `if (scope === 'both') return` 守卫（或改为 `if (scope === 'capability')` 走新分支） |
| 3 | 分发逻辑 | 316 | 加 `else if (scope === 'capability') text = buildCapabilityTrigger(...)` |
| 4 | 预留 banner | 375–378 | 删掉（或改为 `scope === 'capability' && !skillAvailable` 的条件渲染） |
| 5 | 按钮 disabled | 457 / 462 | 去掉 `disabled={scope === 'both'}` 条件 |

**触发指令**（`buildCapabilityTrigger`）：

```typescript
function buildCapabilityTrigger(vaultRoot?: string | null): string {
  return [
    '请使用内置 wiki-capability skill 在当前工作区执行系统功能挖掘：',
    `范围：当前知识库根目录 ${vaultRoot ?? '(未知)'} 对应的代码仓库。`,
    '步骤：入口枚举（确定性）→ 线索导航 → 逐功能两阶段生成（骨架→填充）→ 行号核对 → lint → 入库。',
    '规则：每页 confidence=inferred、category=projects；tags 用词表已有词（S1 先用 concept）；',
    '  行号由工具核对、不得由模型凭记忆写；只引用实际读过的文件；保留测试文件。',
    BATCH_DISCIPLINE,
    '完成后按第 5 步格式输出质量评估报告。',
  ].join('\\n')
}
```

### 10.2 Skill 可用性：构建期常量（P1-4 修订）

WorkBuddy 指出 Launcher 是浏览器端组件，只经 HTTP 路由通信；skill registry 是宿主进程服务，没有暴露给客户端的路由——「动态探测」需要新增后端路由，改动面大。

**决策**：`wiki-capability` 随包分发（进 `SKILL_BUNDLE_DIRS`），**构建期保证在**——直接解锁 UI，不做动态探测。如果未来有"可选 skill"需求，再新增 `GET /api/obsidian-wiki/skills` 路由。

### 10.3 进度展示（可选增强）

功能页挖掘是长任务（多功能 × 每页分钟级），UI 应展示进度：

```
系统功能挖掘 [3/6]
  ✓ 知识检索       → capability-知识检索.md
  ✓ 知识写入       → capability-知识写入.md
  ✓ 主动触发       → capability-主动触发.md
  ○ 图谱与 UI      挖掘中…
  ○ 代码挖掘       待挖掘
  ○ 会话蒸馏       待挖掘
```

对标 DeepWiki 的 `WikiTaskSummary`（`pages_done / pages_total / current_page_ids`——进度是 schema 一等公民）。

---

## 11. 工程实施计划

### 11.1 三步走

| 步 | 内容 | 产出 | 验收 |
|---|---|---|---|
| **S1 样张** | 手写 1 页 `capability-知识检索`，严格按本 schema | 一页 + I1–I4 现场跑过 | 用户判断手感；四条不变量全过 |
| **S2 管线** | 入口适配器 + 线索导航生成 + 两阶段聚合 + lint + 状态机 | `wiki-capability` SKILL.md + 脚本 + UI 解锁 | 启动器能产出 ≥3 页 |
| **S3 增量** | manifest 反向索引 + 三级检测 + 四级路由 | 增量检测脚本 + lint 集成 | 改一行代码 → 秒级行号修正；删一个函数 → 标 stale |

### 11.2 文件清单（S2 全量，P1-4 修订后）

```
wiki-capability/                        # 新增：随包分发的 skill bundle
├─ SKILL.md                             # 三段管线指令 + 页面模板 + I1-I4 + 上下文策略
└─ templates/
   ├─ capability-template.md            # 九段式正文模板（含 queries 与 sources fenced 块）
   └─ clue-nav-template.yml             # 线索导航模板

src/
├─ client/KnowledgeDistillLauncher.tsx  # 改 5 处：scope 加 'capability'、去守卫、加分发、去 banner、去 disabled
├─ skill-provider.ts                    # 改：SKILL_BUNDLE_DIRS 加 'wiki-capability'
├─ tools.ts                             # 可选：注册 wiki_capability 工具
└─ package.json                         # 改：files 白名单加 'wiki-capability'

scripts/（或 wiki-capability/scripts/）
├─ enumerate-entries.mjs                # 入口适配器（自实现，不依赖外部 CLI）
├─ check-anchors.mjs                    # 行号核对（grep/AST 定位）
└─ check-drift.mjs                      # I4 漂移检测（hash + 符号核对）
```

---

## 12. 验收标准

### 12.1 用真实消费场景验收（不是用格式验收）

**场景 A｜问答（主）**

```
「知识检索是怎么实现的？」
→ wiki_query / wiki_drill 命中 capability-知识检索
→ 页内「工作原理」节回答了数据流，mermaid 图给出调用链
→ 「关键设计决策」解释为什么兜底门是 2
→ 「常见陷阱」指向 [[语义融合会顶掉正确的词面-top1]]
```

**场景 B｜改动（辅）**

```
「我要改语义检索的打分权重」
→ 命中 capability-知识检索
→ 「改动提示」给出 retriever.ts 的行区间与影响面
→ 「行为证据」列出 scored-retrieval.test.mjs 的关键断言
```

**两组都过不了，功能页写得再漂亮也算失败。**

### 12.2 用不变量验收

| 不变量 | 验收方法 |
|---|---|
| I1 引用密度 | 故意写一页缺引用 → lint 必须黄牌 |
| I2 连通性 | 写一页没有任何 wikilink → lint 必须黄牌 |
| I3 自检索 | 用页面标题搜 → 必须排第 1；用 queries 里的短语搜 → 必须排第 1 |
| I4 新鲜度 | 改一个源文件的一行 → 该页标 stale；改注释不改逻辑 → 只标行号修正 |

### 12.3 用增量场景验收

| 场景 | 预期 | 成本 |
|---|---|---|
| 在 `src/tools.ts` 前面加 5 行注释 | 4 个能力页标 `行号修正`，行号自动更新 | **< 5 秒** |
| 删除 `wiki_drill` 工具注册 | `capability-知识检索` 标 `stale:symbol-removed` | 秒级 |
| 新增一个工具 `wiki_foo` | 入口 diff 检出 → 新建 `capability-foo` 候选 | 秒级判定 |

---

## 13. 来源与致谢

| 来源 | 拿了什么 | 出处 |
|---|---|---|
| **DeepWiki-Open**（MIT, commit `d92819a`） | `<details>` 块、`Sources: path:line` 格式、Mermaid 竖排规则、九段式骨架、两阶段（骨架→填充）范式、排除清单参考 | `.wiki/references/deepwiki-open-方法考古-…` |
| **SDD 三件套**（本机 `~/.dsh/skills/SDD-project-understanding-*`） | 入口枚举确定化、线索导航=任务清单（可数可对账）、状态机+断点续传+超时重试、上下文六策略、路径铁律、Windows 编码纪律 | 本机安装目录 |
| **llm-wiki**（Karpathy 架构） | 三层分离（raw→wiki→schema）、provenance 标记（extracted/inferred/ambiguous）、生命周期（draft→reviewed→verified）、manifest 增量对账、tier 分层、检索原语分层 | `~/.agents/skills/llm-wiki/SKILL.md` |
| **本插件既有能力** | BATCH_DISCIPLINE、wiki_ingest 入库、wiki_lint 检查、wiki_checkpoint 还原点、自检索探针、enum/db 对账模式 | dsh-knj-obsidian v2026.10.172 |

**关键洞见的归属**：
- 「引用纪律要在代码里保证，不在提示词里」→ DeepWiki 的 `post_process_wiki_content` 设计
- 「功能边界由代码事实决定，不由模型直觉决定」→ SDD 的路由/Controller 枚举
- 「知识要有生命周期，不是一次性快照」→ llm-wiki 的 compiled artifact 理念
- 「行号不能由 LLM 凭记忆写」→ 本会话实测（隔几轮编辑 4 个锚点全偏）
- 「测试是行为证据，不该剔除」→ 反用 DeepWiki 的 `is_implementation` 启发式
