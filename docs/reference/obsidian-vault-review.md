# Obsidian Vault 调研：E:\FFOutput\obsidian-wiki 对 dsh-knj-obsidian 的参考价值

> 调研时间：2026-09（依据仓库 git HEAD `8a7f6af`）
> 调研对象：`E:\FFOutput\obsidian-wiki`（git remote: `https://github.com/Ar9av/obsidian-wiki.git`）
> 只读分析，未修改该目录任何文件。
> 结论先行：**这个目录不是"装满个人笔记的 Obsidian 内容库"，而是 obsidian-wiki 这个开源框架（Karpathy LLM Wiki 模式的完整实现 + 39 个 agent skill）的源代码仓库**。仓库里没有 `.obsidian/`、没有成规模的 `concepts/entities/...` 笔记页——真正的"vault 设计"以**规范文档 + 技能定义 + 少数示例页**的形式编码在仓库里。对 dsh-knj-obsidian 来说它恰恰是**同源模型的权威参考实现**（dsh-knj-obsidian 的 `.wiki` 模型 = 7 分类 + _raw + index.md + manifest，obsidian-wiki 的模型 = 6 分类 + projects + _raw + index/log/hot + manifest，血缘一致但 obsidian-wiki 更成熟、走得更远）。

---

## 0. 快速盘点

### 目录树（≤3 层，去 .git）

```
obsidian-wiki/                          ← 框架源码 + 技能库 = "schema 层"仓库
├── .skills/                            ← 40 个技能（每个含 SKILL.md，39 个技能 + skill-creator 等）
│   ├── <skill-name>/SKILL.md           ← 技能定义（YAML frontmatter: name/description + Markdown 正文）
│   ├── <skill-name>/references/*.md    ← 13 个知识页（技能配套的领域参考页，多为纯正文无 frontmatter）
│   └── (个别含 evals/ assets/ scripts/)
├── docs/                               ← 12 篇框架文档（architecture/configuration/skills/agents/cli…）
├── obsidian_wiki/                      ← Python 包（CLI：setup/sync/lint/session-brain/graphrag/server…）
├── scripts/ tools/ tests/ extensions/  ← 工具链（daily-update.sh、check_readme_sync.py、浏览器插件…）
├── AGENTS.md / CLAUDE.md / GEMINI.md   ← 各 agent 的引导/常驻规则（同源同义）
├── .claude/skills/ .cursor/skills/ …   ← 指向 .skills/ 的 symlink（或本地副本）
├── .env.example                        ← vault 配置模板（分类、链接格式、_raw、QMD、信任字段…）
└── assets/ (.gitignore 标注 /vault/ = 用户个人库，不入库；本 checkout 无 /vault/)
```

### 文件计数

| 指标 | 数值 |
|---|---|
| 总文件数（含 .git） | 406 |
| Markdown 文件总数 | 81 |
| 其中 `.skills/*/SKILL.md` | 40 |
| `.skills/*/references/*.md`（配套知识页） | 13 |
| `docs/*.md` | 12 |
| 根级 .md（README/AGENTS/CLAUDE/GEMINI…） | 7 |
| 剩余 .md（.claude/.github/.agent 规则、tests 等） | ~9 |
| 带 YAML frontmatter（`---` 起始）的 md | 46（主要为 40 个 SKILL.md） |
| 正文含 `[[wikilink]]` 的 md | 33（集中在技能互相引用与示例页） |
| 真实"内容库笔记"（concepts/entities 等目录页） | 0（本 checkout 无填充 vault） |

### 分类分布（按 obsidian-wiki 的 6 分类 + projects 参照系）

本仓库没有实体分类目录；分类法由 `.env.example` 与文档规定：`OBSIDIAN_CATEGORIES=concepts,entities,skills,references,synthesis,journal`（`.env.example:31`），另有 `projects/<name>/` 镜像分类目录。dsh-knj-obsidian 的 7 分类（concepts/entities/references/synthesis/projects/dictionaries/tables）与之相比：多了 `dictionaries/tables`，少了 `skills/journal` 两个全局目录、没有 `projects/` 下按项目的镜像子结构——差异详见第 6 节。

---

## 1. 整体目录组织

### 顶层 = "两层组织"：类别（知识是什么）+ 项目（知识来自哪）

`docs/architecture.md` 给出权威 vault 结构（架构文档 104–128 行）：

