---
id: deepwiki-open-方法考古-代码逆向为-wiki-的提示词与工程配置
title: DeepWiki-Open 方法考古：代码逆向为 wiki 的提示词与工程配置
category: references
tags: [concept, decision]
summary: DeepWiki-Open（MIT，commit d92819a）的方法考古：两段管线（file_tree+README 定结构 → 逐页生成）、九段式页面提示词、Mermaid 强制竖排、Sources 引用格式与 ≥5 源文件纪律、排除清单与 8192 token 分块；明确该抄与不该抄。
tier: core
source: agent:capture
confidence: inferred
created: 2026-10-18T03:23:13.121Z
updated: 2026-10-18T03:23:13.121Z
---

## 元信息（出处必须可溯）

| 项 | 值 |
|---|---|
| 仓库 | `AsyncFuncAI/deepwiki-open`（DeepWiki 的开源自托管复刻） |
| 许可 | **MIT**，Copyright (c) 2024 Sheing Ng（`LICENSE` 原文核验） |
| 考古 commit | `d92819a9c9f3b99416e3580ff235fc9d3adf8b89`（2026-09-03） |
| 取源方式 | **`api.github.com` contents API 单文件 base64 直取**。本机实测：`raw.githubusercontent.com` 与 `cdn.jsdelivr.net` 均不可达（fetch failed / 30s 超时），api.github.com 稳定 |
| 考古文件 | `api/services/wiki/prompts.py`（14022B，核心）、`api/services/wiki/structure.py`、`api/services/wiki/content.py`、`api/rag/pipeline.py`、`api/config/repo.json` |

## 它的管线只有两步（这点最关键）

**第一步：定结构**（`build_structure_prompt`）——输入**只有 `file_tree` + `README`**，不看任何代码。
产出一份 XML `wiki_structure`：sections（可嵌套 subsections）→ pages；每个 page 带 `title / description / importance(high|medium|low) / relevant_files[] / related_pages[] / parent_section`。
comprehensive 档给固定章节骨架（Overview / System Architecture / Core Features / Data Management / Frontend / Backend / Model Integration / Deployment / Extensibility），出 **8–12 页**；concise 档无章节、**4–6 页**。
提示词里明确要求「挑出适合配图的页」：架构总览、数据流、组件关系、流程工作流、状态机、类层次。

**第二步：逐页生成**（`build_page_prompt` → `research_chat`）——输入该页 `title` + `filePaths` 拼成的**链接清单**，然后走 **RAG 检索管道**取上下文，**不是喂 relevant_files 全文**。

> ⚠️ **更正（2026-10-17 二次考古）**：本页早先写的「输入 relevant_files 的全文」**是错的**。实际链路是 `tasks.py:382 build_page_prompt` → `research_chat(chat_request)`（`api/services/research.py`）：用 RAG 检索 repo 索引，把命中块格式化成 `## File Path: <path>` + `[lines A-B]` + 正文，用 `----------` 分隔拼进 prompt；`MAX_INPUT_TOKENS = 7500`，**超限时还会「不带上下文重试」**（`research.py:271` "retrying without context"）。
>
> 由此得到一个**决定性判断**：它那套「≥5 源文件 + Sources 引用」的纪律，**只作用在化妆层**（`post_process_wiki_content` 按 `page.filePaths` 重建 details 块、正则解析引用），**并不保证模型真的读过这些文件**。页面可以引用它从未见过的路径。**这是我们必须补的洞：把「声明源」绑死到「实际读过的源」。**

> **结论级判断：它的「组织」是纯 top-down 猜的**（只看文件树和 README）。这正是它有代码图谱能力却没用上的地方——我们的 `code-understand` / 图引擎在这一步本该更强。

## 页面提示词里真正值钱的约束（可直接抄）

1. **首屏 `<details>` 源文件块**：页面第一件事必须是 `<details><summary>Relevant source files</summary>` 列出**全部**所用文件，**至少 5 个**，模板逐字复现、不得加前言。
2. **九段式正文**：Introduction（1–2 段）→ Detailed Sections（H2/H3，讲架构/组件/数据流/逻辑 + 关键函数类 API 配置）→ Mermaid 图 → 表格 → 代码片段（可选）→ 引用 → 准确性 → 简洁 → 结论。
3. **Mermaid 强制竖排**（最硬的一条）：**只用 `graph TD`，绝不许 `LR`**；节点宽 **3–4 个词**；sequenceDiagram 必须首行声明、先定义全部 participant、给出 8 种箭头语法（`->>` 请求 / `-->>` 返回 / `->x` 失败 / `-)` 异步…）、激活框 `+/−`、`box/loop/alt/opt/par/critical/break` 结构、`autonumber`、`Note`；禁止 `A--|label|-->B`。
4. **引用格式**（抗幻觉的骨干）：`Sources: [repo/相对/路径.ext:起始-结束]()`——**圆括号留空**（由系统解析成可点链接）、**必须写全仓库相对路径**、`Sources:` 放在方括号**之前**、**全页至少引用 5 个不同文件**。
5. **只准用给定文件**：「derived SOLELY from the RELEVANT_SOURCE_FILES；不得推断/发明/引入外部常识；信息缺失就不写或明确说明缺失」。
6. 固定输出语言（多语言 `LANGUAGE_NAMES` 表，含中文）。

