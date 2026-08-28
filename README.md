# dsh-knj-obsidian

DSH（DeepSeek Harness）内简化版 Obsidian：为 AI agent 提供项目级知识库（wiki）的**构建**能力。agent 通过工具把对话、文档、网页等源材料蒸馏为结构化知识页，落盘到项目根目录的 `.wiki/`，形成可复用、可维护的知识资产。

当前版本为 **v1 构建核心 + v2 检索 + v3 图谱导出 + v4 UI + v5 笔记编辑**：写入侧（ingest / capture / lint）已完整；检索侧提供 `wiki_query` 工具与 `wiki-query` skill 双通道（见下文「v2：检索」）；图谱侧提供 `wiki_export` 工具导出交互图谱与结构化图数据（见下文「v3：图谱导出」）；UI 侧提供右侧边栏"知识库"标签 + 笔记/图谱工作台（见下文「v4：UI」）；v5 起笔记工作台支持富渲染、双链原地跳转、源码视图与全文编辑（见下文「v5：笔记编辑」）。

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

## v5：笔记编辑

v5 解决笔记工作台的四个体验缺口（富渲染 / 双链导航 / 源码视图 / 编辑保存）：

- **富渲染**：markdown 管线升级为 marked 解析（含 wikilink 内联扩展，解析期直接产出锚点 token）+ DOMPurify 白名单净化（表格、引用块、任务列表、外链、分隔线全支持；代码块内的 `[[x]]` 按字面呈现）
- **双链原地导航**：点击 `[[wikilink]]` 在当前工作台原地切页，带访问历史栈与「← 返回」按钮；目标不存在时提示断链且不离开当前页
- **源码视图**：笔记页「预览 / 源码」切换；源码态展示磁盘原文（含 frontmatter，逐字节）+ 一键复制
- **全文编辑**：源码态可直接编辑整份文件（含 frontmatter，可改 title/tags）并保存；保存走 `POST /api/obsidian-wiki/page`
- **保存安全**：服务端校验路径合法性（防穿越）与 frontmatter 一致性（id/category 与目标不符即 422 拒绝，磁盘不动）；原子写（临时文件 + rename）；写端点仅接受同源请求（Origin/Referer 校验，跨站 403）+ 仅 JSON（415）
- **保存后联动**：边栏树与 lint 徽标经 `wiki:pages-changed` 事件自动刷新

## v6：增量构建

知识库的增量构建从「只能靠对话」升级为 UI 内一键完成：

- **一键重建索引**：边栏「重建索引」→ `POST /rebuild-index`，从全部页面重生成 index.md（`- [[id]] 标题 — 摘要` 格式，retriever L1 零迁移兼容）。index.md 是派生工件——重建会覆盖手工注释，想保留的内容请写进页面本身
- **导入现有 md**：边栏路径框（文件或目录）+ 分类选择 → `POST /import`。递归收集 .md（排除 node_modules/.git/target/dist，≤500 文件、单文件 ≤1MB、深度 ≤12）；已有合法 frontmatter 按声明原样入库，缺失的自动补全（id=文件名净化、title=首个标题、source=import:原路径）；id 冲突自动加 `-2` 后缀不覆盖；重导幂等（未变跳过、已变更新）；**源文件只读**
- **lint 详情速修**：lint 徽标点击展开面板——断链/孤儿页/缺 frontmatter 逐条可点；断链打开来源页（修链在来源页），其余打开对应页，直接进源码态修
- **会话蒸馏**：随包分发 `wiki-distill` skill（内嵌 zstd 多帧会话提取器，首次运行落位 `<vault>/_raw/_tools/`，vault 已有则用 vault 版）；边栏「蒸馏近期会话」按钮复制触发指令到剪贴板，粘贴到对话发送即可。skill 流程：确认范围（默认近 3 天当前项目）→ 提取 → 按主题蒸馏 → `wiki_ingest` 入库（contentHash 增量，重复源自动跳过）
- **新端点安全**：两个新写端点沿用 v5 模式（同源 403 / 非 JSON 415）；import 对源路径只读，写入落点经 SAFE_ID 净化 + vault 包含性双校验

## v7：多 vault 管理

v7 解决「本地有几个库看不出来、没有切换/维护入口」：

