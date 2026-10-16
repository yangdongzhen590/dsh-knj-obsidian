---
name: wiki-query
description: >
  Answer questions by searching the compiled Obsidian wiki (.wiki/). Use this skill
  when the user asks about their knowledge base, "what do I know about X",
  "find everything related to Y", or wants synthesized answers with citations
  from their wiki pages. Also use for multi-hop questions ("how is X connected
  to Y"). For paraphrase-style or natural-language questions prefer wiki_drill
  (semantic seeds + one-hop wikilink neighbors) and read hits with wiki_read.
  Works from any project. READ-ONLY — never create or modify pages.
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

### L2 — 标题 + 标签层（frontmatter 级；命中即停）
用 grep 在 `.wiki/*/` 下搜标题与 frontmatter 标签：
```bash
grep -ri "<query>" .wiki/*/ --include="*.md" -l   # 或按需限定目录
```
对命中文件，读 frontmatter 的 `title` / `tags` / `summary` / `tier` / `confidence`。
标题与标签同级——都只读 frontmatter，不读正文。**L2 出现标题/标签命中后停止，不升 L3**（成本护栏）。
但护栏有个反直觉的例外：**语义层在场且有语义命中时护栏不触发**（`retriever.ts` 的条件是
`if (!hasSemantic && guardTriggered) return`），此时正文层与图谱层照跑——也就是说同一个查询
在语义层启用/关闭两种情况下，**返回的候选集合本身会不一样**。看到 `strategy` 里有没有
`semantic` 就能判断走的是哪一支。

### L2b — 摘要层（严格低于正文层的回退层）
`summary:` 只在**标题、标签、正文都不含查询词**时才产生候选，分数 2。

这条规则让「摘要到底是人工撰写还是机器派生」不需要判断也不用判断：派生摘要就是正文首行的
副本，其内容必然也在正文里，所以它永远走不到摘要层——既不会凭空多出候选，也不可能把本该
标 `body` 的命中改判成 `summary`（连带换掉 L3 的居中 snippet）。而人工摘要可能含有正文里
根本没有的措辞，那才是摘要层真正新增的召回。

> 因此：想让摘要具备检索能力，就要给它**与正文不同的措辞**；照抄正文首行等于没写。

### L3 — 正文层（按需）
L2 无果时，读候选文件正文找查询词；截取命中上下文 ≤200 字符作为 snippet。
正文命中时，同时读该页的 `[[wikilink]]` 出链，把一跳邻居也列为关联候选（L4）。

### L4 — 图谱邻居（增强）
解析命中的页面的 `[[链接]]`，取其一跳邻居页面作为关联候选，注明「关联」。

## 语义种子 + 双链下钻（`wiki_drill` / `wiki_read`）

L1–L4 是**词面**检索：多词、改写式、自然语言提问常常 0 命中（「知识库怎么触发检索」这类句子
与库内页没有共享字面词）。遇到这类提问，**优先用 `wiki_drill`**：

| 工具 | 用途 |
|---|---|
| `wiki_drill({ query })` | 模式 A：语义（QMD 双通道）+ 词面两路按名次 RRF 融合出**种子页**，每个种子附带**一跳** wikilink 邻居（含方向 `out`/`in`、断链 `broken`、来源 `via`） |
| `wiki_drill({ page })` | 模式 B：已知页 id 时做**纯图**下钻（毫秒级、不跑嵌入），取该页的出链与入链 |
| `wiki_read({ id })` | 读**整页**正文 + frontmatter 摘要 + 出/入链清单 |

推荐流程：`wiki_drill({query})` 拿种子 → `wiki_read` 读最像的那页 → 不满意就
`wiki_drill({page: '<该页链到的 id>'})` 继续一跳，逐跳推进。

三条纪律：

1. **只做一跳**。工具刻意不返回两跳（实测本库两跳即覆盖全库 40%–60%，等于把半个库倒进上下文）；
   更深由你决定走哪条链，自己再调一次 `page` 模式。
2. **邻居 ≠ 命中**。种子里 `matchedBy` 为 `title`/`tag`/`body`/`semantic` 的是检索命中；
   邻居的 `matchedBy` 恒为 `graph-neighbor`，它是「从命中页走链到达」，证据强度更低，
   引用时要说清是顺链找到的。
3. **引用前必须读整页**。只用 snippet 合成答案会出现「有引用格式、没读原文」的伪知识；
   `wiki_read` 就是为这一步准备的。

降级是**如实回报**的：语义索引陈旧/模型缺失时结果照给，但 `message` 会说明「基于旧索引」
或「本次仅词面通道」——不要忽略该说明，也不要因此断定库里没有该知识。

## 打分与排序（候选恒按分降序）

`wiki_query` 返回的候选带 `score` 与 `tier`，**已经按分降序**——第 1 条就是最该先看的页面，
不必再自行猜测谁更相关。打分公式对齐 obsidian-wiki 的 graphrag：

```
score = (基础匹配分 + min(度 × 0.1, 2)) × tier 权重
```

| 命中层 | 基础分 |
|---|---|
| 标题精确命中（id 或标题等于查询词） | 10 |
| 标题包含 | 6 |
| 标签包含 | 4 |
| 摘要包含（且标题/标签/正文都不含，见 L2b） | 2 |
| 语义召回（语义层启用时） | `0.3 / 名次`（第 1 名 0.3、第 n 名 0.3/n）|
| index.md 行命中（仅 index-only 模式） | 2 |
| 正文包含（L3） | 1 |
| 图谱邻居（L4） | 0.5 |

> **语义层整层垫底且按通道内名次给分**：它不乘 tier 权重、不加度加权，分值恒 < 0.35
> （词面最低层 = graph 层 × peripheral tier 的最低分）。原因是实测（2026-10-17，10 条改写式查询）
> 扁平 base=3 会让语义候选顶掉正确的词面 Top1——最刺眼的一例是语义通道里排**最后**的 hub 页
> 被融合顶成 Top1，Top1 精度从 6/10 掉到 4/10。所以**语义只补召回，不参与词面之上的排序**：
> 它是「词面几乎无果时的补充」，不要指望它把更相关的页排到词面命中之前。

- **度** = 出链 + 入链（同一页重复指向同一目标只计一次），封顶 +2。
- **tier 权重**：`core` 1.3 / `supporting` 1.0 / `peripheral` 0.7；frontmatter 无 `tier:` 或值非法时按 supporting。
- index-only 模式不建全图（度为 0），并**保持 index.md 的人工目录顺序**，不重排。
- `index.md` 的描述取页面 frontmatter 的 `summary:`（无该字段才回退正文首行），因此 L1/index-only
  与 frontmatter 说的是同一句话。

引用时把分数一并给出（如 `[[dsh-plugin-dev-pitfalls]] (score 8.5)`），用户才能判断证据强弱。

## 合成答案

基于候选页合成回答，**必须带引用**（页面路径 + confidence 标记：
extracted=读到 / inferred=推测 / ambiguous=矛盾）。
回答结构：结论 + 支持页列表 + 每条引用的 snippet。

## 无匹配

返回「wiki 无匹配」，并建议「把 XX 吸收进 wiki」来添加知识。

## 只读约束

本 skill 不得写任何文件（含 log.md）。发现新知识时，路由到 wiki-capture / wiki-ingest。