```
$OBSIDIAN_VAULT_PATH/
├── index.md                # Master index — every page, always current
├── log.md                  # Chronological activity log
├── hot.md                  # ~500-word semantic snapshot of recent activity
├── .manifest.json          # Ingest ledger: path, timestamps, pages produced
├── _meta/
│   ├── taxonomy.md         # Controlled tag vocabulary
│   └── *.base              # Obsidian Bases dashboard definitions
├── _insights.md            # Graph analysis: hubs, bridges, dead ends
├── _raw/                   # Staging — drop rough notes, next ingest promotes them
├── _staging/               # Review queue when WIKI_STAGED_WRITES=true
├── _archives/              # Timestamped snapshots for rebuild/restore
├── _readouts/              # Narrative readouts from wiki-narrate
├── concepts/  entities/  skills/  references/  synthesis/  journal/
└── projects/
    └── <project-name>.md   # One page per project
```

关键要点：

- **分类方式 = 语义文件夹 + 文件系统，不是纯标签也不是 MOC 网**：6 个语义目录是硬骨架；标签只做细粒度辅助（且受控，见 §3）。
- **明确的收件箱层有 3 个、分工不同**：
  - `_raw/` — 快速草稿/剪贴板/录音转写的落点，`wiki-ingest` 提升为正式页后把原文**移入 `_raw/_archived/` 而非删除**（`docs/configuration.md:166-184`、`.env.example:203-209`）。
  - `_staging/` — 当 `WIKI_STAGED_WRITES=true`，LLM 写的页先排队等人工审核（`.env.example:73-79`）。
  - `_archives/` — 重建/回滚用的时间戳快照。
  - 另外 Layer-1 原始材料（PDF/对话导出等）放**vault 外**的 `OBSIDIAN_SOURCES_DIR`，vault 内只存蒸馏结果（`llm-wiki/SKILL.md:18-34`）。
- **项目维度**：项目专属知识进 `projects/<name>/`，可镜像 concepts/skills 等子目录；通用知识进全局目录；项目页与全局页互相 `[[wikilink]]`（`.skills/llm-wiki/SKILL.md:59-109`）。
- **文件命名**：kebab-case；项目总览页必须叫 `<project-name>.md`，不能叫 `_project.md`——因为 **Obsidian 图谱用文件名当节点标签**，下划线前缀会让所有项目在图谱里显示成同一个 `_project`（`llm-wiki/SKILL.md:85`）。journal 按 `journal/2024-03-15.md` 时间戳命名（`llm-wiki/SKILL.md:55`）。

> **对 dsh-knj-obsidian 的启示**：`_raw` + index + manifest 模型与 `.wiki` 一致；obsidian-wiki 额外把"原始材料层"明确拆到 vault 外的 sources dir，且 `_raw/` 提升后归档而不删除。dsh-knj-obsidian 把原始材料留在 `_raw/`（含导入原文），若要借鉴可考虑"提升后移入 `_raw/_archived/`"以避免重复蒸馏（manifest 已按 contentHash 防重）。

---

## 2. frontmatter / properties

### 语法：YAML frontmatter（非 Obsidian Properties UI 语法）

- 所有知识页强制 YAML frontmatter："Every page carries required frontmatter: `title`, `category`, `tags`, `sources`, `created`, `updated`"（`docs/architecture.md:132`）。
- Obsidian 端配置 `showFrontmatter:false`、`defaultViewMode:"preview"`、`livePreview:true`（`wiki-setup/SKILL.md:160-175`）——即**frontmatter 是给程序/agent 读的元数据，界面默认折叠**。
- 本仓库 corpus 里 40 个 SKILL.md 全部带 YAML frontmatter，但只用了两个键：`name` + `description`（description 是多行 `>` 折叠字符串，即技能触发词）。

### 字段设计（权威模板，`.skills/llm-wiki/SKILL.md:162-204`）

```yaml
---
title: Page Title
category: concepts            # 对应目录名
tags: [ml, architecture]      # 受控词表，≤5 个
aliases: [alternate name]     # 同义词 → 检索命中
relationships:                # 类型化双链（可选）
  - target: "[[concepts/related-concept]]"
    type: extends
sources: [papers/attention.pdf]   # 出处（可多个）；URL 也在此
summary: "≤200 chars 的一句话预览"  # 廉价检索的关键
provenance:                   # 页面级可信度构成（可选）
  extracted: 0.72
  inferred: 0.25
  ambiguous: 0.03
base_confidence: 0.65         # [0,1] 时不变质量分
lifecycle: draft              # draft|reviewed|verified|disputed|archived
lifecycle_changed: 2024-03-15
tier: supporting             # core|supporting|peripheral
created: 2024-03-15T10:30:00Z
updated: 2024-03-15T10:30:00Z
---
```

