---
id: qmd-全局索引库的跨库噪声与两道防线
title: QMD 全局索引库的跨库噪声与两道防线
category: concepts
tags: [pitfall, concept, decision]
summary: 一个 ~/.dsh/qmd/index.sqlite 同时装多个库的 collection，语义检索不限定 collection 就会把别库页面当本库命中；两道防线（检索带限定 + 整形按归属兜底）。
tier: core
source: agent:capture
confidence: inferred
created: 2026-10-16T16:50:07.007Z
updated: 2026-10-16T16:50:07.007Z
---

## 机制：索引库是全局共享的，不是每库一个

`~/.dsh/qmd/index.sqlite` 是**一个** SQLite 库，里面按 collection 分区。每个知识库对应一个 collection，命名规则是 vaultRoot 去掉所有非字母数字后拼 `-wiki`：

```
D:\dsh-knj\dsh-knj-obsidian  →  d-dsh-knj-dsh-knj-obsidian-wiki
```

2026-10-15 实测同一个 index.sqlite 里躺着 4 个库：

| collection | 文档数 | 备注 |
|---|---|---|
| `d-workspace-iobs-pro-wiki` | 28 | 别库 |
| `d-workspace-tap-taste-wiki` | 8 | 别库 |
| `d-dsh-knj-dsh-knj-obsidian-wiki` | 7 | 本库（唯一带 path/pattern 的） |
| `d-dsh-knj-dsh-knj-prompts-wiki` | 5 | 别库 |

## 症状：本库根本没有的页出现在结果里

检索若不带 collection 限定，qmd 会在**全部** collection 里搜。而结果整形 `pageRefOf` 只看「末两段是不是七个正式分类之一」——各库都有 `concepts/`、`references/`，于是别库的 `concepts/xxx.md` 直接冒充本库命中。

实测（6 个查询，各取 8 条）：

- 旧行为（不限定）：混入 **32 条**别库命中。`loader` 这个查询返回的 8 条**全部**是别库页，Top1 就是错的——即「目标页被淹没，agent 拿到的最相关结果是别人的库」。
- 新行为（限定本库）：混入 **0 条**。

典型噪声样例：`module-guolu-v`、`fallback-default`、`vue-loader`、`postgresql-ptap-权限模型`。

## 两道防线

**第一道（主）：检索时带 collection 限定。** qmd 原生支持，只是插件没用：

```js
searchLex(q, { limit, collection })      // → searchFTS(q, limit, collectionName)
searchVector(q, { limit, collection })   // → searchVec(q, model, limit, collectionName, ...)
```

限定后 `searchLex` 返回 0 条是**真实结果**而非「参数把检索打死了」——用本库确有的词（如「触发层」）验证过会正常命中，不要把这个 0 误当成故障。

**第二道（兜底）：整形阶段按记录自报的归属再挡一次。** 命中记录里 `collectionName` 是权威字段，`filepath` 是 `qmd://<collection>/<category>/<file>.md`，`displayPath` 也带 collection 前缀。三条来源按可靠性取值；**归属认不出时一律放行**（宁可漏挡，也不能因为字段形态变化把本库结果误杀）。这一道用来兜住「上游漏传参数」或「qmd 某版本忽略该参数」。

## 判定命中是否属于本库

```js
命中记录 → collectionName ?? qmd:// 前缀 ?? displayPath 首段（需 ≥3 段，否则首段是分类不是 collection）
```

两段形态（`concepts/x.md`）的首段是**分类**；把它当 collection 会把本库结果全部误杀——这是这道兜底最容易写错的地方。

## 关联

排查过程与证据链见 [[dsh-web-知识库调用排查-会话索引]]；同批还有一条 [[语义层未就绪的诊断口径-require-假阴性-被吞掉的真实错误-永久失败缓存]]（同一事故的另一半：库到底加载没加载）。

- 功能页：[[capability-知识检索]]