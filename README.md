# dsh-knj-obsidian

DSH（DeepSeek Harness）内简化版 Obsidian：为 AI agent 提供项目级知识库（wiki）的**构建**能力。agent 通过工具把对话、文档、网页等源材料蒸馏为结构化知识页，落盘到项目根目录的 `.wiki/`，形成可复用、可维护的知识资产。

当前版本为 **v1 构建核心 + v2 检索 + v3 图谱导出 + v4 UI + v5 笔记编辑**：写入侧（ingest / capture / lint）已完整；检索侧提供 `wiki_query` 工具与 `wiki-query` skill 双通道（见下文「v2：检索」）；图谱侧提供 `wiki_export` 工具导出交互图谱与结构化图数据（见下文「v3：图谱导出」）；UI 侧提供右侧边栏"知识库"标签 + 笔记/图谱工作台（见下文「v4：UI」）；v5 起笔记工作台支持富渲染、双链原地跳转、源码视图与全文编辑（见下文「v5：笔记编辑」）。

## 安装方式

> 需要 Node.js ≥ 20，且已安装 DSH 宿主（提供 `dsh` CLI 与 `web` profile）。

```bash
# 1. 在插件目录内打包
npm pack

# 2. 在插件目录内执行：安装到 DSH 的 web profile
dsh plugin --profile web add ./dsh-knj-obsidian-2026.9.301.tgz

# 3. 重启 DSH，确认宿主日志无 dsh-knj-obsidian 相关报错
```

安装后插件在 DSH 启动时自动向 agent 暴露工具（`wiki_ingest` / `wiki_capture` / `wiki_lint` / `wiki_query` / `wiki_export`），并随包分发 `wiki-query` skill，无需额外配置。

### 兼容的 DSH 版本

| 插件版本 | DSH 基线 | 说明 |
|---|---|---|
| `2026.9.201` 及更早 | `dsh-v0.1.1-rc.2` / `dsh-v0.1.2-rc.1` | peer 精确锁定 `0.1.2-rc.1`，在 `0.2.x` 宿主上会被安装前校验判定为不兼容 |
| **`2026.9.301`** | `dsh-v0.1.2-rc.1` ~ **`dsh-v0.2.0-rc.2`** | peer 改为双基线声明并把 0.2 分支收口到实测版本；在 `0.2.0-rc.2` 上完成 typecheck、构建、客户端打包与 354 项测试验证，另加 peer 范围双解析模式检查 |

`peerDependencies` 现在写作 **`^0.1.2-rc.1 || >=0.2.0-rc.1 <0.2.1-0`**。说明两件事：

- **为什么要有 `>=0.2.0-rc.1` 这一支**：它的 `[major,minor,patch]` 是 `0.2.0` **且自带预发布**，这正是 npm/pnpm 默认解析器接受 `0.2.0-rc.2` 的条件。写成单范围 `>=0.1.2-rc.1 <0.2.1-0` 能过宿主的组装期校验（那里用 `includePrerelease: true`），却会让 `dsh plugin add` 报 **ERESOLVE**。
- **为什么上界收口到 `<0.2.1-0`**：只声明实测过的 0.2 版本。`0.1.5 → 0.1.7` 曾一次性打断所有按 `0.1.5-alpha.1` 构建的插件，一路放行整个 0.2.x 是兑现不了的承诺；收口后若 0.2.1 出问题，会在组装期点名版本失败，而不是拖到运行期出现「不报错的怪症状」。
- `npm run test:peers` 用「宿主 gate」与「npm 默认解析」两种模式逐个断言受管 peer，并自带 `--selftest` 已知行为自校准，防止上面的坑回来。

侧边栏「知识库」标签依赖 **`dsh-better-sidebar`**（客户端 `dsh.client.inject: ["betterSidebar"]`）。
它不在本包依赖里，需要作为 profile 的直接依赖单独安装，且版本要与宿主同基线：

```bash
dsh plugin --profile web add dsh-better-sidebar@^0.24.1
```

> **它是硬依赖，不是可选项。** 客户端 bundle 的 `inject` 里声明了 `betterSidebar`，而 DSH 的客户端引导在
> 任何条目非 active 时都会直接抛错。缺它时的现场是：界面报 `Failed to load plugins`，控制台给出
> `web boot: 1 entry did not activate` + `dsh-knj-obsidian: pending (waiting for service: betterSidebar)`——
> 此时不只是「知识库」标签不出现，**整个客户端引导都会失败**。所以先装好 `dsh-better-sidebar` 再装本插件。
> 客户端加载器没有「可选注入」语法（`dsh.client.inject` 只接受字符串数组），因此无法在插件侧软化为可选。

### 从 Git 安装（`github:` 依赖）时的已知限制

本仓库的 `.gitignore` 忽略 `lib/`，且 `scripts` 里没有 `prepare` / `prepublishOnly` 钩子，而
`package.json` 的 `main` 指向 `lib/index.js`、`files` 又声明了 `lib`。结果是：**任何 `github:` 形式的安装
（`npm i github:<owner>/dsh-knj-obsidian`、profile 里的 git 依赖）
会得到一个没有入口文件的包**——插件随后加载失败，报错点与会看到的现象都不指向真正原因。