- 另有**页面级信任体系**：`base_confidence`（公式 = 独立证据链数/3×0.5 + 来源质量均分×0.5，来源分桶 paper=1.0 … llm_generated=0.3，`llm-wiki/SKILL.md:350-420`）、`lifecycle` 状态机（只有 ingest 能写 `draft`，`reviewed/verified` 只能人工编辑进入，`archived` 是终态）、`tier` 三档（core≥5 入链或桥节点 / supporting 默认 / peripheral 冷门页）。
- **`summary:` 是廉价检索的关键字段**：任何新页必写（`wiki-ingest/SKILL.md:422` 附近），lint 对缺失给软警告（`wiki-lint/SKILL.md:75-86`）；wiki-query 先读 summary 不读正文（见 §3/§5）。
- **aliases 用于身份解析**：检索按 title/alias/tag/summary 排序命中（`wiki-query/SKILL.md:118`）。
- 无 `id` 字段：obsidian-wiki 用**文件名当身份**（OKF 导出映射时 category→type，无 id 概念）；dsh-knj-obsidian 的 frontmatter 带 `id`，可互为补充（id 利于改名不破链，但 obsidian-wiki 的经验是文件名即标签、改名即改链，图谱/链接都跟文件名走）。

### 模板情况

- **没有独立的 Templates/ 目录、没有 Templater 模板文件**（仓库内 0 个）；Templater 仅作为"推荐社区插件"被提及（`wiki-setup/SKILL.md:177-184`）。
- 模板以**skill 内嵌规范**形式存在，共 4 套：
  1. **通用页模板**（上文，`llm-wiki/SKILL.md:158-204`）——正文固定 `# 标题 → 一段概述 → Key Ideas → Open Questions → Sources`。
  2. **Paper Deep-Dive 模板**（`llm-wiki/SKILL.md:206-267`）——论文/含公式图的源专用：`> [!tldr]` 一句话、Problem & Motivation、Method/Architecture（嵌论文原图）、Key Equations（`$$…$$`）、Results（表格）、Limitations、Related、Sources；正文可直接用 Mermaid、MathJax、`![[image]]` 嵌入。
  3. **项目总览页模板**（`llm-wiki/SKILL.md:89-109`）：category:project + Key Concepts / Related 段落。
  4. **_raw 快速捕获模板**（`.skills/wiki-capture/references/RAW-FORMAT.md`）：bug/fix 型 = `**Problem:**/**Root cause:**/**Fix:**(❌before/✅after)/**Confirmed by:**`；gotcha 型 = `**Behavior:**/**Explanation:**/**Workaround:**/**Confirmed by:**`。
- 初始化时生成 `index.md` / `log.md` / `hot.md` 空骨架（`wiki-setup/SKILL.md:79-154`）。

> **对 dsh-knj-obsidian 的启示**：dsh-knj-obsidian 的 frontmatter（id/title/category/tags/source/confidence/created/updated）与 obsidian-wiki 高度同构；可考虑新增 **summary（廉价预览）**、**aliases**、**provenance 三元分**、**tier**，并把 `source`（单数）升级为 `sources`（复数数组）以支持"一页多源、可归属"。

---

## 3. 双链与图谱实践

### wikilink 风格

- 语法：`[[path/to/page]]` 或 `[[path/to/page|display text]]`（短路径，唯一名时不带目录前缀；`cross-linker/SKILL.md:66`：prefer the shortest unambiguous path）。可用 `OBSIDIAN_LINK_FORMAT` 切换为 markdown 相对链接（`llm-wiki/SKILL.md:503-530`）。
- 本仓库 corpus 里 33/81 个 md 含 `[[…]]`，主要出现在：技能正文互相指路（如 llm-wiki 被各技能引用）、示例页（如 `url-sources.md` 有 5 处）。密度一般——因为这是框架仓库不是内容库；真正的内容库用法由 cross-linker / ingest 规范规定（每次写入后把正文里"未包裹的提及"包成 `[[…]]`，`cross-linker/SKILL.md:51-66`）。
- **首次提及即链**："Find the first natural mention of the term in the body text and wrap it"（`cross-linker/SKILL.md:139`）。

