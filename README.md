# dsh-knj-obsidian

DSH（DeepSeek Harness）内简化版 Obsidian：为 AI agent 提供项目级知识库（wiki）的**构建**能力。agent 通过工具把对话、文档、网页等源材料蒸馏为结构化知识页，落盘到项目根目录的 `.wiki/`，形成可复用、可维护的知识资产。

当前版本为 **v1 构建核心 + v2 检索**：写入侧（ingest / capture / lint）已完整；检索侧提供 `wiki_query` 工具与 `wiki-query` skill 双通道（见下文「v2：检索」）；图谱与 UI 仍在 v2 路线中。

## 安装方式

> 需要 Node.js ≥ 20，且已安装 DSH 宿主（提供 `dsh` CLI 与 `web` profile）。

```bash
# 1. 在插件目录内打包
npm pack

# 2. 在插件目录内执行：安装到 DSH 的 web profile
dsh plugin --profile web add ./dsh-knj-obsidian-2026.8.252.tgz

# 3. 重启 DSH，确认宿主日志无 dsh-knj-obsidian 相关报错
```

安装后插件在 DSH 启动时自动向 agent 暴露工具（`wiki_ingest` / `wiki_capture` / `wiki_lint` / `wiki_query`），并随包分发 `wiki-query` skill，无需额外配置。

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

## v2 路线

- ~~**检索**~~ ✅ 已上线：`wiki_query` 工具 + `wiki-query` skill 双通道分层检索
- **图谱**：页面间 wikilink 知识图谱可视化与结构分析
- **UI**：DSH 内的 wiki 浏览界面（目录 / 页面 / lint 报告面板）

## 开发

```bash
npm run check   # typecheck + build
node --test *.test.mjs   # 全部测试（46 例：smoke / vault-store / tools / ingest-delta / lint / retriever / wiki-query-tool / wiki-query-skill）
```

## License

MIT — 见 [LICENSE](./LICENSE)。