建议维护者二选一（我们这边为了立刻可用，是在一个附加分支上提交构建产物）：

1. 把 `lib/`（以及 `lib/types/`）移出 `.gitignore`，让仓库自带可运行产物；或
2. 在 `scripts` 里加 `"prepare": "npm run build && npm run build:client"`。
   注意 pnpm 11 默认会拦截依赖的构建脚本（`ERR_PNPM_IGNORED_BUILDS`），走这条路需要用户显式放行，
   所以从「开箱即用」看第 1 种更稳。

顺带一提：`npm publish` 也依赖同一份文件清单，没有 `prepublishOnly` 构建时同样会发出缺 `lib/` 的 tarball。

### 本地开发

```bash
npm install        # 需要 @deepseek-ai/dsh-* 的 0.2.0-rc.2 typings
npm run typecheck        # 宿主侧类型检查
npm run check:client     # 客户端类型检查
npm run build            # tsc → lib/
npm run build:client     # tsdown → client/client.js
npm test                 # 354 项测试（node --test）
npm run test:peers       # peer 范围双解析模式检查（含 --selftest 自校准）
npm run verify           # 以上全部
```

> `@tobilu/qmd` 是**可选 peer**（语义检索用）。未安装时 `wiki_search_semantic` 走「未就绪」分支，
> 且 `semantic-index.test.mjs` 中依赖真实库的那条用例会自动跳过（不再误报失败）。

## v1 能力

| 工具 | 作用 |
| --- | --- |
| `wiki_ingest` | 把 agent 提取好的知识页批量写入 wiki。入参 `pages`（id / title / category / tags / confidence / body）+ `source`（源材料标识）。同 id 页面自动合并正文（保留 `created`、更新 `updated`）；传入 `contentHash`（源内容 SHA-256）且与 manifest 记录一致时**整体跳过**，实现增量 ingest。 |
| `wiki_capture` | 把当前讨论快速沉淀为一条知识页（quick 模式，默认写入 `references/`，`confidence=inferred`），适合把对话结论即时落盘。 |
| `wiki_lint` | 健康度检查：孤儿页（入链或出链缺失的页面）、断链（`[[wikilink]]` 指向不存在页面）、缺 frontmatter。返回报告供 agent 自查或人工查看。 |

## `.wiki` 结构

知识库位于**项目根目录**的 `.wiki/`（由 `process.cwd()` 决定）：

```
.wiki/
├── index.md          # 维护的索引页
├── .manifest.json    # 源材料增量追踪（contentHash → 跳过重复 ingest）
├── _system/          # 会话归档、处理器与进度等内部运行数据（不参与知识检索）
├── concepts/         # 概念页
├── entities/         # 实体页
├── references/       # 参考资料
├── synthesis/        # 综合/跨主题结论
└── projects/         # 项目知识
```

每页为 Markdown + YAML frontmatter：

```markdown
---
id: kebab-case-stable-id
title: 页面标题
category: concepts
tags: [tag-a, tag-b]
source: 源材料标识
confidence: extracted|inferred|ambiguous
created: 2026-08-25T00:00:00.000Z
updated: 2026-08-25T00:00:00.000Z
---

markdown 正文（不含 frontmatter）
```

## v2：检索

v2 检索基于同一 `.wiki/` 知识库，提供**双通道**能力，均**只读**（不创建/修改任何页面）：

| 通道 | 触发方式 | 说明 |
| --- | --- | --- |
| `wiki_query` 工具 | agent 自动调用 | 内置于插件，DSH 启动即暴露。agent 被问到「我之前关于 X 踩过什么坑」「我了解 Y 吗」这类既有知识问题时自动调用它检索 `.wiki/`，再基于候选合成带引用的回答。 |
| `wiki-query` skill | 独立 skill（fallback） | 随包分发的 skill（`wiki-query/SKILL.md` + `references/retrieval-guide.md`）。在工具不可用/受限的环境里，agent 按该 skill 用 grep / glob / read 完成同等分层检索（通道对齐关系见下）。 |

### 分层检索策略

`wiki_query` 与 `wiki-query` skill 共用同一套从便宜到贵的分层层级（L1–L4），两者对 L1 的语义对齐如下：

1. **L1 — index 快速层**：读 `.wiki/index.md`，匹配查询词所在行。工具 `mode=index-only` 只做这一步；skill 在 auto 模式下把 L1 当作**预热扫描**，命中后仍继续 L2 核对更强者（工具 auto 模式不查 index，直接从 L2 开始）。
2. **L2 — 标题 + 标签层**：grep 标题与 frontmatter 标签，读命中文件的 `title` / `tags` / `confidence`（命中即停，不升 L3）。
3. **L3 — 正文层**：L2 无果时打开正文定位查询词，截取上下文 ≤200 字符作为 snippet。
4. **L4 — 图谱邻居**：解析命中页的 `[[wikilink]]` 出链，取一跳邻居作为关联候选。