### MOC：`index.md` 就是 MOC + 目录一体

- `index.md` 按**分类分组**列出全部页：`## Concepts` → `- [[transformer-architecture]] — 一句话 ( #ml #architecture)`（`llm-wiki/SKILL.md:115-130`）。
- 一条格式硬规则：`description ( #tag)` 括号内必须有空格，否则 Obsidian 标签解析失败（`llm-wiki/SKILL.md:128-130`）——**这是给"自动生成索引"的实现者踩坑实录**。
- 每次 ingest 后必须重建 index（`llm-wiki/SKILL.md:116`）；lint 检查 index 与实际页清单一致（`wiki-lint/SKILL.md:108-115`）。
- **图谱查询必须排除账本文件**：index/log/hot/_insights 会链到几乎所有页，若计入会让任意两页看起来 2 跳可达、产生无意义的 A→index→B 假路径（`wiki-query/SKILL.md:96`；README.md:133-137 记录了为此付出的实测代价——plain agent 因 index 页链接一切而答错"哪页最重要"）。

### 标签体系：受控词表 + 保留系统标签

- 受控词表存于 `$VAULT/_meta/taxonomy.md`（canonical tags / aliases / 迁移指南；`tag-taxonomy/SKILL.md:22-31`）。
- 规则：**每页 ≤5 标签、小写连字符**、优先宽泛；别名必须归一到 canonical（如 `nextjs`→`react`）；1 页独有的新标签建议替换而非新增词表项；2+ 页使用才允许加词表（`tag-taxonomy/SKILL.md:124-156`）。
- **`visibility/` 是保留系统标签组**：`visibility/public|internal|pii`，不计入 5 标签上限、不参与别名归一、图谱/查询可按可见性过滤（public-only 查询）（`tag-taxonomy/SKILL.md:33-50`、`configuration.md:240-253`）。
- 图谱按 `_meta/` 下的 `.base` 或 tag 查询呈现；另有 `wiki-export` 导图谱时用"首标签"上色（`wiki-export/SKILL.md:84`）。

### 孤岛/孤页处理

- **孤儿页定义 = 零入链**（排除 index.md/log.md/hot.md/_insights.md，以及 `_archives/_raw/_readouts/.obsidian` 这些非知识图目录；`wiki-lint/SKILL.md:35-48`）。
- 修复默认走 cross-linker（在相关页补链）或手动判断（`wiki-lint` consolidate 模式才落盘，且先 dry-run + 用户确认）。
- 比"孤儿"更进一步：**碎片化标签簇检测**——同标签 ≥5 页但互相链接 cohesion < 0.15 判定为知识孤岛（`wiki-lint/SKILL.md:136-149`）。
- 图谱洞察（`_insights.md` / `wiki-status` insights）：hubs（度数）、bridges（介数，删掉会分裂图）、dead ends（`configuration.md` / `README.md:172`）。

> **对 dsh-knj-obsidian 的启示**：dsh-knj-obsidian 已实现 wikilink 双链、图谱视图、孤儿/断链 lint；可借鉴的是 **index.md 作为 MOC 的分组格式 + `( #tag)` 空格规则**、**图谱计算/导出排除 index.md 等账本文件**（避免 hub 假象）、**cohesion < 0.15 的碎片化检测**、以及 **category 上色固定顺序**（§4）。

---

## 4. 检索与组织插件痕迹

**重要前提**：本 checkout 没有 `.obsidian/` 目录（vault 从未在此仓库根上被 Obsidian 打开过），因此**不存在实际的 community-plugins.json / core-plugins.json / graph.json**。但这些配置的"正确写法"全部被编码成了技能规范：

### `.obsidian/` 最小配置（wiki-setup 生成，`wiki-setup/SKILL.md:156-175`）

```json
// .obsidian/app.json
{ "strictLineBreaks": false, "showFrontmatter": false, "defaultViewMode": "preview", "livePreview": true }

// .obsidian/appearance.json
{ "baseFontSize": 16 }
```

### 推荐社区插件清单（wiki-setup，用户手装）

1. **Dataview** — 元数据动态表，"Essential for a wiki"
2. **Graph Analysis** — 增强图谱
3. **Templater** — 手工建页模板（可选）
4. **Obsidian Git** — vault 自动备份

### graph.json 颜色分组（graph-colorize 规范，`graph-colorize/SKILL.md`）

