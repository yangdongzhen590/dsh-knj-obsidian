# M2 设计：数据库表结构挖掘（DB table mining → tables/）

> 状态：设计已与用户确认（2026-08-31）
> 所属：dsh-knj-obsidian 插件（v12）
> 配套：M1 设计《枚举字典挖掘》（docs/2026-08-31-enum-dictionary-mining-design.md）
> 共享第 3 节基础设施（扫描/增量/知识页契约/category 扩展，M1 实施时一次完成）

## 1. 目标与决策

从**当前工作区项目**静态解析数据库表结构（SQL DDL / MyBatis mapper / JPA 实体），每张表产出**独立知识页**（tables 分类），充实系统「数据结构」全貌，供开发 AI 回答「订单表有哪些列、主键是什么、表之间什么关系」类问题。

| 决策 | 结论 |
|---|---|
| 输出粒度 | 逐表独立页 |
| 挖掘目标 | 当前工作区项目（当前 vault 项目根） |
| 落地形态 | 工具 + skill 双通道（wiki_mine 出候选 → wiki-mine skill 蒸馏入库） |
| 存储形态 | **新增 `tables/` 目录**（WikiCategory 扩展），旧 5 类不动 |
| 检索 | 不动 wiki-query skill；检索机制与目录无关 |

## 2. 挖掘源与解析器

`src/code-miner.ts` 新增 `tableMiner`（M1 的 enumMiner 并列，同一模块）。

**来源适配器（Source Adapter）概念**：`tableMiner` 的输入抽象为「表结构候选来源」，每个来源产出一份统一结构的表清单（表名/列/索引/关系 + 来源标注）。**本期只实现文件扫描器**，但解析器与来源解耦，未来新来源零重构：

| 来源 | 适配器 | 状态 |
|---|---|---|
| 代码静态扫描（DDL/mapper/Entity） | `scanFiles()` | **本期实现** |
| MCP 接口查询表结构 | `mcpQuery()`（走 dsh-mcp-client，需凭据/服务配置） | 预留，不实现 |
| 生产导出文件目录（建表 SQL/字典导出到指定目录） | `scanFiles()` 复用（目录扫描 + 文件类型识别） | 预留，配置目录即可，复用现有扫描 |

> 后续接入 MCP 或生产导出时，只需新增适配器 + 工具参数扩展，`tableMiner` 核心解析逻辑不动。

### 2.1 SQL DDL
- `CREATE TABLE` 语句：表名、列（名/类型/可空/默认值/注释 `COMMENT '...'`）、主键 `PRIMARY KEY`、唯一约束
- `CREATE INDEX` / `CREATE UNIQUE INDEX`：索引名、表、列
- `FOREIGN KEY` / `REFERENCES`：外键关系（from 列 → to 表.列）

### 2.2 MyBatis mapper XML
- `<table>` 引用、`<resultMap>`/`<sql>`/`<insert>/<update>/<select>` 中的列名
- 作为 DDL 缺失时的补充来源（列名 + 映射）

### 2.3 JPA @Entity
- `@Table(name=...)` + `@Column(name=..., nullable=...)` + `@Id` + `@ManyToOne` 关系
- 作为 DDL 缺失时的补充来源

### 2.4 优先级与合并
- DDL 为准（类型/约束最全）；mapper/JPA 补充关系与业务注释
- 同一表多个来源 → 合并；来源冲突 → DDL 优先
- 未来 MCP/生产导出作为高优先级来源（真实结构 > 代码推断），接入时在适配器层标注优先级

### 2.5 模块名
- 源文件相对路径首段（`src/main/resources/db/migration/...` → `module:db`；mapper 所在包 → 包首段）；无则 `module:core`

解析器为**轻量结构扫描**（正则+括号匹配+XML 标签配对，非全量 AST），千级文件秒级、可按文件批并行。

## 3. 共享基础设施（M1 第 3 节，此处引用）

- 扫描：复用 EXCLUDE_DIRS（+.svn）、ImportLimits、按文件批并发、失败跳过
- 增量：manifest 文件级哈希（source = `mine:db:<相对路径>`）
- 知识页契约：category = `tables`；tags = `table` 或 `db` + `module:<模块名>`；confidence = `extracted`；id = 表名 kebab-case
- category 扩展：M1 实施时一次完成（types/vault-store/index-builder/LintPanel/GraphView/styles/tools），M2 直接使用

## 4. 双通道管道

### 4.1 工具：`wiki_mine`
- 参数：`{ kind: 'enum'|'db'|'both', module?: string }`
- 行为：`kind='db'` 时 `tableMiner` 扫描 → 返回候选目录 JSON（表 + 列 + 索引 + 关系 + 源文件哈希）
- 空结果：返回 `{ tables: [], note: '当前项目未发现 DDL/mapper/Entity' }`，不报错

### 4.2 skill：`wiki-mine`
1. 确认范围（module 过滤可选）
2. 调用 `wiki_mine` 取候选目录
3. 蒸馏：按表生成结构页（列清单表格 + 主键/索引/关系小节），带 [[wikilink]] 交叉引用
4. `wiki_ingest` 入库（source=`mine:db:...`）
5. 收尾：重建索引 + 报告

## 5. 规模化：两阶段 + 断点续传（与 M1 同构，见 M1 §5）

- **两阶段**：A 大纲（模块清单 + 每模块 DDL/mapper/Entity 文件数 + 表预估数 → `outline.json`，秒级）→ B 细节（按模块分批解析入库，单批有界）
- **断点续传**：`progress.json` 模块级 state（pending|done|partial）+ manifest 文件级哈希 + wiki_ingest contentHash 三层
- `wiki_mine` 参数：`{ kind:'db', module?, resume? }`；每模块完成后回写 progress，中断最多丢一个模块
- 大纲页入库（references，`module:system-outline`）作为系统全貌入口
- 单批模块数上限默认 10

## 6. 错误处理

| 场景 | 行为 |
|---|---|
| 无法解析的 SQL/XML | 跳过并标注，不中断 |
| 项目无任何表来源 | 报告 0 结果，不报错 |
| 大表列数超阈值（>40） | 截断并标注「已截断，共 N 列」 |
| DDL 与 mapper 冲突 | DDL 优先，catalog 标注冲突 |
| 无模块信息 | `module:core` |
| 中断（进程被杀） | 进度最多丢一个模块，resume 从该模块重挖 |

## 7. 测试

- `code-miner.test.mjs`：fixtures（样例 DDL、mapper XML、@Entity）红→绿
- 合并逻辑单测：多来源同表 → 合并、冲突 → DDL 优先
- `tools.test.mjs`：wiki_mine kind='db' 参数校验、空结果、resume 行为
- progress.json 读写与中断恢复单测
- 增量：同源文件二次挖掘 → skipped

## 8. 非目标（M2 不做）

- **连库直采**（information_schema 直连数据库）——延后，后续优先走 MCP 接口或生产导出文件（见第 2 节来源适配器预留）
- ER 关系图谱页（本期只产文字关系小节）
- 其他方言（PostgreSQL/Oracle 专有语法）——先覆盖 MySQL/标准 SQL 子集，解析器留扩展位

## 9. 开放问题

- MCP 适配器的具体接口契约（哪个 MCP 服务、返回结构）——等用户提供 MCP 配置后再定
- 生产导出文件的约定目录与文件格式（纯 SQL dump / 字典导出 CSV）——等用户提供样例后再定