通道对应关系：**工具 auto 模式 = L2→L3→L4**；**工具 `mode=index-only` = skill 的 L1 快速层**；**skill 完整流程 = 工具 auto 模式 + L1 预热扫描**。两通道在相同 vault 上对同一查询给出的候选集一致（skill 按上述语义执行时，L1 在 auto 下不产生候选，与工具一致）。

答案由 agent 基于候选页合成，**必须带引用**（页面路径 + `confidence` 标记：extracted / inferred / ambiguous）。无匹配时返回「wiki 无匹配」，并建议把相关内容吸收进 wiki。

### wiki_query 工具

- 入参：`query`（检索词，必填）、`mode`（`auto` 分层 / `index-only` 只查 index）、`maxCandidates`（默认 10）。
- 返回：`candidates[]`（page / id / category / title / confidence / snippet / matchedBy）+ `strategy` + `totalPages`。

### wiki-query skill（无工具 fallback）

无 dsh 工具的环境里，agent 按 `wiki-query/SKILL.md` 的流程用 grep / glob / read 完成同等检索，降级路径（无 grep、无 index.md、结果过多）见 `references/retrieval-guide.md`。skill 只读，发现新知识时路由到 `wiki_ingest` / `wiki_capture`。

### 本地语义检索（`wiki_search_semantic`，进程内 QMD，严格离线）

除关键词分层检索外，插件还提供**本地语义检索**工具 `wiki_search_semantic`：在 DSH 进程内直接使用 `@tobilu/qmd` 库（**不 spawn 命令、不走 MCP、无需单独安装或启动任何 QMD 插件**），只用两条不会联网的通道——本地嵌入模型向量检索 + BM25 关键词检索——并在本地做 RRF 融合。

- 入参：`query`（必填）、`limit`（默认 8，硬上限 20）。
- 返回：`status`（`ready` / `index-empty` / `index-stale` / `model-missing` / `library-missing`）+ `results[]`（id / category / title / snippet / score，score 为融合分数非概率）+ 必要的 `message`。
- 页面引用从命中路径推导（`displayPath` / `qmd://` URI），**不使用 QMD 的 `docid`**（它是内容哈希）；只接受七个正式分类下的 `.md`，`_system/`、`_raw/`、`wiki-export/` 永远不会成为结果。

**严格离线**：`@tobilu/qmd` 的混合检索默认会拉起 1.7B 查询扩展模型与 0.6B 精排模型（默认值为 `hf:` 云端 URI，缺失时会自动下载），因此插件**禁用这两条路径**——把它们钉到 `~/.dsh/qmd/models/` 下不存在的本地路径，任何误用只会在本地失败。索引与查询全程零网络。

这一约束必须**双写**：既写进传给 `createStore` 的配置，也写进进程环境变量（`QMD_EMBED_MODEL` / `QMD_GENERATE_MODEL` / `QMD_RERANK_MODEL`）。原因是 QMD 的**分块**路径（`chunkDocumentByTokens` → `getDefaultLlamaCpp()` → `tokenize()`）走的是**模块级单例**，它不读 store 配置、只认环境变量与默认值——只设 config 时，单例会去解析默认的 `hf:` 云端模型并联网，表现为嵌入阶段无限等待（进程内存不涨、CPU 不动）。这一点已由 `semantic-index.test.mjs` 的「单例环境」用例锁死。

**模型放置（一次性人工步骤，约 320 MB）**：

```powershell
# 目录不存在就建；插件不会自动下载，也不会联网
mkdir -Force $env:USERPROFILE\.dsh\qmd\models
# 把模型放到（文件名必须一致）：
#   %USERPROFILE%\.dsh\qmd\models\embeddinggemma-300M-Q8_0.gguf
# 可选手动下载：https://hf-mirror.com/ggml-org/embeddinggemma-300M-GGUF/resolve/main/embeddinggemma-300M-Q8_0.gguf
```

模型缺失时工具**如实回报未就绪**（给出精确路径与文件名），并且**不打开索引库**（不 import 库、不建 sqlite、不留句柄）；关键词检索 `wiki_query` 始终可用。语义状态固定在 `~/.dsh/qmd/`（`models/`、`index.sqlite`、`config.yml`），索引文件不进 vault。

**内网 / 离线部署**：`@tobilu/qmd` 声明为插件的 **optional peerDependency**（`peerDependenciesMeta` 标 optional）。DSH profile 默认 `autoInstallPeers: false`，因此 **pnpm 不会自动安装它**——这既保证插件本体永远装得上，也避免了它的依赖（`node-llama-cpp` 及其 14 个 `@node-llama-cpp/*` 平台包，其中 CUDA/异平台变体常有上百 MB 且在内网拉不到）在**每次安装任何插件时**被反复尝试下载。

要启用语义检索需**显式安装一次**：