- 数据结构：`colorGroups: [{ "query": "tag:#foo" | "path:\"concepts\"", "color": {"a":1, "rgb":<packed-int>} }]`，**first match wins**。
- **by-category 模式用 7 个顶层目录固定顺序、固定颜色**（稳定性优先）：

| 目录 | 颜色 |
|---|---|
| concepts | #4E79A7 蓝 |
| entities | #F28E2B 橙 |
| skills | #E15759 红 |
| references | #76B7B2 青 |
| synthesis | #59A14F 绿 |
| projects | #EDC948 黄 |
| journal | #B07AA1 紫 |

- 调色板 10 色、色盲友好（#4E79A7…#BAB0AC，`graph-colorize/SKILL.md:43-54`），与 `wiki-export` 的 graph.html 社区色一致，保证 Obsidian 图谱与导出可视化同色。
- **写回纪律**：先备份 `graph.json.backup-<ts>`；只替换 `colorGroups` 字段不碰其他（缩放/力导向/搜索等用户偏好）；提示"Obsidian 打开时会在关闭时覆写 graph.json"，要求重载或先关。
- 每类只对"存在且至少含一个 .md"的目录发条目；by-tag 取使用频率 Top10；by-visibility 顺序 pii(红)→internal(橙)→public(绿)。

### Bases / Dataview dashboard（wiki-dashboard 规范，`.skills/wiki-dashboard/SKILL.md`）

- **Bases（Obsidian 1.8+ 原生 `.base` 文件）** 放 `_meta/<slug>.base`；canonical schema：顶层 `filters/formulas/properties/summaries/views`。
- 踩坑实录（可直接省去 dsh-knj-obsidian 未来做 Bases 输出时的试错）：
  - filters 必须是 `and:/or:/not:` 表达式字符串，裸列表会报 "may only have one of and/or/not keys"；
  - `groupBy` 必须放 view 内部、不放顶层；groupBy 的 property 要**从 `order:` 里去掉**否则列重复；
  - 列名用 `properties: {<prop>: {displayName: "…"}}`，不是 `columns: [{title}]`；
  - 表达式参考：`file.inFolder("concepts")`、`file.hasTag("tag")`（无 #）、`file.hasLink("Note Name")`、`note.<frontmatter 属性>`、`formula.<name>`；
  - Obsidian GUI 会重写成 `columns:/sort:/view:` 简写——两种都合法，手工写用 canonical。
- **Dataview**：` ```dataview TABLE … FROM "folder" ````；GROUP BY 后属性要 `rows.` 前缀；日期运算用 `file.mtime` 而非 `choice(updated,…)`（mixed date formats 会算术报错）。
- Bases 是实时查询 → 不写 manifest/index（`wiki-dashboard/SKILL.md:410`）。

### 检索分层（非插件，但决定"检索"能力上限）

`llm-wiki/SKILL.md:463-481` 的 Retrieval Primitives：先读 index.md → grep frontmatter（title/tags/aliases/summary）→ grep 正文片段（-A/-B）→ 最后才整页读；QMD（可选 BM25+向量本地引擎）语义检索兜底。**QMD 两个 collection 必须分离**：wiki collection 要 ignore `_raw/**` 与 `log.md`，否则草稿会被当成正式知识检索/引用（`.env.example:113-143`）。

> **对 dsh-knj-obsidian 的启示**：图谱上色可直接照搬"目录→固定色序 + 10 色色盲友好调色板 + 与导出图同色 + 只改 colorGroups + 先备份"；如果插件未来要在 DSH GUI 里做类似图谱配色/导出，这套规范可直接落地。dsh-knj-obsidian 已有全文检索，可补充"frontmatter 字段级检索优先"的代价分层。

---

## 5. 内容质量与写作约定

### 规范文件

- 没有独立的"vault 写作规范 .md"；规范 = **`llm-wiki/SKILL.md`（schema 层总纲）+ 各操作 skill + vault 根 AGENTS.md**（`configuration.md:18`：vault 自己的 AGENTS.md 放 owner 领域词表/写作偏好/项目范围，覆盖框架默认）。
- README.md 明确六条核心原则（`llm-wiki/SKILL.md:489-501`）：
  1. **Compile, don't retrieve**（合并不新建；新源融入既有页，禁止复制粘贴式新增）
  2. Compound over time（每次 ingest 让 wiki 更聪明而非更大）
  3. Provenance matters（每句可溯源）
  4. Mark inferences（推断必须打 `^[inferred]`，争议打 `^[ambiguous]`——"藏猜测的 wiki 会悄悄烂掉"）
  5. Human curates, LLM maintains（人定源与问句，LLM 做记账/交叉引用/矛盾标注）
  6. Obsidian is the IDE（一切必须是合法 Obsidian markdown + 可用 wikilink）

