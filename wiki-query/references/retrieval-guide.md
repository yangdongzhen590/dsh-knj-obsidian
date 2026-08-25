# 检索指南（无 dsh tool 时的 fallback 流程）

## 环境

- vault：项目根 `.wiki/`（纯 Markdown）
- 可用工具：grep / glob / read（内置），无需插件工具
- 分层原则：先便宜后贵，命中即停

## 分层步骤

1. **L1（index 快速层）**：读 `.wiki/index.md`，匹配查询词所在行。
2. **L2（标题/标签层）**：`grep -rli "<query>" .wiki --include="*.md"` 得到文件列表，
   逐个读 frontmatter 的 title/tags 与查询词比对。
3. **L3（正文层）**：对 L2 候选打开正文，定位查询词，截取上下文 ≤200 字符。
4. **L4（图谱层）**：解析命中页的 `[[wikilink]]`，取一跳邻居补充关联候选。

## 降级路径

- 没有 grep（受限环境）：用 read 逐文件读 `listPages` 等价目录清单，逐个比对标题。
- index.md 不存在：跳过 L1 直接从 L2 开始。
- 查询词过宽（命中 >20 文件）：取前 10 个相关性最高的，注明「结果过多已截断」。

## 答案规范

- 每条引用格式：`页面路径（confidence: extracted|inferred|ambiguous）`
- 引用必须来自真实读到的文件，不得编造。