```powershell
dsh plugin --profile web add @tobilu/qmd@2.8.3
```

（该命令会连带安装 `node-llama-cpp` 等原生依赖；内网需先把这批包镜像进私有仓库——清单与工具在**源码仓库**的 `tools/qmd-offline/`，含 `README.md`、`packages.json` 与 `mirror-qmd.mjs` 的 `list/pack/verify` 命令，不随 npm 包分发。未安装时 `wiki_search_semantic` 会如实返回 `library-missing` 并保持关键词检索 `wiki_query` 完全可用。）

### 索引新鲜度与「更新索引」

语义索引不会凭空存在，它需要**先建一次**：

- **自动**：`wiki_ingest` 落盘后会安排一次 debounce（默认 15 秒）后台刷新，连续的批量入库合并成一次；同一库同时最多一次刷新（单飞）。待嵌入积压超过阈值（默认 500 篇）时**不自动跑**，而是如实回报「请点更新索引」，避免一次大批入库在后台悄悄占满 CPU 很久。
- **手动**：边栏「语义索引」块里的 **「更新索引」** 按钮 → `POST /api/obsidian-wiki/semantic-update`（立刻返回 202，后台执行），状态由 `GET /api/obsidian-wiki/semantic-status` 轮询（重建期间每 2 秒），块内显示状态、已索引篇数、待嵌入篇数、进行中已用时间与上次结果。
- **关掉自动刷新**（保留手动按钮）：环境变量 `KNJ_OBSIDIAN_AUTO_REFRESH=off`。
- 模型未就位时状态块直接显示「模型未就位」与精确路径，按钮禁用——不会发一次注定无效的请求。

**耗时预期**（本机 i7-12700H + RTX 3060，实测）：

| 场景 | 实测 | 说明 |
| --- | --- | --- |
| 真实库 7 篇 | update 44ms + embed **86.7s** | 几乎全是一次性冷启动（模型加载 + 后端探测） |
| 合成 300 篇 冷启动 | update 1.7s + embed **96.2s** | 冷启动成本与库大小基本无关 |
| 合成 300 篇 **热态** | embed **11.9s** = **0.04s/篇（25 篇/秒）** | 稳态吞吐 |
| 外推（稳态） | 500 篇 ≈ **0.3 分钟**，2000 篇 ≈ **1.3 分钟** | 首次另加约 1.5 分钟冷启动 |

后端差异很大（`tools/bench-embed.mjs`，1053 token 文本）：CPU 饱和在 **51–56 token/秒**，Vulkan **3125–3400 token/秒（约 60 倍）**；本机 `auto` 会选 Vulkan，纯 CPU 机器的索引耗时应按两个数量级上调，因此**务必用可见的手动入口而不是静默后台**。注意 `QMD_LLAMA_GPU=cuda` 在离线环境不可用（会尝试 `git clone` llama.cpp），保持默认 `auto` 即可。

## v3：图谱导出

v3 图谱基于同一 `.wiki/` 知识库构建 **wikilink 知识图谱**（节点=页面、边=`[[wikilink]]` 链接），提供 `wiki_export` 工具导出，只读（不修改任何页面）。

### wiki_export 工具

agent 被问到「导出 wiki 图谱」「看看知识库的结构/关联」「生成知识图谱」时自动调用它。入参 `format`：

| format | 产物 | 用途 |
| --- | --- | --- |
| `html`（默认） | `graph.html` | 单文件交互可视化：内联 SVG + 原生 JS 力导向布局，零外部依赖，浏览器可直接打开 |
| `json` | `graph.json` | 结构化图数据（节点 / 边 / 孤儿 / 统计），供外部工具（Gephi / Neo4j / 自研分析）使用 |

产物写入 `<vault>/wiki-export/`（vault = 项目根目录 `.wiki/`），返回 `file` / `nodeCount` / `edgeCount`。

### 浏览器打开

导出后直接打开 `.wiki/wiki-export/graph.html`：

- **拖拽**节点调整布局，**滚轮**缩放（viewBox），悬停节点显示标题与分类
- 节点按 **category 着色**（concepts 蓝 / entities 绿 / references 橙 / synthesis 紫 / projects 灰）
- 顶部显示 `N 节点 · M 边` 统计，底部为图例

### graph.json 格式

```json
{
  "nodes": [ { "id": "kebab-case-id", "title": "页面标题", "category": "concepts", "confidence": "extracted" } ],
  "edges": [ { "source": "a", "target": "b", "broken": false } ],
  "orphanIds": ["c"],
  "pageCount": 42
}
```

- `broken: true`：出链指向不存在的页面（断链）
- `orphanIds`：既无出链也无入链的页面（孤儿）

### 孤儿 / 断链在图谱中的表现

- **断链**：红色**虚线**边，末端带红点（指向不存在的页面；仅渲染不参与力学布局，防止幽灵节点漂移）
- **孤儿**：灰色节点（无任何连接）

两种异常直接在图上一眼可辨，配合 `wiki_lint` 可定位并修复（补链或删页）。

