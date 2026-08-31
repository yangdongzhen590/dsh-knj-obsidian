---
name: wiki-mine
description: >
  从当前工作区项目静态挖掘代码结构（枚举字典/表结构）进知识库。用户说"挖掘枚举字典"、
  "把系统的表结构整理进知识库"、"挖代码结构"、"wiki-mine" 时使用。大纲→细节两阶段，
  每次运行输出对账报告（new/changed/unchanged/deleted），支持断点续传。入库经 wiki_ingest
  工具（不要手写 .wiki 文件）。
---

# Wiki Mine — 代码结构挖掘进知识库

把当前工作区项目的**静态骨架知识**（枚举字典 / 表结构）确定性解析后蒸馏入库。
与 wiki-distill（会话蒸馏）互补：会话是"发生了什么"，代码结构是"系统由什么构成"。
只读扫描代码，**写入一律经 wiki_ingest**（不要手写 .wiki 文件）。

## 第 0 步：确认范围（必做）

- 挖掘类型：enum（枚举字典）/ db（表结构，M2 实现）/ both
- 模块过滤：默认全项目；大系统建议按模块迭代（先 outline 看规模再选模块）
- 断点续传：上次未挖完时确认是否 resume

## 第 1 步：大纲（了解全貌与规模）

调用 `wiki_mine { kind, resume? }` 读 outline：
- outline 列出模块清单 + 每模块文件数 + 枚举预估数
- 若大纲显示模块很多，与用户确认本批模块范围（单批 ≤10 模块）

## 第 2 步：细节（按批挖掘）

对选定模块调用 `wiki_mine { kind, module }` 取候选目录（含源文件路径、行号、哈希）。
对账报告含义：`new`=未挖掘、`changed`=有变化需重挖、`unchanged`=挖过无变、`deleted`=代码已删（孤儿页候选）。
表结构（kind=db）对应用 `dbNew`/`dbChanged`/`dbUnchanged`/`dbDeleted`。

### 表结构挖掘（kind=db）
1. 调 `wiki_mine { kind: 'db', module? }` 取表候选（对账报告同枚举）
2. 每张表一页：category=tables，tags=[table, module:<模块名>]
3. 正文：列清单表格（列 | 类型 | 可空 | 注释 | 主键）+ 索引小节 + 外键关系小节 + 来源行号
4. source = `mine:db:<相对路径>`；contentHash = 源文件哈希（候选 hash 字段）
5. 只处理 dbNew + dbChanged；dbUnchanged 跳过；dbDeleted 报告孤儿表页
6. 多来源合并已由工具完成（DDL 优先、mapper/JPA 补充），蒸馏时用合并后的列清单

## 第 3 步：蒸馏（模型工作）

按枚举/常量类逐个生成字典页：
1. 每页一个枚举/常量类（**逐枚举独立页**，不合并）
2. 正文用值表格：`| 名称 | 编码 | 说明 |`（无编码枚举则两列）
3. 附来源（文件路径 + 声明行号）；category=dictionaries，tags=[enum, module:<模块名>]
4. 常量类挖出的普通常量：无字典价值的人工筛掉，只留业务码值
5. **只处理 new + changed**；unchanged 静默跳过；deleted 报告给用户确认是否清理孤儿页

## 第 4 步：入库（wiki_ingest）

- source = `mine:enum:<相对路径>`（每文件一个 source）
- contentHash = 源文件内容 SHA-256（可让 agent 计算或由 wiki_mine 返回的 hash 字段提供）
- confidence = extracted；页面 id = 枚举名 kebab-case

## 第 5 步：收尾

- 每模块完成后调用 `wiki_mine { kind, resume: true }` 确认进度推进
- 全部完成后建议用户点「重建索引」让 index.md 覆盖新分区（## 字典）
- 报告：`本批 N 模块（K 完成）→ 产 M 页 → 剩 J 模块待挖；new X / changed Y / deleted Z`