### 行内来源标记（provenance markers）

`^[inferred]` / `^[ambiguous]` 后缀——与 wikilink 不冲突、行内不破坏单条 bullet；无标记默认 extracted（`llm-wiki/SKILL.md:271-305`）。lint 按阈值抓：ambiguous>15% → speculation-heavy；inferred>40% 且无 sources → unsourced synthesis；hub 页 inferred>20% 优先复查（`wiki-lint/SKILL.md:118-134`）。

### 日记/每日笔记

- 语义上是 `journal/` 分类（时间戳文件名），**不是 Obsidian 的 Daily Notes 插件产物**；`daily-update` 技能负责周期维护：源新鲜度检查（mtime vs manifest ingested_at → fresh/stale/missing）→ index 对账 → hot.md 刷新（>48h 旧才重写，读最近 10 个改动页产出 ~500 词快照）→ 按 `LINT_SCHEDULE`（默认 weekly）决定是否顺带 lint（`.skills/daily-update/SKILL.md`）。
- log.md 是可解析的追加式操作日志，如 `- [2024-03-15T10:30:00Z] INGEST source="papers/attention.pdf" pages_updated=12 pages_created=3`（`llm-wiki/SKILL.md:132-143`）。

### 示例页长相（3 个代表性页面）

**A. `_raw` 快速捕获草稿规范（`.skills/wiki-capture/references/RAW-FORMAT.md`）**
frontmatter 范例（有 category/tags/summary/tier/base_confidence/lifecycle/provenance/sources/project，无正文 H1 由 title 承担）+ Finding 块正文。这页展示了"写正文的人只需要填结构化块"的捕获格式，以及**置信度校准表**（build error + test pass → 0.80-0.90；fix applied appeared to work → 0.70-0.75；discussed not confirmed → 0.60；single case → 0.55）。

**B. URL 源摄取参考页（`.skills/wiki-ingest/references/url-sources.md`）**
正文是纯流程规范：项目检测顺序（git remote → package.json/pyproject → 目录名 → misc/ 兜底）、slug 生成规则（hostname+前 2 段路径、小写、`/.?=&` 全转 `-`、折叠连续 `-`、截 50 字符、前缀 `web-`，如 `https://martinfowler.com/articles/microservices.html` → `web-martinfowler-com-articles-microservices`）、重复检测（grep manifest source_url）、stub 页机制（抓取失败建 `stub:true` 页 + `> [Stub]` 提示）。含 5 处 `[[…]]` 相互引用。

**C. 会话数据格式参考页（`.skills/claude-history-ingest/references/claude-data-format.md`）**
无 frontmatter 纯正文：目录编码/解码规则、JSONL 事件类型表（标"值得读/不值得读"）、JSON 示例、提取策略（只抽 assistant 的 text 块、跳过 thinking/tool_use）。代表 obsidian-wiki 中 references/ 一类页的形态：**一张表 + 示例 + 明确取舍**，供技能运行时参考而非给人泛读。

> 说明：13 个 references 页里 12 个是无 frontmatter 的纯技术参考（挂技能下），只有 RAW-FORMAT 页内含 frontmatter 范例；真正的"知识页 frontmatter"权威样例在 `llm-wiki/SKILL.md` 模板代码块中（上文 §2）。这是框架仓库特性，不是缺陷。

---

## 6. 亮点与可借鉴清单

### 6.1 dsh-knj-obsidian 已有、无需学的能力（两模型同源项）

- 分类目录 + YAML frontmatter 页面模型（dsh-knj-obsidian 甚至更细分：7 类含 dictionaries/tables）
- `_raw/` 收件箱 + `index.md` 自动索引 + `.manifest.json` 增量对账（contentHash/mtime）
- wikilink 双链 + 图谱视图 + 全文检索
- Lint（孤儿页/断链/缺 frontmatter）
- AI 蒸馏写入（wiki_ingest/wiki_capture 对应 obsidian-wiki 的 ingest/capture 技能）
- confidence 字段（obsidian-wiki 用 base_confidence，机制相似）

### 6.2 可借鉴清单

