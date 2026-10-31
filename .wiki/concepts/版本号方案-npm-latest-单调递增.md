---
id: 版本号方案-npm-latest-单调递增
title: 版本号方案：npm latest 的单调递增约束（按包独立）
category: concepts
tags: [decision, pitfall]
summary: 版本号按包独立递增（每包当月第 N 次发 = YYYY.MM.N）；已发出的号想改只能 unpublish，而 unpublish 需 2FA 会话（bypass-2FA 令牌被硬禁、网页无入口、镜像不联动删）；2026-10-31 最终把 9 包统一重发为 2026.11.9，下个号 2026.11.10。
tier: supporting
source: agent:release-versioning-2026-10-25
confidence: extracted
created: 2026-10-24T18:44:28.466Z
updated: 2026-10-31T15:09:33.172Z
---

## 结论

npm 的 `latest` dist-tag 在 semver 上必须**严格递增**——但「递增」是**每个包各自的事**：每个插件维护自己的版本序列，包与包之间互不相干。同一时刻，9 个包都可以是同一个号。

前置提醒：**发版前定好号是最便宜的**——号一旦发出去，纠正就只能 unpublish，而 unpublish 需要 2FA 会话（见下方 2026-10-31 事件）。

## 规则：每个包 = `YYYY.MM.N`，`N` 是该包当月的第几次发布

| 场景 | 版本 |
|---|---|
| 11 月第一次发 `dsh-knj-prompts` | `2026.11.1` |
| 11 月第二次发 `dsh-knj-prompts` | `2026.11.2` |
| 11 月第一次发 `dsh-knj-obsidian` | `2026.11.1` ← 与 prompts 无关 |

- 序号只在**同一个包内**递增，不要跨包共用序列；
- 新月份第一发，每个包都回到 `.1`；
- 同一包当月发到第 10 次就是 `.10`、第 11 次是 `.11`——`2026.11.10 > 2026.11.9` 成立，**月度方案没有「一天最多 10 次」的限制**；
- 10 月及以前的历史区间用「日+序号」`YYYY.M.D<N>`（当时 latest 基准是 `2026.10.211`）；
- **不要混用两种方案**：一旦某包用 11 月号发过，之后再发 `2026.10.x` 会被 latest 拒绝。

## 硬规则（semver 实测）

- 前导零非法：`2026.11.001` 会被 npm 清洗成 `2026.11.1`（日志 `"version" was cleaned and set to ...`），仓库与 npm 从此对不上；只有 `npm pack` 不校验；
- 禁止四段（`2026.10.25.1`）、`-prerelease`（市场更新检测判「无更新」）、`+build`（不参与比较，npm 拒绝覆盖）；
- **仅旧「日+序号」方案**才有「一天最多 10 次（后缀 0–9）」约束，因为 `2026.10.2510 > 2026.10.260` 会破坏跨天排序；当前的 `YYYY.MM.N` 月度方案不受此限。

## 改版本要改两处

1. `package.json` 的 `version`；
2. `src/client/index.ts` 的 `CLIENT_BUILD`——面板底部会显示它，用来人眼确认浏览器加载的是哪一次构建（目前只有 `dsh-knj-obsidian` 有这个常量）。

发版前必须重建服务端与客户端产物并跑全量测试，否则发布出去的还是旧产物（见 [[只改编译产物的修复会被下一次构建静默回滚]]）。

## 删除已发版本：四条路都被堵死（2026-10-31 实测）

1. **npm 网页无删除入口**：网站只提供 deprecate，不提供删单个版本；
2. **CLI unpublish 被令牌类型封死**：`~/.npmrc` 里是 bypass-2FA 令牌，npm 硬拒绝：`E403 Granular access tokens that bypass two-factor authentication may not perform this action`，带 `--otp` 也一样（不是缺码，是没权限）；
3. **web 登录会话建不起来**：`npm login --auth-type=web` 的 `/-/v1/login`、`/-/v1/done` 在本机网络下持续 `ECONNRESET`（而 publish 的 PUT 是通的）；
4. **淘宝镜像不跟着删**：npmmirror 缓存已发布版本，上游 unpublish 不会联动消失；需要 `PUT https://registry.npmmirror.com/-/package/<name>/syncs` 手工触发（匿名可用，返回 `{ok:true,id,state:"waiting"}`）。

**教训**：版本号一旦发错，现实中的成本往往高于「直接发一个更高的新号」。

## 2026-10-31 事件：误用共享序列 → 最终统一到 2026.11.9

1. **错**：9 个包被串成一个共享序列，按包名字母序发了 `2026.11.1`–`2026.11.9`，用户指出应为按包独立；
2. **欲纠正但受阻**：unpublish `.2`–`.9` 被上述 1–3 条堵死，干脆放弃删历史；
3. **最终方案**（用户拍定）：保留已发历史，**9 个包全部重发一枚 `2026.11.9`**（`workflow` 本就是 .9，跳过），使全系列对外一致；
4. 原来那批 `.1`–`.8` 作为历史版本留在 registry，不再删除（正常历史，不是错误残留）。

## 当前状态（2026-10-31 23:00）

- 9 包的 `version` 与 `dist-tags.latest` 在**上游与淘宝镜像两侧均为 `2026.11.9`**（镜像已逐个 PUT sync 后回读确认，均含 `2026.11.9`）；
- `dsh-knj-obsidian` 的 `CLIENT_BUILD = '2026.11.9'`；
- 下个号：现在各包同处 `.9`，所以下一个发布号统一从 `2026.11.10` 开始（不会再回到 `.1`）；10 月线早已关闭；
- `26.10.2` 仍挂在 tag `v26line`。

## 关联

- 发布流程与市场收录：`publishing-dsh-plugins` skill。