- **当前库身份可见**：边栏顶部「📚 库名 + 路径」常驻显示，一眼知道在看哪个库
- **库列表 + 切换**：顶部下拉列出全部库（宿主工作区自动发现 + 显式挂接），附页数；切换即换当前库，边栏树/搜索/图谱与 agent 工具（wiki_ingest / wiki_query / …）全部跟随
- **新建/挂接/移除**：⚙ 面板填目录（或「选目录」走宿主原生目录选择器）+ 显示名 → 新建/挂接；「×」移除仅限显式挂接的库（带确认，**绝不删除磁盘文件**；工作区/默认种子库只读）
- **跟工作区走**：边栏挂载时按当前工作区自动激活对应库（客户端读取宿主工作区运行时；无该服务时降级为手动切换）；服务端启动时读宿主工作区注册表，自动发现各工作区的 `.wiki`
- **注册表**：`<DSH_HOME|~/.dsh>/knj-obsidian/vaults.json`（可用插件配置 `vaultRegistryFile` 覆盖），损坏自动重建；vault 根不再写死宿主进程 cwd

新端点（写端点沿用同源 + JSON 校验）：

| 端点 | 说明 |
| --- | --- |
| `GET /api/obsidian-wiki/vaults` | 当前库 + 全部库（含只读 pageCount） |
| `POST /api/obsidian-wiki/vault/activate` | 按目录激活（已注册仅切换，未注册自动挂接） |
| `POST /api/obsidian-wiki/vault/switch` | 按 id 切换当前库 |
| `POST /api/obsidian-wiki/vault/attach` | 新建/挂接（目录不存在自动创建 + 脚手架 `.wiki`） |
| `POST /api/obsidian-wiki/vault/remove` | 从列表移除显式挂接的库（不删文件） |

## v8：界面重设计（设计系统 v2）

v8 对 v4–v7 的 UI 做整体重设计，方向为**宿主原生**（native to DSH）：

- **宿主令牌驱动**：所有颜色/字体/圆角/阴影改走宿主 `--dsw-alias-*` / `--dsw-static-*` / `--dsw-font-*` 变量（`src/client/styles.ts` 一次注入，`.knj-wiki` 作用域隔离），随宿主浅/深主题自动适配，彻底移除硬编码色值
- **布局重组**：重建/蒸馏/导入工具条收敛到底部「工具」面板；浏览/图谱改为分段切换；lint 收敛为底部状态条（页数 + 健康点 + 「问题」面板）
- **组件规范化**：统一按钮（primary/subtle/ghost-danger）、输入框、选择器、chip、banner、空态/加载/错误态；全部补齐 hover / focus-visible / disabled 状态
- **图标集**：emoji/文本符号（📚 ⚙ × ▲▼）替换为统一 SVG 线形图标（`src/client/icons.tsx`）
- **图谱**：节点/边颜色改走宿主令牌（浅/深主题均可读），新增统计与分类图例
- **笔记工作台**：标题层级、元信息 chip、分段切换、markdown 排版（标题/引用/表格/代码/任务列表）按宿主字体阶梯对齐

## 路线

- ~~**检索**~~ ✅ 已上线：`wiki_query` 工具 + `wiki-query` skill 双通道分层检索
- ~~**图谱**~~ ✅ 已上线：`wiki_export` 工具导出交互图谱（graph.html）与结构化数据（graph.json）
- ~~**UI**~~ ✅ 已上线：右侧边栏"知识库"标签 + 笔记/图谱工作台（v4）
- ~~**编辑**~~ ✅ 已上线：富渲染 + 双链导航 + 源码视图 + 全文编辑（v5）
- ~~**历史会话挖掘**~~ ✅ 已上线：wiki-distill skill + 边栏蒸馏按钮（v6）
- ~~**vault 跟随项目**~~ ✅ 已上线：多库管理 + 跟随工作区（v7）——当前库身份、库列表/切换、新建/挂接/移除、注册表持久化

## 开发

```bash
npm run check   # typecheck + build（服务端）
npm run check:client && npm run build:client   # 客户端类型检查 + bundle
node --test *.test.mjs   # 全部测试（126+ 例：smoke / vault-store / vault-manager / tools / ingest-delta / lint / retriever / graph-engine / wiki-export-tool / wiki-query-tool / wiki-query-skill / routes / vault-routes / save-route / incremental-routes / index-builder / importer / client-build / client-api / markdown / markdown-v2 / markdown-v3 / graph-view）
```

## License

MIT — 见 [LICENSE](./LICENSE)。