| # | 借鉴点 | 来源证据（文件+行/节） | 如何落到 dsh-knj-obsidian 的 `.wiki` 模型 |
|---|---|---|---|
| 1 | **frontmatter 加 `summary:`（1–2 句 ≤200 字符）并作为廉价检索/列表预览主字段** | `llm-wiki/SKILL.md:172,422`；`wiki-lint/SKILL.md:75-86`；`wiki-query/SKILL.md:118`（title/alias/tag/summary 排序） | .wiki 列表/搜索/图谱 hover 直接读 summary 不读正文；生成页时强制蒸馏 summary；lint 对缺失给软警告 |
| 2 | **frontmatter 加 `aliases:` 数组，检索按 title/alias 双命中** | `llm-wiki/SKILL.md:162-204` 模板、`wiki-query/SKILL.md:118` | .wiki 检索器把 alias 纳入命中面；跨名引用（如 "RSC"=“React Server Components”）不破链 |
| 3 | **行内 provenance 标记 `^[inferred]`/`^[ambiguous]` + 页面级三元比例** | `llm-wiki/SKILL.md:271-305`；lint 阈值 `wiki-lint/SKILL.md:118-134` | AI 蒸馏写入时对推断句打标（markdown 脚注语法，与 wikilink 无冲突）；.wiki lint 增加“推断占比过高/无源推断”检查；图谱/UI 可标注 |
| 4 | **`source` 单数升级 `sources[]` + 页级 `created/updated` + 归属追溯** | 模板 `llm-wiki/SKILL.md:172`；architecture.md:132 | 一页可声明多个源；manifest 记录“哪次源产生了哪页/更新了哪页”（pages_created/pages_updated，`wiki-status/SKILL.md:28-51`），源变更时可精准定位受影响页重蒸 |
| 5 | **index.md 的 MOC 格式 + 空格规则**：按分类分组、一行一页 `— 一句话 ( #tag)` | `llm-wiki/SKILL.md:115-130`（"Format rule: 括号内必须有空格否则标签解析失败"） | .wiki 索引页生成器照此排版；dsh-knj 图谱/检索排除 index.md 这类账本文件避免 hub 假象（`wiki-query/SKILL.md:96`） |
| 6 | **受控标签词表 `_meta/taxonomy.md` + 每页 ≤5 标签 + 别名归一** | `tag-taxonomy/SKILL.md`（taxonomy 文件结构 22-31、5 标签规则 124-156） | .wiki 增加 `taxonomy` 概念（可在 dictionaries/ 或 .wiki 根放词表），lint 报未知标签/超 5 标签；AI 写入时先读词表选标签 |
| 7 | **保留系统标签 `visibility/public|internal|pii`（不计入 5 上限）→ 查询/图谱可按可见性过滤** | `configuration.md:240-253`；`tag-taxonomy/SKILL.md:33-50` | .wiki 页面可标 pii/internal；检索与图谱支持“仅公开内容”过滤（适合多工作区/团队场景） |
| 8 | **图谱上色：目录→固定色序、10 色色盲友好调色板、与导出图同色、只改 colorGroups、先备份** | `graph-colorize/SKILL.md`（调色板 43-54、by-category 67-85、合并纪律 109-143） | dsh-knj 图谱视图按 .wiki 7 分类固定上色（concepts 蓝/entities 橙/…/dictionaries、tables 续色）；若导出可视化保证同色系 |
| 9 | **类型化双链 `relationships:`（extends/implements/contradicts/derived_from/uses/replaces/related_to 白名单）** | `llm-wiki/SKILL.md:307-348`（双向语义、不伪造、未标注视为 related_to） | .wiki 页 frontmatter 支持可选 relationships 块；图谱边带类型、支持“X 依赖什么/谁和谁矛盾”结构化查询（对应 wiki-export typed edges） |
| 10 | **Paper/富内容 Deep-Dive 模板**：tldr 引言、Method（嵌原图）、`$$`公式、结果表、Limitations、Related | `llm-wiki/SKILL.md:206-267`；`ingest-prompts.md:24-34` | .wiki references/ 类目对论文/技术文档蒸馏时用富模板（markdown 原生 Mermaid/LaTeX/表格即可，不必等 Obsidian 特性） |
| 11 | **检索代价分层**：index.md → frontmatter grep → 正文 grep(-A/-B) → 整页读，逐级升级 | `llm-wiki/SKILL.md:463-481`（Retrieval Primitives 表） | dsh-knj 全文检索内部先扫 title/tags/aliases/summary 索引、命中不足再读正文，控 token（.wiki 已有 manifest 增量，与检索分层互补） |
| 12 | **_raw 提升后归档（移入 `_raw/_archived/`）而非删除** | `.env.example:203-209`（"Promoted files are moved into _raw/_archived/, not deleted"）；configuration.md:166-184 | .wiki 的 AI 写入把 _raw 草稿提升后同样归档，保留原文证据链 |
| 13 | **日志纪律**：log.md 追加式可解析操作日志 + hot.md ~500 词“最近活动”快照（新会话先读 hot 再爬全库） | `llm-wiki/SKILL.md:132-143`（log 行格式）；hot.md 说明 architecture.md:134；`daily-update/SKILL.md` | .wiki 每次写入追加操作日志；插件启动/会话续接先读“最近改动快照”而非全库重建上下文 |
| 14 | **Karpathy 原旨的“编译不累积”纪律**：新源合并进既有页（补强/记矛盾/加交叉引用），不复制粘贴式新增 | `README.md:101-105`、`ingest-prompts.md:36-44`（Synthesis Frame）；`llm-wiki/SKILL.md:489-501` 原则 1 | dsh-knj 蒸馏写入默认 merge：命中既有页先“更新既有页”再考虑建新页；跨页矛盾写进 Open Questions/矛盾段 |
| 15 | **多 vault / 项目路由协议**：`@name` 单次覆盖 + 配置向上查找 + 活动 vault symlink（wiki-switch） | `llm-wiki/SKILL.md:532-581`；`configuration.md:3-22` | dsh-knj 若做“多工作区 .wiki 切换/绑定”，可借鉴 `@name` 路由与“当前工作区 .env → 全局 config”查找顺序，避免多库混淆 |
| 16 | **图谱“桥节点/死胡同”洞察页 `_insights.md`（hub/bridge 计算后写盘、不自动改页）** | `wiki-status` insights（architecture.md:172、README.md 引用）；`wiki-lint` cohesion 检查 | .wiki 图谱分析输出“哪些页是桥/死胡同/碎片化标签簇”报告页，仅建议不自动改写（与 tier 概念衔接） |

