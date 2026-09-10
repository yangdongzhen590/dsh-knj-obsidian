---
name: wiki-collect
description: >
  把当前工作区项目的代码结构知识（枚举/常量字典、SQL DDL/MyBatis/JPA 表结构）
  采集进知识库：联动存量知识对账后蒸馏并直接入库。用户说"采集代码结构"、
  "把工程的枚举/字典收进知识库"、"wiki-collect"、或边栏启动器触发时使用。
  扫描用 wiki_mine，入库用 wiki_ingest，不要手写 .wiki 文件。
---

# Wiki Collect — 代码结构采集进知识库

把当前工作区项目的**静态骨架知识**（枚举字典 / 表结构）确定性解析、与存量知识对账后
蒸馏入库。与 wiki-distill（会话蒸馏）互补：会话是"发生了什么"，代码结构是"系统由什么构成"。

**授权模型**：本 skill 由用户显式触发（GUI 启动器点击 = 已授权），按用户决策**直接入库、
不做二次确认**；知识库将来纳入 git 分支合并把关（预留，未实现），需要先于写入做全量对账
与报告，让用户随时可打断。扫描只读；写入一律经 `wiki_ingest`。

## 第 0 步：确认范围（必做）

- 采集类型：`enum`（枚举/常量字典）/ `db`（表结构）/ `both`
- 工作区 = 当前会话 cwd（与活动 vault 一致）；大系统按模块分批（单批 ≤10 模块，outline 先行）
- 断点续传：上次未挖完时确认是否 resume

## 第 1 步：扫描 + 对账（联动存量知识）

调用 `wiki_mine { kind, module?, resume? }`：
- 枚举/常量：`new`=未入库、`changed`=有变化需重挖、`unchanged`=库内已有同哈希、`deleted`=代码已删
- 表结构（kind=db）对应 `dbNew/dbChanged/dbUnchanged/dbDeleted`
- **联动存量**：对每个待处理候选，先用 `wiki_query` 检查是否已有同名/近似页；有则核对
  是否需要更新（同源同哈希=unchanged 跳过；内容变化=changed 更新本页）并保留原 created

## 第 2 步：蒸馏（模型工作，只处理 new + changed）

### 枚举/常量（每枚举/常量类独立一页）
1. 每页一个枚举/常量类，category=dictionaries，tags=[enum, module:<模块名>]
2. 正文值表格：`| 名称 | 编码 | 说明 |`（无编码则两列）
3. 附来源：文件路径 + 声明行号
4. 常量类中无字典价值的普通常量人工筛掉，只留业务码值
5. deleted 只报告，不删页（等用户决定）

### 表结构（每表一页）
1. 每表一页，category=tables，tags=[table, module:<模块名>]
2. 正文：列清单表格（列 | 类型 | 可空 | 注释 | 主键）+ 索引小节 + 外键小节 + 来源行号
3. 多来源合并已由工具完成（DDL 优先、JPA/mapper 补充）；未知/推断值保持 unknown/inferred

## 第 3 步：入库（wiki_ingest，直接写入）

- source = `mine:enum:<相对路径>` 或 `mine:db:<相对路径>`（每文件一个 source）
- contentHash = 候选 hash 字段（增量跳过、重复不写）
- confidence = extracted（确定性解析）；**不得把推断/未知写成事实**
- 本 skill 不做二次确认：对账与蒸馏结果已在此报告中列出，用户可随时打断

## 第 4 步：收尾

- 每模块完成后 `wiki_mine { kind, resume: true }` 确认进度推进
- 建议用户「重建索引」让 index.md 覆盖新分区（## 字典 / ## 数据结构）
- 报告：`本批 N 模块 → new X / changed Y / unchanged U / deleted Z；已入库 M 页；剩 J 模块待挖`

## 范围边界（不得逾越）

- 仅支持：Java enum、Java public static final、SQL DDL、MyBatis XML、JPA Entity
- 不支持：TypeScript/Python/Go/任意 ORM/JSON Schema；不得声称扫描过它们
- 只读工作区代码文件；**不得读取 .dsh 会话归档/日志等非代码源**
- 库内已有他源页面同 id 时由 wiki_ingest 自动 `-2` 避让，不得覆盖