## v4：UI

DSH Web 界面右侧边栏新增"**知识库**"标签（better-sidebar），无需离开对话即可浏览与管理知识库：

- **浏览**：按分类（概念/实体/参考/综合/项目）分组的 vault 树；点击笔记 → 主区域打开"笔记"工作台标签（markdown 渲染 + wikilink 跳转 + frontmatter 信息）
- **搜索**：顶部搜索框，回车检索（复用 v2 分层检索内核），结果带 snippet 与 confidence；可 ← 返回
- **lint 徽标**：显示页数与健康度（孤儿/断链/缺 frontmatter 计数），绿/琥珀/红三态
- **图谱**：浏览/图谱切换，内嵌力导向交互图谱（复用 v3 图谱数据；点击节点打开笔记）
- **空态引导**：vault 为空时提示"对 agent 说『把 XX 吸收进 wiki』开始"

后端提供 `/api/obsidian-wiki/*` 只读端点（pages / page / search / graph / lint），全部复用 v1-v3 内核（VaultStore / retrieve / buildGraph / lintVault），与 agent 工具同源。

## v5：笔记编辑

v5 解决笔记工作台的四个体验缺口（富渲染 / 双链导航 / 源码视图 / 编辑保存）：

- **富渲染**：markdown 管线升级为 marked 解析（含 wikilink 内联扩展，解析期直接产出锚点 token）+ DOMPurify 白名单净化（表格、引用块、任务列表、外链、分隔线全支持；代码块内的 `[[x]]` 按字面呈现）
- **双链原地导航**：点击 `[[wikilink]]` 在当前工作台原地切页，带访问历史栈与「← 返回」按钮；目标不存在时提示断链且不离开当前页
- **源码视图**：笔记页「预览 / 源码」切换；源码态展示磁盘原文（含 frontmatter，逐字节）+ 一键复制
- **全文编辑**：源码态可直接编辑整份文件（含 frontmatter，可改 title/tags）并保存；保存走 `POST /api/obsidian-wiki/page`
- **保存安全**：服务端校验路径合法性（防穿越）与 frontmatter 一致性（id/category 与目标不符即 422 拒绝，磁盘不动）；原子写（临时文件 + rename）；写端点仅接受同源请求（Origin/Referer 校验，跨站 403）+ 仅 JSON（415）
- **保存后联动**：边栏树与 lint 徽标经 `wiki:pages-changed` 事件自动刷新

## v6：增量构建

知识库的增量构建从「只能靠对话」升级为 UI 内一键完成：

- **一键重建索引**：边栏「重建索引」→ `POST /rebuild-index`，从全部页面重生成 index.md（`- [[id]] 标题 — 摘要` 格式，retriever L1 零迁移兼容）。index.md 是派生工件——重建会覆盖手工注释，想保留的内容请写进页面本身
- **导入现有 md**：边栏路径框（文件或目录）+ 分类选择 → `POST /import`。递归收集 .md（排除 node_modules/.git/target/dist，≤500 文件、单文件 ≤1MB、深度 ≤12）；已有合法 frontmatter 按声明原样入库，缺失的自动补全（id=文件名净化、title=首个标题、source=import:原路径）；id 冲突自动加 `-2` 后缀不覆盖；重导幂等（未变跳过、已变更新）；**源文件只读**
- **lint 详情速修**：lint 徽标点击展开面板——断链/孤儿页/缺 frontmatter 逐条可点；断链打开来源页（修链在来源页），其余打开对应页，直接进源码态修
- **会话蒸馏**：随包分发 `wiki-distill` skill（内嵌 zstd 多帧会话提取器，首次运行落位 `<vault>/_system/tools/`，vault 已有则用 vault 版）；入口在边栏「知识蒸馏」分段（选项「近期会话蒸馏」，可选近 3/7/30 天），点击把触发指令预填进当前对话。原始会话归档写入 `<vault>/_system/dsh-sessions/`，不参与知识检索；流程：确认范围（默认近 3 天当前项目）→ 提取 → 按主题蒸馏 → `wiki_ingest` 入库（contentHash 增量，重复源自动跳过）
- **新端点安全**：两个新写端点沿用 v5 模式（同源 403 / 非 JSON 415）；import 对源路径只读，写入落点经 SAFE_ID 净化 + vault 包含性双校验

## v7：多 vault 管理

v7 解决「本地有几个库看不出来、没有切换/维护入口」：

- **当前库身份可见**：边栏顶部「📚 库名 + 路径」常驻显示，一眼知道在看哪个库
- **库列表 + 切换**：顶部下拉列出全部库（宿主工作区自动发现 + 显式挂接），附页数；切换即换当前库，边栏树/搜索/图谱与 agent 工具（wiki_ingest / wiki_query / …）全部跟随
- **新建/挂接/移除**：⚙ 面板填目录（或「选目录」走宿主原生目录选择器）+ 显示名 → 新建/挂接；「×」移除仅限显式挂接的库（带确认，**绝不删除磁盘文件**；工作区/默认种子库只读）
- **跟工作区走**：边栏挂载时按当前工作区自动激活对应库（客户端读取宿主工作区运行时；无该服务时降级为手动切换）；服务端启动时读宿主工作区注册表，自动发现各工作区的 `.wiki`
- **注册表**：`<DSH_HOME|~/.dsh>/knj-obsidian/vaults.json`（可用插件配置 `vaultRegistryFile` 覆盖），损坏自动重建；vault 根不再写死宿主进程 cwd

