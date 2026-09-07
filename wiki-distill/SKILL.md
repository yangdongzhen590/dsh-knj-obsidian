---
name: wiki-distill
description: >
  Distill recent DSH agent sessions into the Obsidian wiki (.wiki/) as incremental
  knowledge pages. Use this skill when the user says "蒸馏近期会话", "把最近的对话
  整理进知识库", "wiki-distill", or clicks the "蒸馏近期会话" sidebar button and
  pastes the trigger. ALWAYS confirm the scope (time range + project) with the user
  BEFORE extracting. Ingests via the wiki_ingest tool with contentHash so repeated
  runs skip unchanged sources automatically.
---

# Wiki Distill — DSH 会话蒸馏进知识库

把 `~/.dsh/sessions/` 下的会话转录解码、去重、脱敏后蒸馏成 wiki 知识页。**写路径 skill**：
产出经 `wiki_ingest` 工具入库（不要手写 .wiki 页面文件）。

## 第 0 步：确认范围（必做，不得跳过）

向用户确认两点（给出默认建议让用户确认或修改）：

- **时间范围**：默认建议「近 3 天」（可改近 7 天 / 近一周 / 全部）
- **项目范围**：默认建议「当前项目」（按 cwd 过滤；可加全部项目）

用户确认后才继续。用户说「就按默认」即用默认。

## 第 1 步：落位提取器

提取器随本 skill 分发（`wiki-distill/extract-dsh-sessions.cjs`）。规则：

- 若 `<vault>/_system/tools/extract-dsh-sessions.cjs` **不存在** → 从 skill 目录复制过去（用文件工具，逐字节复制，禁止改写内容）
- 若**已存在** → 用 vault 版本（用户可能自行改进过）
- vault 根：当前项目根目录下的 `.wiki/`（与宿主 process.cwd 一致；找不到就 `ls -a` 确认）

提取器带自测（`*.test.cjs` 同目录），首次落位后可跑一次 `node --test` 确认 5/5 绿。

## 第 2 步：提取

```bash
node <vault>/_system/tools/extract-dsh-sessions.cjs <sessions根> <vault>/_system/dsh-sessions [项目过滤] [最早mtime]
```

- sessions 根：`~/.dsh/sessions`（Windows：`%USERPROFILE%\.dsh\sessions`）
- 项目过滤：目录名形如 `--D-workspace-<项目>--`（路径转义形态）；当前项目 = cwd 盘符与路径替换 `:` `\` `/` 为 `-` 后两端加 `--`。不确定就先 `ls` sessions 根看目录名
- 最早 mtime：ISO 时间（如 `2026-08-24T00:00:00+08:00`）
- 产物：`catalog.json`（全部会话元数据：顶层/子代理、标题、时间、digestFile）+ `sessions/*.md` 摘要

技术要点（提取器已内建）：zstd 多帧流式解码（Node 24 zlib）、顶层判定 delegationDepth=0、
子代理只留最终报告、`<system-reminder>` 注入清洗、密钥/token/Bearer 正则脱敏。

## 第 3 步：蒸馏（模型工作，无脚本）

读 catalog.json，按 `role=top` 的会话逐个读摘要（`digestFile` 指向的 md）：

1. **判主题**：把会话按主题聚类（插件演进 / 踩坑手册 / 决策记录 / 方法论…），不按时间罗列
2. **宁缺毋滥**：纯噪音会话（无标题且无实质内容，catalog 里已标 skipped）不蒸馏；
   无信息量的小修会话只在索引页留一行
3. **写用户会遇到什么**：知识页写结论与复现路径，不写对话过程；每页 2-5 个小节，带 `[[wikilink]]` 交叉引用
4. **必产出两页**：
   - 按主题的综合页（若干张，category 按内容定：concepts/entities/references）
   - 会话索引页（references）：时间 | 会话标题 | 结果 | 蒸馏去向，作为溯源清单

## 第 4 步：入库（wiki_ingest 工具）

- `source`：`agent:session-distill-<起始日期>_<结束日期>`（如 `agent:session-distill-2026-08-24_26`）
- `contentHash`：catalog.json 文件的 SHA-256（重复蒸馏同范围且无新会话 → 整体自动跳过）
- 页面 id：kebab-case 或中文语义 id（SAFE_ID_RE 允许 CJK）
- confidence：会话里实证过的事实用 `extracted`；推断性结论 `inferred`

## 第 5 步：收尾

- 建议用户在边栏点「重建索引」让 index.md 覆盖新页（或 agent 直接调用）
- 报告：蒸馏了几个会话 → 产出几张页 → 增量跳过情况
