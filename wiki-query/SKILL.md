---
name: wiki-query
description: >
  Answer questions by searching the compiled Obsidian wiki (.wiki/). Use this skill
  when the user asks about their knowledge base, "what do I know about X",
  "find everything related to Y", or wants synthesized answers with citations
  from their wiki pages. Also use for multi-hop questions ("how is X connected
  to Y"). Works from any project. READ-ONLY — never create or modify pages.
---

# Wiki Query — 分层检索知识库

你在对已编译的 wiki（`<项目根>/.wiki/`，纯 Markdown 知识库）做检索，而不是原始源文档。
wiki 里是预合成、交叉引用的知识页。**本 skill 只读**：不得创建/修改任何页面。
若用户想记录新知识，路由到 wiki-ingest / wiki-capture。

## 检索前

1. 解析 vault 路径：当前项目根目录下找 `.wiki/`（`OBSIDIAN_VAULT_PATH` 或 `ls -a` 找 `.wiki`）。
2. 若 `.wiki/index.md` 存在，先读它了解全库结构（快速层）。

## 分层检索

### L1 — index 快速层（≤1 次读；等价于工具 mode=index-only）
读 `index.md`，找包含查询词的行。**auto 模式下 L1 只是预热扫描**：命中后不要命中即停，
仍继续 L2 用标题/标签核对更强者（与 `wiki_query` 工具 auto 模式一致——工具不从 index 起步，
L2 才会产生候选）；只有当显式走 index-only 快速路径时，L1 命中才直接作为结果。

### L2 — 标题 + 标签层（grep；命中即停）
用 grep 在 `.wiki/*/` 下搜标题与 frontmatter 标签：
```bash
grep -ri "<query>" .wiki/*/ --include="*.md" -l   # 或按需限定目录
```
对命中文件，读 frontmatter 的 `title` / `tags` / `confidence`。L2 命中后停止，不升 L3。

### L3 — 正文层（按需）
L2 无果时，读候选文件正文找查询词；截取命中上下文 ≤200 字符作为 snippet。
正文命中时，同时读该页的 `[[wikilink]]` 出链，把一跳邻居也列为关联候选（L4）。

### L4 — 图谱邻居（增强）
解析命中的页面的 `[[链接]]`，取其一跳邻居页面作为关联候选，注明「关联」。

## 合成答案

基于候选页合成回答，**必须带引用**（页面路径 + confidence 标记：
extracted=读到 / inferred=推测 / ambiguous=矛盾）。
回答结构：结论 + 支持页列表 + 每条引用的 snippet。

## 无匹配

返回「wiki 无匹配」，并建议「把 XX 吸收进 wiki」来添加知识。

## 只读约束

本 skill 不得写任何文件（含 log.md）。发现新知识时，路由到 wiki-capture / wiki-ingest。
