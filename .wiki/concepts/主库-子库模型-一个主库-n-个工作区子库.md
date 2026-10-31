---
id: 主库-子库模型-一个主库-n-个工作区子库
title: 主库-子库模型（一个主库 + N 个工作区子库）
category: concepts
tags: [knowledge-base, multi-vault, dsh-plugin, rollback]
summary: 本机唯一主库（~/.dsh/.wiki）存跨项目通用知识，各工作区 .wiki 为子库；写入默认子库、target=main 才写主库；检索子库候选<3 才扩主库并标 vault=main；KNJ_OBSIDIAN_SUBVAULTS=off 一键回滚。
tier: core
source: agent:capture
confidence: inferred
created: 2026-10-24T18:54:12.119Z
updated: 2026-10-30T01:20:00.000Z
---

主库 + N 子库是 dsh-knj-obsidian 2026-10-25 引入的知识组织模型：物理上多库，逻辑上一个主库、N 个子库。

## 模型

- **主库**：本机唯一，默认 `~/.dsh`（其下 `.wiki` 即主库，展示名「主知识库」），放**跨项目通用知识**（方法论、踩坑、工具经验）。可用 `KNJ_OBSIDIAN_MAIN_VAULT_DIR` 改位置。
- **子库**：各工作区的 `.wiki`，放**项目知识**。旧注册表没有 `role` 字段的条目一律按 `child` 处理（向后兼容）。
- **唯一性**：`vaults.json` 的 `mainVaultId` 为准；`setMainVault()` 会把其它 `role=main` 降级为 `child`。
- **注册 ≠ 建库**：主库只登记、不自动创建 `.wiki`；初始化是显式动作（`wiki_init`）。

## 行为

1. **检索**（`wiki_query`）：先查本工作区子库；**实召回 < 3**（语义兜底噪声不算）且主库已初始化时才扩主库。合并后**整体按分数降序**（同分时子库在前），不是"子库整块垫在前面"——否则稀疏子库的 0.1 分语义噪声会把 4.8 分的主库真命中压下去。主库命中带 `vault: 'main'`，渲染为 `[主库]`。`mode: 'index-only'` 是只读本库 index.md 的快速路径，**不扩主库**。主库不可用/未初始化时静默跳过（不报错、不改结果）。
2. **写入**（`wiki_ingest`）：默认落当前会话**子库**；`target: 'main'` 才写主库。主库未初始化时**报错而不建库**。回执的 `vaultRoot` + `vaultRole` 按**真实落点**计算（不是按入参推导），无 cwd 回退也不会把主库谎报成 child。
3. **身份**：`/vaults?root=` 额外返回 `main`（名称/根/页数/是否初始化/role）；L0 注入在主库已初始化时多一行「主库：…」。库名入库前统一清洗（去控制字符/换行、限长 80），因为名字会原样进提示。
4. **UI**：面板顶部除「本工作区子库」外多一个「主库」chip（未初始化时点击把初始化交给 Agent）；点主库 = 本面板临时覆盖（`overrideRoot`），「跟随工作区」可还原。主库没有"移除"按钮。
5. **开关**：`KNJ_OBSIDIAN_SUBVAULTS=off`（等价写法 `false`/`0`/`no`/`disabled`）→ 旧注册表里的 `role=main` 被降级、`mainVaultId` 清空、主库不出现在库列表、检索不扩展、UI 不显示主库入口，行为回到旧版。默认 **on**。注意这层回滚是**连带的**：主库概念消失后，「`~/.dsh` 下的目录不算工作区库」这条保护也一并消失（旧版就没有主库，本就没有这条保护），所以 `off` 下别在 `~/.dsh` 里建库。

## 不变量与边界

- 主库**不抢占**全局 `currentVaultId`（否则未给 root 的调用方/UI 会被主库顶替）；**也绝不作为"当前库"的兜底**（本库是空壳时宁可返回空壳，让"先初始化"有落点）。
- 主库根**不是工作区库**：`readonlyVaultForRoot` 对主库根及其子目录返回 `undefined`，否则 `~/.dsh` 之下的会话会把 L0 说成「本工作区的知识库：主知识库」、默认 ingest 写进主库。
- 子库实召回充足（≥3）时**不查主库**（`subvault-guards.test.mjs` 的 R9-1 断言零调用），避免主库污染项目检索排序。
- 主库**不可移除**（`removeVault` 返回 false、端点 400）：误删会让 `mainVaultId` 悬空，且 `removedRoots` 让它在重启后被 seed 跳过 = 永久失效。
- 写主库必须显式：不带 `?root=` 的 `POST` 写请求若落在主库上，返回 409 `main-vault-write-needs-explicit-target`；`/import` 的可导入边界也排除主库根。
- 主库命中按 id 去重：同 id 以子库版本为准。
- 不自动迁移历史页、不做子库间检索、不改排序/语义算法。

## 回滚

三级：① 设 `KNJ_OBSIDIAN_SUBVAULTS=off` 重启；② 恢复已安装副本 `~/.dsh/profiles/web/.backup-dsh-knj-obsidian-pre-subvault-*`；③ `git checkout backup/pre-subvault-20261025-024436`。知识库内容可用 `wiki_checkpoint` 还原点（2026-10-24T18-45-09-760Z）回滚。

## 相关

- [[会话级知识库绑定]]：面板/工具按会话 cwd 取库的底座；主库扩展是它的上层补充。
- [[插件验证纪律与实测陷阱]]：本次踩到的「下拉 value 匹配不到 option 时浏览器回落到第一个库」属于同类假象。