新端点（写端点沿用同源 + JSON 校验）：

| 端点 | 说明 |
| --- | --- |
| `GET /api/obsidian-wiki/vaults` | 当前库 + 全部库（含只读 pageCount） |
| `POST /api/obsidian-wiki/vault/activate` | 按目录激活（已注册仅切换，未注册自动挂接） |
| `POST /api/obsidian-wiki/vault/switch` | 按 id 切换当前库 |
| `POST /api/obsidian-wiki/vault/attach` | 新建/挂接（目录不存在自动创建 + 脚手架 `.wiki`） |
| `POST /api/obsidian-wiki/vault/remove` | 从列表移除显式挂接的库（不删文件） |

## v8：界面重设计（设计系统 v2）

v8 对 v4–v7 的 UI 做整体重设计，方向为**宿主原生**（native to DSH）：

- **宿主令牌驱动**：所有颜色/字体/圆角/阴影改走宿主 `--dsw-alias-*` / `--dsw-static-*` / `--dsw-font-*` 变量（`src/client/styles.ts` 一次注入，`.knj-wiki` 作用域隔离），随宿主浅/深主题自动适配，彻底移除硬编码色值
- **布局重组**：重建/蒸馏/导入工具条收敛到底部「工具」面板；浏览/图谱改为分段切换；lint 收敛为底部状态条（页数 + 健康点 + 「问题」面板）
- **组件规范化**：统一按钮（primary/subtle/ghost-danger）、输入框、选择器、chip、banner、空态/加载/错误态；全部补齐 hover / focus-visible / disabled 状态
- **图标集**：emoji/文本符号（📚 ⚙ × ▲▼）替换为统一 SVG 线形图标（`src/client/icons.tsx`）
- **图谱**：节点/边颜色改走宿主令牌（浅/深主题均可读），新增统计与分类图例
- **笔记工作台**：标题层级、元信息 chip、分段切换、markdown 排版（标题/引用/表格/代码/任务列表）按宿主字体阶梯对齐

## v9：代码结构采集（GUI 启动器 + wiki-collect skill）

v9 把「本地工程代码 → 知识页」做成 **agent 会话驱动**的采集：GUI 只当启动器，把触发指令交给
当前对话的 Agent，由内置 `wiki-collect` skill 完成扫描 → 联动存量对账 → 蒸馏 → **直接入库**
（用户决策：不做二次确认；知识库纳入 git 分支合并把关已预留，暂未实现）。

- **内置 `wiki-collect` skill**（`wiki-collect/SKILL.md`，随包分发）：用 `wiki_mine` 扫描
  枚举/常量（→ dictionaries）与 SQL DDL/MyBatis/JPA 表结构（→ tables）并对账存量知识
  （new/changed/unchanged/deleted + 同名近似页提醒），蒸馏后经 `wiki_ingest` 直接入库
  （contentHash 增量跳过、未知/推断保持 unknown/inferred、不覆盖他源页面、不读会话归档）
- **GUI 启动器（知识蒸馏）**：边栏「知识库」→「知识蒸馏」分段——五个选项：**枚举/常量字典**、
  **表结构**、**系统功能挖掘**（**预留位**：将由 3 个 skill 组合完成——代码结构 → 关系/调用 →
  功能聚合，本机暂未安装；选中时标注「预留」并禁用动作，不生成会失败的指令；
  需要字典 + 表结构时可分别选前两项各跑一次）、**近期会话蒸馏**（可选近 3/7/30 天）、
  **指定会话蒸馏**（**复选**一个或多个会话）。点「**新建会话并预填**」——插件会新建一个会话
  （cwd = 当前库根目录）并切过去，把触发指令预填进**新会话**的输入框（可见可编辑，回车即发送给
  Agent），**不会打扰你当前正在聊的会话**；宿主不支持新建会话时退化为「复制触发指令」自行粘贴。
  代码侧走 `wiki-collect`，会话侧走 `wiki-distill`
- **指定会话蒸馏**：会话列表默认**收起**，展开后可**搜索过滤**、限高滚动、一键全选当前结果，已选 id 常驻显示并可清空；列表不可用时退化为粘贴 session id（逗号分隔多个）。提取器新增第 6 参数按会话 id 过滤（`sessionIncluded`，逗号分隔可多个），
  指令显式把时间下限设为 `1970-01-01T00:00:00Z` 以忽略 mtime 过滤（否则老会话会被漏掉），
  入库 `source=session:<id>` + contentHash 去重；提取器自测已纳入主套件
  （`wiki-distill-extractor.test.mjs` 包装 `wiki-distill/extract-dsh-sessions.test.cjs`）
