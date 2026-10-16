---
id: dsh-插件宿主接口契约
title: DSH 插件宿主接口契约（钩子、事件、日志解码）
category: references
tags: [api-contract]
summary: DSH 宿主插件可用的钩子（agent/session-start、agent/pre-step、tools/pre-execute…）、事件结构与会话日志 zstd 解码的实测契约。
tier: supporting
source: session:session-4b66fae1-7429-45bf-98e7-19b8ab8aeac3
confidence: extracted
created: 2026-10-13T16:53:19.805Z
updated: 2026-10-13T16:55:46.474Z
---

> 以下契约均为**实测或读取类型声明**确认过的事实，不是猜测；引用时注意宿主版本。

## agent 侧钩子

| 钩子 | 存在性 | 用途 |
|---|---|---|
| `agent/session-start` | 存在（文档明确写 `Use agent.inject() to seed model-facing context`） | 注入会话级上下文（本项目用它做 L0 库身份） |
| `agent/pre-step` | 存在 | 任务级提示锚点（每步前） |
| `agent/turn-stopping` | 存在 | 回合边界（折叠 `tool/result` 做 L3） |

`agent.inject` 的文档语义：*Queue model-facing context for the next pre-step… claims it at the nearest later step boundary*——等价于 `send(input,'next-step',false)`。关键推论：**可以在同一回合内多次注入**（L1 二档要第二次 `inject`）。

## 工具侧钩子

- `tools/pre-execute(exec, next) → PreToolDecision`（可 deny / ask）。实现**必须先 `await next()`**，不越过宿主的权限/沙箱策略。
- `tools/post-execute`、`tools/result`。
- 注册在 `try/catch` 里：**静默失败与正常沉默无法区分**，所以"注册成功"只能等真实工具调用才能观察到。

## 会话事件与 header

- `session.header.cwd`、`session.header.delegationDepth`（顶层判定：`delegationDepth === 0`；子代理只留最终报告）。
- `tool/call` 带 `turn` / `step` / `name` / `arguments`。
- `tool/result` 带 `turn` / `step` / `message.content`（`ToolResultBlock[]`，与 `user/message` 同形）以及可选 `error: {name, code}`；**不带 `name`**，需 `callId` 回连 `tool/call`。文本嵌套在 `type:'tool-result'` 里（见 [[失败复发检测信号]]）。
- `user/message` **不带 `data.turn`**。

## 会话日志解码

- 位置：`~/.dsh/sessions/<项目转义目录>/<sessionId>/session.jsonl.zstd`（Windows：`%USERPROFILE%\.dsh\sessions`）。
- zstd **多帧**流：Node 24 内置 zstd（`createZstdDecompress` / `zstdDecompressSync`），按魔数 `28 B5 2F FD` 逐帧解。
- 意义：这是唯一能拿到"注入是否真落地"**实测证据**的通道——夹具只能证明代码路径，日志能证明生产行为（例如"重启后零新注入"这种结论）。

## 相关

调用时机与分层的设计判据见 [[知识库读取触发层设计]]；按会话解析库用到 `session.header.cwd`，见 [[会话级知识库绑定]]；从这些契约里搞错过的坑见 [[插件验证纪律与实测陷阱]]。本页蒸馏自 [[dsh-web-知识库调用排查-会话索引]]。
