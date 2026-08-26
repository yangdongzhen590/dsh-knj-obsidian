# dsh-knj-obsidian

DSH（DeepSeek Harness）内简化版 Obsidian：为 AI agent 提供项目级知识库（wiki）的**构建**能力。agent 通过工具把对话、文档、网页等源材料蒸馏为结构化知识页，落盘到项目根目录的 `.wiki/`，形成可复用、可维护的知识资产。

当前版本为 **v1 构建核心 + v2 检索 + v3 图谱导出 + v4 UI**：写入侧（ingest / capture / lint）已完整；检索侧提供 `wiki_query` 工具与 `wiki-query` skill 双通道（见下文「v2：检索」）；图谱侧提供 `wiki_export` 工具导出交互图谱与结构化图数据（见下文「v3：图谱导出」）；UI 侧提供右侧边栏"知识库"标签 + 笔记/图谱工作台（见下文「v4：UI」）。

## 安装方式

> 需要 Node.js ≥ 20，且已安装 DSH 宿主（提供 `dsh` CLI 与 `web` profile）。

```bash
# 1. 在插件目录内打包
npm pack

# 2. 在插件目录内执行：安装到 DSH 的 web profile
dsh plugin --profile web add ./dsh-knj-obsidian-2026.8.257.tgz

# 3. 重启 DSH，确认宿主日志无 dsh-knj-obsidian 相关报错
```

安装后插件在 DSH 启动时自动向 agent 暴露工具（`wiki_ingest` / `wiki_capture` / `wiki_lint` / `wiki_query` / `wiki_export`），并随包分发 `wiki-query` skill，无需额外配置。

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
├── _raw/             # 原始材料暂存
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

## 路线

- ~~**检索**~~ ✅ 已上线：`wiki_query` 工具 + `wiki-query` skill 双通道分层检索
- ~~**图谱**~~ ✅ 已上线：`wiki_export` 工具导出交互图谱（graph.html）与结构化数据（graph.json）
- ~~**UI**~~ ✅ 已上线：右侧边栏"知识库"标签 + 笔记/图谱工作台（v4）
- **编辑**：笔记编辑模式（v5 候选）
- **历史会话挖掘**：DSH 会话 → 知识页（v5 候选）

## 开发

```bash
npm run check   # typecheck + build
node --test *.test.mjs   # 全部测试（74 例：smoke / vault-store / tools / ingest-delta / lint / retriever / graph-engine / wiki-export-tool / wiki-query-tool / wiki-query-skill / routes / client-build / client-api / markdown / graph-view）
```

## License

MIT — 见 [LICENSE](./LICENSE)。