### 6.3 需要谨慎、不建议照搬的点（诚实提示）

- **无 `id` 字段、以文件名为身份**：obsidian-wiki 靠“文件名即图谱标签”简化，但改名会断链需 cross-linker 修；dsh-knj-obsidian 已有 `id`，建议保留 id 作稳定身份 + 文件名作显示名，两者都映射进 wikilink 目标。
- **`projects/<name>/` 按项目镜像整棵分类树**：多项目场景下会让同概念在多个项目副本间分裂（obsidian-wiki 靠“项目专属才放项目”纪律约束）；dsh-knj-obsidian 以“每个工作区根一个 .wiki”隔离，天然规避了此问题，不必模仿镜像结构。
- **39 技能 + CLI 的复杂度**（QMD/CodeGraph/PageIndex/trust ledger/OKF…）远超插件单侧边栏知识库所需——只借鉴与 `.wiki` 模型直接相关的设计，不追求功能对齐。

---

## 附：关键文件索引（快速复核用）

| 主题 | 文件 |
|---|---|
| Vault 权威结构 | `docs/architecture.md:104-128` |
| frontmatter 权威模板/字段 | `.skills/llm-wiki/SKILL.md:158-204` |
| 信任/生命周期/重要性分级 | `.skills/llm-wiki/SKILL.md:350-461` |
| 检索代价分层 | `.skills/llm-wiki/SKILL.md:463-481` |
| 配置/环境变量全集 | `.env.example`、`docs/configuration.md` |
| vault 初始化 + .obsidian 配置 | `.skills/wiki-setup/SKILL.md:65-184` |
| 图谱上色 | `.skills/graph-colorize/SKILL.md` |
| Bases/Dataview dashboard | `.skills/wiki-dashboard/SKILL.md` |
| 标签受控 | `.skills/tag-taxonomy/SKILL.md` |
| lint（孤儿/断链/frontmatter/矛盾/碎片簇） | `.skills/wiki-lint/SKILL.md` |
| manifest schema | `.skills/wiki-status/SKILL.md:22-69` |
| _raw 捕获格式 | `.skills/wiki-capture/references/RAW-FORMAT.md` |
| OKF 互操作映射 | `.skills/wiki-export/SKILL.md:365-408` |
