---
name: wiki-capability
description: >
  系统功能挖掘：以工作区代码为源，逆向生成 Obsidian 知识库的「功能知识页」。
  四步流程：入口枚举（确定性）→ 目录结构 + 任务清单 → 串行挖掘（线索导航 → 知识正文）→ 状态机断点续传。
  产物落在 projects/capability-<名>.md，走现有 wiki 生命周期（confidence/tier/wikilink/检索）。
  这是通用知识库——既回答「这个功能怎么实现的」，也回答「改这块要动哪里」。
  本 skill 以 SDD 三件套（project-understanding-business / -wiki / -indexmd bootstrap）的方法论为骨架。
---

# 系统功能挖掘 — 把代码逆向为知识

## 你在做什么

把一个**已有代码库**转换成 **Obsidian 知识库的功能知识页**：每个「功能」一页，一页能回答两件事——

- **问答**：「知识检索是怎么实现的？」「为什么兜底门是 2 不是 3？」
- **改动**：「我要改打分权重，改哪？」「删了 wiki_drill 会断什么？」

**方法论来源**：SDD 三件套（入口枚举 → 目录结构 → 任务清单 → 串行挖掘），适配到 DSH 插件的入口形态。

## 四步流程

```
步骤 1  入口枚举（确定性）        → entries.json
步骤 2  生成功能树与任务清单      → 功能树.md + tasks.yml
步骤 3  串行挖掘（逐功能）         → 线索导航.yml + capability-*.md
步骤 4  状态机维护（断点续传）     → tasks.yml 状态更新
```

**核心纪律**：

1. **功能边界由代码事实决定**——入口清单必须由确定性扫描产出，不许"看看目录猜"
2. **严格串行**——一次只挖一个功能，禁止并行
3. **行号由工具核对**——`Sources: 路径:起-止` 的行号必须由脚本核对，不由模型凭记忆写
4. **只引用实际读过的文件**——禁止引用没打开过的路径
5. **保留测试文件**——测试断言是行为证据最硬的来源

---

## 步骤 1：入口枚举（确定性）

运行脚本扫描工作区，产出入口清单：

```bash
node scripts/enumerate-entries.mjs --project <工作区根> --pretty
```

产出 `.wiki/_system/capability-mining/entries.json`：

```json
{
  "scanned_at": "…",
  "project_root": "…",
  "files_scanned": 46,
  "count": 37,
  "by_type": { "tool": 13, "route": 12, "hook": 4, "frontend-route": 0, "backend-api": 0 },
  "entries": [
    { "type": "tool", "name": "wiki_query", "file": "src/tools.ts", "line": 724 },
    { "type": "route", "name": "/api/obsidian-wiki/search", "file": "src/routes.ts", "line": 210 },
    { "type": "hook", "name": "agent/pre-step", "file": "src/trigger.ts", "line": 1412 }
  ]
}
```

**四类适配器**：

| 适配器 | 扫什么 | 例 |
|---|---|---|
| 工具注册 | `tools.register({ name })` / `defineTool({ name })` | `wiki_query` |
| HTTP 路由 | `webServer.register({ path })` / `router.get()` | `/api/obsidian-wiki/search` |
| 宿主钩子 | `ctx.on('agent/pre-step')` | 触发层四层 |
| 前端路由 / 后端接口 | `path: '/x', component` / `@RequestMapping` | Vue / Java |

## 步骤 2：生成功能树与任务清单

### 2.1 功能树（给人看）

读 `entries.json`，按「入口 → 文件 → 功能簇」聚类，产出 `.wiki/_system/capability-mining/功能树.md`：

```markdown
# 系统功能树 — <项目名>

## 知识检索（4 工具 + 1 路由）
- 入口：wiki_query / wiki_search_semantic / wiki_drill / wiki_read / GET /search
- 模块：src/tools.ts · src/retriever.ts · src/semantic-index.ts · src/semantic-hits.ts · src/drill.ts

## 知识写入（3 工具 + 1 路由）
- 入口：wiki_ingest / wiki_capture / wiki_normalize_tags / POST /import
- 模块：src/tools.ts · src/importer.ts · src/vault-store.ts

## 主动触发（4 钩子）
- 入口：agent/session-start / agent/pre-step / agent/turn-stopping / tools/pre-execute
- 模块：src/trigger.ts
```

