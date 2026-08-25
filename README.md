# dsh-knj-obsidian

DSH（DeepSeek Harness）内简化版 Obsidian：为 AI agent 提供项目级知识库（wiki）的**构建**能力。agent 通过工具把对话、文档、网页等源材料蒸馏为结构化知识页，落盘到项目根目录的 `.wiki/`，形成可复用、可维护的知识资产。

当前为 **v1 构建核心**：写入侧（ingest / capture / lint）已完整，检索、图谱与 UI 列入 v2 路线。

## 安装方式

> 需要 Node.js ≥ 20，且已安装 DSH 宿主（提供 `dsh` CLI 与 `web` profile）。

```bash
# 1. 在插件目录内打包
npm pack

# 2. 在插件目录内执行：安装到 DSH 的 web profile
dsh plugin --profile web add ./dsh-knj-obsidian-2026.8.250.tgz

# 3. 重启 DSH，确认宿主日志无 dsh-knj-obsidian 相关报错
```

安装后插件在 DSH 启动时自动向 agent 暴露工具（`wiki_ingest` / `wiki_capture` / `wiki_lint`），无需额外配置。

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

## v2 路线

- **检索**：基于 `.wiki/` 内容的语义/关键词检索工具，让 agent 能按主题查询已有知识
- **图谱**：页面间 wikilink 知识图谱可视化与结构分析
- **UI**：DSH 内的 wiki 浏览界面（目录 / 页面 / lint 报告面板）

## 开发

```bash
npm run check   # typecheck + build
node --test *.test.mjs   # 全部测试（23 例：smoke / vault-store / tools / ingest-delta / lint）
```

## License

MIT — 见 [LICENSE](./LICENSE)。