## 工程配置里值得抄的两张表

- **排除清单**（`config/repo.json`）：`excluded_dirs` = 依赖/构建/缓存/IDE/文档站（node_modules, dist, build, target, vendor, .git, docs…）；`excluded_files` = 锁文件、env、各类 lint/构建配置、压缩产物与二进制（`*.min.js`, `*.map`, `*.lock`, `.env*`, `tsconfig.json`, `vite.config.js`…）。
- **语言与规模**：`code_extensions` 16 种（py/js/ts/java/cpp/c/go/rs/jsx/tsx/html/css/php/swift/cs）；`doc_extensions`（md/txt/rst/json/yaml）；仓库上限 50GB。
- **分块**（`rag/pipeline.py`）：tiktoken 计数，`MAX_EMBEDDING_TOKENS = 8192`；**超过上限 10 倍的文件直接跳过**（不截断），并记 `token_count` 元数据。

## 明确不该抄的

| 不该抄 | 原因 |
|---|---|
| 整库重蒸 | 它没有增量对账；我们的 enum/db 已有 `new/changed/unchanged/deleted` 对账，功能页也应按页 id 查重 + `inferred` 覆盖 |
| 一文件一节 / 一符号一页 | 粒度爆炸（pemographer 类方案通病）；我们定**能力级**（一个功能一页） |
| file_tree+README 定结构 | 这是它的**弱点**：结构应来自代码关系（调用/注册/路由），不是目录树 |
| 它的检索层 | 我们有自己的三通道（词面分层 + QMD + 图），不需要它的向量 RAG |

## 与我们「系统功能挖掘」三段管线的映射

| 我们的段 | 它对应的部分 | 取舍 |
|---|---|---|
| ① 代码结构 | `iterate_files` + `code_extensions` + 排除清单 | **直接借用**（排除清单尤其省事） |
| ② 关系/调用 | **无**（它不看代码关系） | 用我们的 `code-understand` / 图引擎补上，这是**相对它的优势** |
| ③ 功能聚合 | 结构提示词（定页）+ 页面提示词（写页） | 借「九段式 + 引用格式 + mermaid 竖排 + ≥5 文件」；**改**：结构改由②驱动；分类改成 Obsidian 的 category/wikilink |

## 复现命令（下次要重取时）

```powershell
$base='https://api.github.com/repos/AsyncFuncAI/deepwiki-open/contents'
curl.exe -s "$base/api/services/wiki/prompts.py" -o "$env:TEMP\dw.json"
node -e "const j=JSON.parse(require('fs').readFileSync(process.env.TEMP+'/dw.json','utf8'));require('fs').writeFileSync('prompts.py',Buffer.from(j.content,'base64').toString('utf8'))"
```

## 补充考古（本地源码 `D:\workspace\deepWiki\deepwiki-open`，同 commit d92819a 核验一致）

### 引用解析：`<details>` 不是靠模型自觉，是后处理强制重建

`api/services/wiki/content.py` 的 `post_process_wiki_content`（前端 `postProcessWikiContent` 的 Python 端口，纯函数、有单测）：

1. **用已知 `file_paths` 重建整个 `<details>` 块**——存在则整块替换，不存在则插到正文最前。所以「≥5 个源文件」这条纪律的**最终保证在代码里，不在提示词里**。
2. 按**已知文件列表**解析空括号引用（正则用 `sorted(file_paths, key=len, reverse=True)` 做最长优先交替，避免前缀误配）。
3. 通用形态 `[任意/路径.ext:行]()`。
4. `[Sources: 裸文件名:行]()` → 用 basename 反查完整路径。
5. 收尾清掉残留的空 `()`。

**url 生成是主机相关的**：`generate_file_url` 对 github 出 `/blob/<branch>/<path>`、gitlab 出 `/-/blob/`、bitbucket 出 `/src/`；**local 仓库或不认识的主机 → 原样返回路径、`_citation_link` 返回 None、引用保持纯文本**。
行锚分别拼 `#L1-L2`（github）/`#L1-2`（gitlab）/`#lines-1:2`（bitbucket）。

> 对我们的意义：Obsidian 场景没有 web 主机，**这套链接解析天然退化成纯文本引用**——所以我们要抄的是「`路径:起-止` + 后处理规范化」这条纪律，而不是 URL 那半段。