**纪律**：功能树里的每个功能，就是任务清单里的一条任务。**严禁合并、遗漏、编造**。

### 2.2 任务清单（给机器用）

```bash
node scripts/generate-task-list.mjs --project <工作区根>
```

产出 `.wiki/_system/capability-mining/tasks.yml`：

```yaml
meta:
  version: "1.0"
  project_root: "D:/dsh-knj/dsh-knj-obsidian"
  generated_at: "2026-10-17 15:00:00"
  total_tasks: 3
  completed: 0
  failed: 0

tasks:
  - index: 1
    function_name: 知识检索
    status: 待挖掘          # 待挖掘 | 挖掘中 | 挖掘完成 | 挖掘失败
    attempt_count: 0
    start_time: null
    end_time: null
    page_id: null
    entries: [wiki_query, wiki_search_semantic, wiki_drill, wiki_read]
    modules: [src/tools.ts, src/retriever.ts, src/semantic-index.ts]

  - index: 2
    function_name: 知识写入
    status: 待挖掘
    ...
```

## 步骤 3：串行挖掘（逐功能）

### 3.1 取下一个任务

```bash
node scripts/process-task.mjs --project <工作区根> get_next
```

输出：

```
=====TASK_INFO=====
index: 1
function_name: 知识检索
attempt_count: 1
modules: src/tools.ts,src/retriever.ts,src/semantic-index.ts,src/semantic-hits.ts,src/drill.ts
=====END=====
```

同时把状态更新为 `挖掘中`、`start_time` 记当前时间、`attempt_count + 1`。

### 3.2 生成线索导航

读该功能涉及的入口文件与模块文件，产出 `.wiki/_system/capability-mining/clue-<功能名>.yml`：

```yaml
overview:
  function_name: 知识检索
  entries:
    - { type: tool, name: wiki_query, file: src/tools.ts, line: 724 }
    - { type: route, name: /api/obsidian-wiki/search, file: src/routes.ts, line: 210 }
  modules:
    - { file: src/tools.ts, symbols: [wiki_query, SEMANTIC_FALLBACK_MIN_CANDIDATES] }
    - { file: src/retriever.ts, symbols: [retrieve, MATCH_SCORE, frontMatch] }
    - { file: src/semantic-index.ts, symbols: [collectionIdOf, runOfflineSearch] }
  related_pages:
    - qmd-全局索引库的跨库噪声与两道防线
    - 语义融合会顶掉正确的词面-top1
```

**纪律**：线索导航是「学什么」的清单——只读这里声明的文件，不读全库。

### 3.3 生成知识页（业务认知理解结构）

按 `templates/业务认知理解模板.md` 写页，产出 `.wiki/projects/capability-<功能名>.md`。

**结构（五节，SDD 原结构）**：

```markdown
---
title: <功能名>
category: projects
tags: [concept]
tier: core
confidence: inferred
source: capability-mining:<功能名>    # ⚠️ 每个功能页用独立 source！共用一个 source 会导致 manifest 的
                                     # pages_produced 被每次覆盖（实测只剩最后 1 页，增量对账失效）
summary: <一句话，≤120 字>
created: <ISO>
updated: <ISO>
---

<details><summary>Relevant source files</summary>
（≥5 个文件）
</details>

## 1. 概念定义
### 1.1 核心概念       ← 表格：概念 | 定义 | 为什么重要
### 1.2 领域概念       ← 表格：术语 | 说明

## 2. 系统事实
### 2.1 系统事实       ← 表格：事实 | 值 | 来源
### 2.2 数据事实       ← 表格：数据 | 位置/形态

## 3. 功能树与入口映射
### 3.1 功能模块结构   ← 缩进树
### 3.2 入口映射表     ← 表格：入口 | 类型 | 必填 | 内核 | 文件:行
### 3.3 使用场景       ← 表格：场景 | 入口 | 理由

## 4. 调用链路总结
### 4.1 主链路图       ← mermaid graph TD
### 4.2 分通道详细流程 ← 代码块（每个通道的步骤）
### 4.3 数据与存储关系 ← mermaid graph TD

## 5. 附录
### 5.1 术语表
### 5.2 参考资料       ← [[wikilink]] 到 concept/pitfall 页

## Sources
（≥5 条 `路径:起-止`，覆盖 ≥3 文件）

```sources
[{"path":"…","hash":"…","symbols":["…"]}]
```
```

