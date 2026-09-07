# M1 设计：枚举字典挖掘（enum dictionary mining → dictionaries/）

> 状态：设计已与用户确认（2026-08-31）
> 所属：dsh-knj-obsidian 插件（v12）
> 配套：M2 设计《数据库表挖掘》（docs/2026-08-31-db-table-mining-design.md），两份共享第 3 节基础设施

## 1. 目标与决策

从**当前工作区项目**静态解析枚举声明与常量类，每个枚举/常量类产出**独立知识页**（dictionaries 分类），充实系统「枚举字典」全貌，供开发 AI 回答「系统有哪些枚举值、某状态码含义」类问题。

| 决策 | 结论 |
|---|---|
| 输出粒度 | 逐枚举独立页 |
| 挖掘目标 | 当前工作区项目（当前 vault 项目根） |
| 落地形态 | 工具 + skill 双通道（wiki_mine 出候选 → wiki-mine skill 蒸馏入库） |
| 枚举范围 | Java `enum` 声明 + `public static final` 常量类 |
| 存储形态 | **新增 `dictionaries/` 目录**（WikiCategory 扩展），旧 5 类不动 |
| 检索 | 不动 wiki-query skill；检索机制与目录无关（L1 index 重建覆盖新分区、L2 全库 grep 自然命中） |

## 2. 挖掘源与解析器

`src/code-miner.ts` 新增 `enumMiner`：

- **enum 声明**：`public enum X { A("code","说明"), B("code2","说明2") }`
  - 提取：枚举名、包/模块、全部枚举项 { 名称, code, 说明 }、源文件+行号
- **常量类**：`public static final String/Integer X = ...` + 相邻注释
  - 提取：类名、常量名、值、注释、源文件+行号
- 无值单名枚举（`A, B, C`）也收录（名称即值）
- 包名 → 模块名：包名首段（如 `com.pingan.iobs.order` → `module:order`）；无包时 `module:core`

解析器为**轻量结构扫描**（正则+括号匹配，非全量 AST），千级文件秒级、可按文件批并行。

## 3. 共享基础设施（M1 与 M2 共用）

### 3.1 扫描
- 复用 importer 的 `EXCLUDE_DIRS`（node_modules/target/dist/.git/.wiki/__pycache__），新增 `.svn`
- 文件遍历带 `ImportLimits`（文件数/字节/深度上限），异常项目不撑爆
- 按文件批解析（Promise 并发），单文件失败只跳过并记录

### 3.2 增量
- manifest 按**文件级**内容哈希（source = `mine:enum:<相对路径>`），未变更文件重复挖掘零开销
- 复用 `wiki_ingest` 的 contentHash 管道

### 3.3 知识页契约
- category = `dictionaries`（新增）
- tags = `enum` 或 `dict` + `module:<模块名>`
- source = `mine:enum:<相对路径>`
- confidence = `extracted`
- id = 枚举名/常量类名的 kebab-case（经 SAFE_ID_RE 净化）
- 正文：值表格（名称 | 编码 | 说明）+ 来源行号

### 3.4 category 扩展（dictionaries + tables 一次性改动）

| 文件 | 改动 |
|---|---|
| `src/types.ts` | `WikiCategory` 联合类型 + `'dictionaries' \| 'tables'` |
| `src/vault-store.ts` | `CATEGORIES` 数组 +2 |
| `src/index-builder.ts` | `SECTION_TITLES` +2 分区（## 字典、## 数据结构） |
| `src/client/LintPanel.tsx` | 导入分类下拉 +2 项 |
| `src/client/GraphView.tsx` | 图谱着色 CATEGORY_CLASS/LABELS +2 色 |
| `src/client/styles.ts` | `--knj-cat-*` 色标 +2 |
| `src/tools.ts` | wiki_ingest category 参数校验放宽到新枚举 |

> 注意：本改动两个里程碑共用，M1 实施时一次完成，M2 只写解析器。

## 4. 双通道管道

### 4.1 工具：`wiki_mine`
- 参数：`{ kind: 'enum'|'db'|'both', module?: string }`
- 行为：扫描当前 vault 项目根 → `enumMiner` 解析 → 返回候选目录 JSON（含源文件+内容哈希）
- 空结果：返回 `{ enums: [], note: '当前项目未发现枚举声明或常量类' }`，不报错