### 编排：任务化 + 整库缓存，页面默认串行

`api/services/wiki/tasks.py`：

- 仓库级并发池 `MAX_CONCURRENT_WIKI_TASKS` = CPU 一半（环境变量可覆盖）；
- **单任务内的页面生成并发 `WIKI_PAGE_CONCURRENCY` 默认 1（串行）**；
- 状态机 `PENDING/…`、`current_page_ids` 逐页进度上报。

`api/services/wiki/io.py`：

- 缓存形态：`wikicache/deepwiki_cache_<repo_type>_<owner>_<repo>_<language>.json`，**整库一份 JSON**，键含语言；`list_wiki_cache` 只把缓存文件当 COMPLETED。
- 导出 markdown 的结构：`## Table of Contents`（`[title](#page-id)`）→ 每页 `<a id='page-id'></a>` + `## title` + `### Related Pages`（`[title](#id)`）+ 正文 + `---`。
- **交叉链接 = 同一文档内的锚点**（page id），不是独立文件。

> 对我们的意义：①「串行生成 + 逐页进度」与我们「agent 会话里逐页蒸馏」天然同构，不需要引入并发机制；②它的缓存是**整库重蒸**，增量对账这一步确实是空白（我们的 `new/changed/unchanged/deleted` 更先进）；③它用锚点做交叉链接，我们用 Obsidian 的 `[[wikilink]]` 到独立文件——**这点我们必须换**，否则失去图谱与反链。

### 这一步仍然没解决的（我们的机会）

整条管线里**没有任何代码关系提取**：结构靠 `file_tree + README` 猜，页面的 `relevant_files` 也是猜的。所以「② 关系/调用」只能由我方补——`code-understand`（本机已验：`obsidian-wiki` CLI 在，builtin 后端能识别 AST；`rg` 与 `codegraph` 未装，跨文件引用证据偏弱）。

### 页面模型刻意很薄（只有 6 个字段）

`api/schemas/wiki.py`：

- `WikiPage`：`id / title / content / filePaths[] / importance(high|medium|low) / relatedPages[]`——**没有 category、tags、tier，也没有 per-claim 置信度；引用不进 schema**，只活在 markdown 正文里靠后处理解析。
- `WikiSection`：`id / title / pages[] / subsections[]`；`WikiStructureModel`：`id / title / description / pages[] / sections[] / rootSections[]`。
- `WikiCacheData` 只要 `wiki_structure + generated_pages dict`（外加 repo/provider/model）。

> 对比我们的 `WikiPage` 是 9 字段（含 category/tags/source/confidence/summary/tier）——我们的模型更厚，天然承载「引用可溯 + 分层」，不必学它削薄。

### 候选文件选择：单一真源 + 一个值得反着用的启发式

`api/rag/pipeline.py::read_all_documents` 的要点：

- **文件选择只有一个真源**：`iterate_files(...)`（来自 config），支持 `excluded_*` 黑名单与 `included_*` **独占白名单**；读取层只复用不重写。
- 每个文档的 metadata：`file_path / type / is_code / **is_implementation** / title / token_count`。
- `is_implementation` 启发式：排除 `test_`/`app_` 前缀、路径含 `test` → **测试文件被标记为非实现**。
- 超限策略：`token_count > 8192×10` → **整文件跳过**（不是截断）。

> **这条启发式我们应当反着用**：功能挖掘里测试恰恰是「行为证据」的高价值来源（断言即功能契约）。DeepWiki 做的是文档站，剔测试合理；我们做功能页，剔掉测试等于扔掉最硬的行为证据。

### 分块与行号：引用能精确到行的底层机制

`LineTrackingTextSplitter(adalflow.TextSplitter)`（`pipeline.py:174`）：

- token 分块后，按 `chunk.order` 用**保序子串搜索** `text.find(chunk.text, cursor)` 定位块位置（失败退全局搜索，再失败就不写行号）；
- `start_line = text.count("\n", 0, pos) + 1`，`end_line = start_line + chunk 内换行数`；
- 踩坑记录（值得抄进我们的实现笔记）：adalflow 对 parent 的 `meta_data` **只深拷贝一次并在所有 chunk 间共享同一个 dict**，所以必须先给每个 chunk `dict(meta_data)` 再写行号，否则行号互相覆盖。

### 进度是一等公民

`WikiTaskSummary` 直接带 `pages_done / pages_total / current_page_ids / status / error` —— 逐页进度进了 schema，而不是只打日志。我们的启动器若要展示「功能页 3/8 完成」，也该照这个形状设计。

## 关联

方法考古服务于 [[知识库读取触发层设计]] 之外的写入侧能力扩展；融合与引用纪律同源于 [[语义融合会顶掉正确的词面-top1]]（都在强调「证据可溯，不许编」）。

- 功能页：[[capability-知识治理]]