- **会话蒸馏并入同一入口**：近期会话蒸馏由「当前工作区 + 时间范围」驱动（原有 `wiki-distill`
  skill 与提取器不动）；底部「工具」面板不再保留重复的复制式蒸馏按钮
- **诚实范围披露**：支持 Java enum、Java public static final、SQL DDL、MyBatis XML、JPA Entity；
  不支持 TypeScript / Python / Go / 任意 ORM / JSON Schema（UI 与 skill 均写明）；会话侧声明
  原始归档只写入 `<vault>/_system/dsh-sessions/`、不读其他工作区会话、不参与检索
- **授权模型**：GUI 点击 = 显式触发（= 授权）；skill 内部直接入库，不设中间草稿/确认状态机；
  报告在会话中可见，用户可随时打断；未来 git 分支合并作为写入把关（预留扩展位，未实现）
- **快速导入（直接写入）**：底部「工具」面板的 md 导入保留 API 兼容，UI 标注为
  「快速导入（直接写入）——跳过受审阅流程与哈希校验」，为高级路径

## v10：初始化知识库（工作区无库时）

v10 解决「工作区里还没有知识库」的场景，并纠正一个误导：**注册 ≠ 建库**。

- **新增 agent 工具 `wiki_init`**：为当前库创建 `.wiki` 脚手架（`index.md`、`.manifest.json`、
  concepts/entities/references/synthesis/projects/dictionaries/tables 七个目录），幂等
  （已存在时 `created=false` 且只补缺失结构），返回 `root` / `wikiRoot` / `created` / `pageCount`；
  只接受当前库或已注册库根目录，其他路径报错并提示先在边栏新建/挂接
- **GUI 初始化入口（触发 agent）**：当前库未初始化时，边栏身份区显示「未初始化」徽标 +
  「初始化知识库」按钮，启动器也给出同款引导；点击会**新建会话**并把初始化指令预填进该新会话
  （复制兜底），由 Agent 调 `wiki_init` 建库并回报路径——GUI 自身不写盘
- **取消静默建库**：`/vault/activate`（跟随工作区）改为**只登记 + 切换当前库，不再自动创建 `.wiki`**；
  建库只发生在显式动作：`wiki_init`、显式 `attach`（新建/挂接），或首次真实写入（写入必须建目录）
- **库列表暴露 initialized**：`GET /vaults` 每个库返回 `initialized`（磁盘是否已有 `.wiki`），
  于是 `Documents`、`profiles/web` 这类「有登记、无目录」的幽灵库会被如实标为未初始化，
  而不是看起来像一个空库
- **内置 `wiki-init` skill**（`wiki-init/SKILL.md`，随包分发）：初始化流程与边界说明
  （只建结构、不采集不写页；结构以插件为准——没有 `_raw/`、`.obsidian/`、`.env`，那是另一套
  obsidian-wiki 项目）

## v12：还原点与批次质量凭证（对抗审查后加固）

v12 按对抗审查结论给「知识蒸馏」补上可回滚与可评估能力，并修掉若干真实缺陷：

- **还原点（checkpoint）**：新增 agent 工具 `wiki_checkpoint` / `wiki_checkpoints` 与路由
  `GET /checkpoints`、`POST /checkpoint/restore`；快照落在 `.wiki/_system/checkpoints/<ts>/`
  （七分类页面 + index.md + .manifest.json）。蒸馏批次**必须**先建还原点，质量不佳时在
  「知识蒸馏 → 还原点」一键整库回滚（快照后新增/修改的页面会随之回退）。
  还原点 id 有严格格式校验，**拒绝路径穿越**（`../` 之类的 id 直接 400）。
- **批次纪律（写入指令内置，skill 同步）**：① 建还原点 → ② 先用 `wiki_query` 查重（已有同主题页就**更新**而不是新建，防 `-2` 堆积）→ ③ **写前先列清单**（将创建/更新哪些页，等确认再写）→ ④ `wiki_ingest` → ⑤ **质量评估报告**（还原点 id、逐页 id/category/confidence/新增 wikilink 数、查重决策、孤儿与推断占比风险）。
- **幂等修正**：会话蒸馏的 `contentHash` 改为**逐会话摘要哈希**（原用 catalog.json 整体哈希，
  滑动窗口每天变会重蒸旧会话）；`source` 改为 `session:<id>` 或稳定主题 slug，
  **禁止日期区间 source**（那会把更新变成新建 `-2`）。
- **工作区硬约束**：`project-filter`（`--D-workspace-xxx--`）与 sessions 根由插件算好写进指令，
  agent 不再自行推导；切换知识库时启动器刷新并清空旧库的会话选择。
- **只读路径零写副作用**：`wiki_query` / `wiki_lint` / `wiki_checkpoints` 改用 `currentReadonly()`，
  `/vault/*`、`/checkpoints` 等非写页端点不再 `ensure()`——不再出现“查询即建库”。
