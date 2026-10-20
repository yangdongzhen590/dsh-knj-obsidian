---
id: 语义层未就绪的诊断口径-require-假阴性-被吞掉的真实错误-永久失败缓存
title: 语义层未就绪的诊断口径：require 假阴性、被吞掉的真实错误、永久失败缓存
category: concepts
tags: [pitfall, api-contract]
summary: 「@tobilu/qmd 未安装」曾是被 require 假阴性和被 catch{} 吞掉的错误共同制造的错误结论；诊断必须用 await import 并读出 loadError。
tier: core
source: agent:capture
confidence: inferred
created: 2026-10-16T16:50:07.062Z
updated: 2026-10-16T16:50:07.062Z
---

## 事故：三方一致地指向了错误原因

2026-10-15 的现象是界面报「语义索引为空 · 0 篇」+「进程内 QMD 库（@tobilu/qmd）未能加载——未安装，或其原生依赖在本机不可用」。按这个口径排查，会得出「把 qmd 装上就好了」的结论。**而 qmd 装得好好的。**

## 假阴性①：`require()` 测 ESM-only 包必然失败

`@tobilu/qmd` 是 `"type": "module"` 且 package.json 里**没有** `exports` 的 CJS 入口。于是：

```js
node -e "require('@tobilu/qmd')"        // ✗ ERR_PACKAGE_PATH_NOT_EXPORTED / MODULE_NOT_FOUND
node --input-type=module -e "await import('@tobilu/qmd')"   // ✓ 正常，返回 createStore 等
```

插件源码走的是懒加载 `await import('@tobilu/qmd')`，**这条路径一直是通的**。用 `require` 去验证它，得到的是一个与运行时无关的失败。

**纪律：验证 ESM-only 依赖的可用性，只能用 `import()`；`require` 的失败不构成「没装」。**

## 假阴性②：包不在插件的 node_modules 里≠没装

pnpm 会把依赖**提升**到 profile 根。实测布局：

```
~/.dsh/profiles/web/node_modules/dsh-knj-obsidian/          ← 插件本体（其 node_modules 里只有 marked）
~/.dsh/profiles/web/node_modules/@tobilu/qmd/dist/index.js  ← qmd 实际在这里（被提升）
```

Node 解析会从插件目录逐级上溯，`dsh-knj-obsidian/node_modules` 找不到就继续往 `profiles/web/node_modules` 找 → 命中。所以「查插件的 node_modules，发现没有 @tobilu」是**真话但错误结论**：结论必须按 Node 的解析顺序下，不能按目录直觉下。

正确的可用性探针是走插件同款调用：

```js
const rt = await createSemanticRuntime({ vaultRoot, home })
// status=ready / modelPresent=true / store 已打开 / index={documents,pendingEmbedding,hasVectorIndex}
```

2026-10-15 用它在**全新进程**里实测：`status=ready`，28 ms，`documents=48`，`hasVectorIndex=true`。语义层当时就是可用的。

## 真盲区：`catch {}` 把唯一证据吞掉，界面只能猜

`createSemanticRuntime` 打开库失败时原本是裸 `catch { return { store: null } }`，真实错误被丢弃；`notReadyMessage('library-missing')` 于是只能写一句**猜出来的原因**（「未安装，或其原生依赖不可用」）。这次它猜错了，把排查方向带偏了整整一轮。

修法：失败时把 `error.name: error.message` 记进 `runtime.loadError`，并让 `notReadyMessage` 的 `library-missing` 分支把它如实带出。**同理适用于任何「降级并给用户一句话」的分支：降级可以，但不能把原因一起降级掉。**

## 附带发现：失败会被永久缓存（尚未修）

`semantic-hits.ts` 的 `semanticRuntimeFor` 按 vaultRoot 缓存运行时 Promise，失败时 `catch(() => null)` 把 **null 也缓存**，此后同一库在**整个进程生命周期**内都拿不到语义层，只有重启才能恢复——一次瞬时失败（sqlite 句柄占用、模型文件正在复制）就等于永久失效。

界面侧的状态读取路径（`semantic-refresh.ts` 的 `status()`）每次新建运行时、不缓存失败，所以「界面说 0 篇」与「工具说不可用」可能不同步。

## 关联

跨库噪声（同一事故的另一半）见 [[qmd-全局索引库的跨库噪声与两道防线]]；这类「验证手段本身有缺陷」的教训同族于 [[插件验证纪律与实测陷阱]]。

- 功能页：[[capability-知识检索]]