### 4.2 skill：`wiki-mine`
1. 确认范围（module 过滤可选，默认全项目）
2. 调用 `wiki_mine` 取候选目录
3. 蒸馏：按枚举生成字典页（值表格），带 [[wikilink]] 交叉引用
4. `wiki_ingest` 入库（source=`mine:enum:...`，contentHash=源文件哈希）
5. 收尾：重建索引 + 报告（挖 N 个枚举 → 产 M 页 → 增量跳过 K）

## 5. 规模化：大纲→细节两阶段 + 断点续传（用户需求：工程可能很大，一次扫不完）

### 5.1 两阶段挖掘

| 阶段 | 产出 | 成本 |
|---|---|---|
| **A 大纲**（overview） | 系统全貌：模块清单 + 每模块源文件数 + 枚举预估数 → `outline.json` | 目录遍历 + 文件名粗扫，秒级 |
| **B 细节**（detail） | 按模块分批：每批产出枚举候选 → 蒸馏入库 | 逐文件解析，单批有界 |

skill 流程：先跑大纲（了解全貌与规模）→ 选定一批模块 → 跑细节 → 入库 → 再下一批。**单次运行只处理一批**，由用户决定批大小。

### 5.2 断点续传与对账（核心：每次挖掘 = 全量扫描 vs manifest 的对账）

**事实源收敛**：对账以 **manifest 为准**（文件级 content_hash 已存在，是唯一事实源）；`progress.json` 仅作大纲→细节分批的断点辅助，不承担状态判定。

每次 `wiki_mine` 运行：全量扫描代码（得到「应有集合」：当前所有枚举 + 文件哈希）↔ 对账 manifest（「已有集合」：上次入库时每源文件哈希）→ 输出**枚举级对账报告**：

| 状态 | 判定 | 处理 |
|---|---|---|
| `new`（未挖掘） | 代码有、manifest 无记录 | 蒸馏入库 |
| `unchanged`（挖过无变） | 代码有、哈希一致 | 静默跳过 |
| `changed`（有变化） | 代码有、哈希不一致 | 重新蒸馏更新 |
| `deleted`（代码已删） | manifest 有、代码无 | 孤儿页候选，引导清理 |

幂等：跑 N 次与跑 1 次结果一致，每次只动 `new + changed`，天然断点续传。回答用户三问：未挖=`new`、已挖=`unchanged`、需修正=`changed`。

`wiki_mine` 输出结构：`{ enums, new, changed, unchanged, deleted, outline, modules, remaining, note }`；skill 只处理 `new + changed`。

三层机制（对账报告为枚举级主视图，manifest 为其底层数据）：

| 层 | 机制 | 作用 |
|---|---|---|
| 枚举级 | **对账报告**（manifest 哈希 vs 当前扫描） | 未挖/已挖/有变/已删，一次回答 |
| 文件级 | manifest 内容哈希（source = `mine:enum:<相对路径>`） | 对账的底层数据 |
| 页级 | `wiki_ingest` contentHash | 蒸馏入库阶段重复跳过 |

- skill 收尾报告：`本批 N 模块（K 完成）→ 产 M 页 → 剩 J 模块待挖`
- 中断安全：单文件原子解析、进度在每模块完成后回写（非每文件），中断最多重挖一个模块

### 5.3 有界性

- 单批模块数上限（默认 10，可配）；单批文件数/字节沿用 ImportLimits
- 大纲页也入库（references 分类，`module:system-outline`），成为「系统全貌」入口页，随进度更新

## 6. 错误处理

| 场景 | 行为 |
|---|---|
| 无法解析的文件 | 跳过并标注，不中断 |
| 项目无枚举 | 报告 0 结果，不报错 |
| 常量类挖到普通常量 | 接受（已确认），蒸馏时人工筛 |
| 枚举项过多（>50） | 分两页或截断标注 |
| 中断（进程被杀） | 进度最多丢一个模块（模块完成才回写），下次 resume 从该模块重挖 |

## 7. 测试

- `code-miner.test.mjs`：fixtures（样例 enum 文件、常量类文件）红→绿
- `tools.test.mjs`：wiki_mine 参数校验、空结果、module 过滤、resume 行为（pending 模块重挖 / done 模块跳过）
- progress.json 读写与中断恢复单测
- 增量：同源文件二次挖掘 → skipped
- `wiki-query` skill 测试：断言**未改动**（回归保护）

## 8. 非目标（M1 不做）

- TypeScript/C#/Python 枚举（解析器留注册表扩展位）
- 连库直采
- 表结构挖掘（见 M2）