- **索引自动重建**：`wiki_ingest` 写完立即重建 index.md（派生工件），L1 检索不再滞后。
- **原子写**：`writePage` 与 manifest 落盘改为 tmp+rename；新增合并写 `updateManifestMerged`，
  降低崩溃/多进程共用库导致的半截文件与条目丢失。
- **图谱配色补全**：dictionaries / tables 两类在 graph.html 有独立颜色与图例（此前与默认灰同色、图例缺失）。
- **检索修复**：L1 index-only 检索补齐 dictionaries / tables 两类（此前会漏掉字典与表结构页）。
- **导入边界**：`POST /import` 只允许导入**已注册库根目录内**的 Markdown（库外路径 400），
  避免同源脚本借导入把任意目录的 `.md` 拉进可检索知识库。
- **会话过滤更严**：提取器会话过滤改为「精确或前缀匹配」（不再是任意子串），避免片段误命中无关会话；
  skill 要求逐字节比对提取器版本，版本不一致时用 skill 版本覆盖（否则“指定会话蒸馏”会退化成整范围）。
- **预填不覆盖用户输入**：新建会话预填的重试循环在检测到用户已开始输入时立即停手。
- **`wiki_init` 去掉无意义参数**：只初始化当前库（原 `root` 参数必然报错）。

- **Obsidian 适配**：`ensure()` 会写 `.wiki/.obsidian/app.json` 的 `userIgnoreFilters`，排除
  `_system/`、`_raw/`、`wiki-export/`、`.manifest.json` —— 把 `.wiki` 直接当 Obsidian vault 打开时，
  会话归档与派生工件不再进搜索/图谱；已有 `app.json` 只做并集合并，不覆盖用户自定义。
- **单一写入授权规则**（消除此前自相矛盾）：授权 = 用户显式触发（点启动器 / 对话里明确要求）；
  入库前**必做**还原点 + 输出写前清单（**信息性预览：列完即继续，不阻塞等待确认**）；写后**必做**
  质量评估报告；把关 = 还原点一键回滚 + 报告 + 将来的 git 分支合并。启动器与 `wiki-collect` /
  `wiki-distill` 三方表述一致，且由 `knowledge-distill.test.mjs` 断言（禁止再出现“等确认”式措辞）。
- **内部状态豁免与知识面隔离**：还原点 / 挖掘进度 / 会话归档存放于 `_system/`（可经专用工具与路由枚举），
  但**不得**出现在 `pages` / 检索 / 图谱 / 图谱导出 / `index.md`；会话蒸馏读取 `.zstd` 归档属**明确豁免**
  （只读输入，产物仍是 Markdown 知识页）。`integrity.test.mjs` 覆盖：跨源不覆盖 + 同源 `-N` 复用、
  页面原子写无 tmp 残留、L1 index-only 覆盖 dictionaries/tables、`_system` 不进任何知识面。

## 路线

- ~~**检索**~~ ✅ 已上线：`wiki_query` 工具 + `wiki-query` skill 双通道分层检索
- ~~**图谱**~~ ✅ 已上线：`wiki_export` 工具导出交互图谱（graph.html）与结构化数据（graph.json）
- ~~**UI**~~ ✅ 已上线：右侧边栏"知识库"标签 + 笔记/图谱工作台（v4）
- ~~**编辑**~~ ✅ 已上线：富渲染 + 双链导航 + 源码视图 + 全文编辑（v5）
- ~~**历史会话挖掘**~~ ✅ 已上线：wiki-distill skill + 边栏蒸馏按钮（v6）
- ~~**vault 跟随项目**~~ ✅ 已上线：多库管理 + 跟随工作区（v7）——当前库身份、库列表/切换、新建/挂接/移除、注册表持久化
- ~~**知识蒸馏**~~ ✅ 已上线：边栏「知识蒸馏」统一启动器（v9/v10/v11）——枚举/常量字典、表结构、全部、近期会话蒸馏（近 3/7/30 天）、指定会话蒸馏（复选）；点击**新建会话**并预填 → agent 用 wiki-collect / wiki-distill 入库
- ~~**初始化知识库**~~ ✅ 已上线：`wiki_init` 工具 + `wiki-init` skill + GUI 初始化入口（v10）——无库工作区显式初始化，取消静默建库

## 开发

```bash
npm run check   # typecheck + build（服务端）
npm run check:client && npm run build:client   # 客户端类型检查 + bundle
node --test *.test.mjs   # 全部测试（191 例；含 collection-client 启动器契约与 vault-init 初始化契约）
```

> 已知基线：`wiki_ingest` 的 `relatedCheck` 输出是 master 工作树中尚未收尾的 WIP（`src/tools.ts` 已新增输出但 `ingest-delta.test.mjs` / `tools.test.mjs` 断言未同步），与 v9/v10 功能无关；相关 8 例在 master 原工作树同样失败。

## License

MIT — 见 [LICENSE](./LICENSE)。
