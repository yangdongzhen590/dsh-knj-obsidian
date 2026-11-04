---
id: 主库-子库模型-一个主库-n-个工作区子库
title: 主库-子库模型（已于 2026-11-05 整体回滚）
category: concepts
tags: [knowledge-base, multi-vault, dsh-plugin, rollback]
summary: 2026-10-25 引入的「一个主库 + N 个工作区子库」模型已于 2026-11-05（v2026.11.15）整体回滚：代码回到无主库的能力面，注册表删掉主库与遗留库记录，两个残留 .wiki 目录改名保留。本页保留为历史记录：原模型行为、五类负面 bug、回滚动作清单、回滚后仍保留的三处修复（面板切库作用域 / 运行期边界 / 历史栈）。
tier: core
source: agent:capture
confidence: inferred
created: 2026-10-24T18:54:12.119Z
updated: 2026-11-04T17:29:10.469Z
---

# 主库-子库模型（已回滚）

**结论先行**：该模型 2026-10-25 引入（`1a643af`），2026-11-05 随 **v2026.11.15** 整体摘除（分支 `rollback/no-main-vault`）。现在 dsh-knj-obsidian 回到「多库但无主库」的能力面——与 DSH 0.2 迁移后、主库之前的状态（`5f8df54`）等价，且**不是**退回到不兼容 DSH 高版本的老包。

## 回滚原因

主库引入后带出 5 类「换机才咬人 / 静默答偏」的缺陷，收益（跨项目通用知识复用）远小于成本：

1. **`wiki_init` 落点与读路径口径相反**：init 用 `listVaults()`（含主库）算「工作区根」，读路径却把主库根排除在 `knownRoots` 之外 → 在建了库的 cwd 里 init 报「已存在 N 页」，同 cwd 查询却永远说「没有库」。
2. **越过主库根绑到祖先遗留库**：cwd 在 `~/.dsh` 之下时向上查找越过主库根，命中家目录里历史遗留的 `~/.wiki`（11 页）。
3. **面板点了「主库」只能看见「没有库」**：`readonlyVaultForRoot` 对主库根返回 `undefined` 是设计不变量，带主库根的 GET 一律 409，UI 入口天然是死路。
4. **`wiki_read` 读不回主库正文**：主库候选只能消费 `wiki_query` 的 snippet，违反「引用前读原文」纪律。
5. **写闸与语义键的口径分歧**：写闸只覆盖 `wiki_capture`/`wiki_ingest`（`VAULT_WRITE_TOOLS`），而 `wiki_normalize_tags`/`wiki_checkpoint`/`wiki_export`/`wiki_init` 都写盘；`vaultRootOfStore` 返回 `.wiki` 目录而索引键按项目根，L1 语义兜底从未命中（`collectionIdOf` 差 `-wiki` 后缀）。

共同根因：**「库」同时由注册表（可配置、有 role）和文件系统（向上找 `.wiki`）两套机制决定**，主库在这两套机制里的边界定义不一致。

## 回滚动作（2026-11-05 实际执行）

- **代码**：`git checkout 5f8df54 -- src/{vault-manager,routes,tools,trigger,types,retriever}.ts src/client/{api,index}.ts`；删 `src/subvault.ts` 与 `subvault.test.mjs` / `subvault-guards.test.mjs` / `subvault-http.test.mjs` / `vault-init-target.test.mjs`；`VaultHeader.tsx` 逐处编辑，去掉全部主库件、保留 P1-1 的受控 props。
- **测试**：525/525 绿（回滚前 571，差值为 subvault 与主库 init 用例）。
- **注册表** `~/.dsh/knj-obsidian/vaults.json`（备份 `vaults.json.bak-20261105`）：删主库记录 `v-6e8596052916`（`~/.dsh`）与遗留记录 `v-95927272b929`（`~`），删 `mainVaultId` 与所有 `role` 字段，剩 12 条，`currentVaultId` 仍指向项目库。
- **磁盘**：`~/.dsh/.wiki` → `~/.dsh/.wiki.rolledback-20261105`（5 页）；`~/.wiki` → `~/.wiki.rolledback-20261105`（11 页）。**内容零删除**，改回原名即可恢复为普通库。改名是必需的：`.wiki` 的发现走文件系统向上查找，**删注册记录拦不住它**。
- **数据**：主库 4 页（`compile-artifact-rollback-discipline`、`host-hook-contract-02`、`plugin-verification-traps`、`semantic-layer-diagnosis`）逐页比对后确认项目库已有等价页（见 [[只改编译产物的修复会被下一次构建静默回滚]]、[[插件验证纪律与实测陷阱]] 等），**未复制**，避免造重复页。

## 回滚后实测（真实形状，8/8）

| cwd | 解析结果 |
| --- | --- |
| `~/.dsh/skills/alpha` | 无库 |
| `~/.dsh` | 无库 |
| `~` | 无库 |
| `~/.dsh/profiles/web` | 无库（已注册但该目录无 `.wiki`） |
| `~/Documents/newproj` | 无库 |
| 启动后新建的 `~/.dsh/skills/fresh-ws` | 无库（不再被祖先库接管） |
| `D:\dsh-knj\dsh-knj-obsidian\src` | 项目库 |
| `D:\dsh-knj\dsh-knj-workflow\lib` | 对应项目库 |

`wiki_init` 在 `~/.dsh/skills/alpha` 现在落 cwd 自己：`readonlyVaultForRoot` 无命中 → `workspaceRootFor` 取 cwd 的**最深已注册祖先**，`~/.dsh` 已不在注册表里，于是就是 cwd。

## 回滚中保留的三处修复（与主库无关，都是通用缺陷）

- **面板切库作用域（P1-1）**：`overrideRoot` 上提到 `src/client/WikiSidebar.tsx`，`VaultHeader` 改受控（`overrideRoot` / `onOverrideRoot`），树/搜索/图谱/lint/蒸馏五个视图统一吃 `effectiveRoot`，切库派发 `wiki:vault-changed`。
- **运行期新增工作区成为边界（P1-3）**：`VaultManagerOptions.workspaceRoots` 支持 `WorkspaceSeed[] | (() => WorkspaceSeed[])`，`knownRoots()` 每次现取；`src/index.ts` 传取值函数。
- **笔记历史栈随库重置（P2-3）**：`NoteWorkbench` 栈重置依赖加 `root`，切库后「返回」不再打开另一库的同名页。

## 随之失效的不变量（不要再引用）

- ~~主库根不是工作区库~~、~~`mainVaultId` 唯一性~~、~~`target: 'main'`~~、~~主库扩展检索（`vault: 'main'`）~~、~~`KNJ_OBSIDIAN_MAIN_UI`~~、~~`KNJ_OBSIDIAN_SUBVAULTS`~~：环境变量与端点一并消失。
- 读路径**不再**排除任何「主库根」。残留后果：若将来在某个祖先目录里放了 `.wiki`，它会被向上查找自动跟随（这是无主库时代的既有语义，不是新 bug）。

## 若将来要重做

先解决两套「库身份」机制的统一（注册表 vs 文件系统），再谈主库；否则同样的边界不一致会原样复发。恢复旧实现可 `git checkout 1a643af -- src` 或 revert 本次回滚提交，但请连带恢复注册表字段与目录名。

## 相关

- [[会话级知识库绑定]]：面板/工具按会话 cwd 取库的底座（本轮未动摇）。
- [[插件验证纪律与实测陷阱]]：本轮所有结论都靠真 VaultManager + 真路由的探针复核，而非读源码推断。