### 3.4 行号核对（必做）

```bash
node scripts/check-anchors.mjs --project <工作区根> --page projects/capability-<功能名>.md
```

脚本用 grep 核对每个 `Sources: 路径:行` 的行号是否指向预期符号。**不合格就改，不许手写行号**。

### 3.5 四条不变量检查（必做）

```bash
node scripts/check-capability.mjs --project <工作区根> --page capability-<功能名>.md
```

| # | 判据 | 不过的处置 |
|---|---|---|
| I1 | ≥5 条 `路径:行`，覆盖 ≥3 文件 | **不入库** |
| I2 | ≥2 个 `[[wikilink]]` 指向既有页 | 黄牌 |
| I3 | 标题 Top1；问答式 queries ≥80% 进 Top5 | 黄牌 |
| I4 | `sources` 哈希变化 → stale | 黄牌 |

### 3.6 入库

**批次纪律**（复用 `wiki-distill` / `wiki-collect` 的既有流程）：

1. **还原点**：`wiki_checkpoint` 先建
2. **查重**：`wiki_query` 检索同名/近似页；已有则更新（保留 created）
3. **写前清单**：列出将创建/更新哪些页（信息性预览，不阻塞）
4. **入库**：`wiki_ingest` 逐页写入，带 contentHash
   - ⚠️ **source 必须逐功能独立**：`capability-mining:<功能名>`（不是共用一个 version）
   - 共用 source 会导致 manifest 的 pages_produced 被每次覆盖（实测只剩最后 1 页）
5. **质量报告**：还原点 id、创建/更新清单、查重决策、跳过项

### 3.7 写后补链（必做——打通孤岛子图）

入库后，能力页引用的 concept/pitfall/reference 页**不会自动知道能力页存在**。不补链的后果：
能力页成为孤岛子图——`wiki_drill` 从概念页出发永远走不到功能页。

补法：
1. 读能力页正文里所有 `[[xxx]]` 链接的**目标页**
2. 对每个目标页，在其「关联」或「相关」节（或末尾）追加一行：
   ```markdown
   - 功能页：[[capability-<功能名>]]
   ```
3. 验证：`wiki_lint` 跑一次，确认能力页的入链数 ≥2（含来自非能力页的入链）

## 步骤 4：状态机维护

```bash
# 标记完成
node scripts/process-task.mjs --project <根> update_complete --index 1 --page-id capability-知识检索

# 标记失败
node scripts/process-task.mjs --project <根> update_failed --index 1 --reason "..."

# 断点续跑：把超时的「挖掘中」重置回「待挖掘」
node scripts/process-task.mjs --project <根> reset_timeout --timeout-minutes 10
```

**规则**：

| 规则 | 值 |
|---|---|
| 超时阈值 | 10 分钟（单任务） |
| 超时处置 | 重置 `待挖掘`，`attempt_count + 1` |
| 最大重试 | 3 次，超后 `挖掘失败` |
| 每轮节流 | ≤5 个任务 |
| 执行模式 | 严格串行 |

---

## 上下文管理（避免长任务炸上下文）

1. **分功能独立**：一次一个功能，完成再下一个
2. **分层读取**：入口文件 → 内核文件 → 支撑文件（按线索导航的模块顺序）
3. **增量生成**：先线索导航（结构化）→ 再正文（prose）
4. **只读线索导航里声明的文件**，不读全库
5. **单功能 >10 个文件时拆页**

## Windows 路径与编码纪律

- 所有状态文件用 **Node 脚本**读写（UTF-8 无 BOM），**不用 PowerShell `Set-Content`**
- 路径统一正斜杠 `/`
- 递归枚举用 `fs.readdirSync(withFileTypes)`，不用 shell glob

## 与既有体系的关系

- 产物落 `projects/capability-*.md`，**进现有 vault**
- `index.md` 从能力页 title/summary 自动汇总（不手写目录）
- 概念/踩坑结论仍沉淀回 `concepts/`
- 是插件的**第五个 ingest 通道**
