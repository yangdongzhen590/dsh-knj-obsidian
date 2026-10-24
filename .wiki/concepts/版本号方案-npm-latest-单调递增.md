---
id: 版本号方案-npm-latest-单调递增
title: 版本号方案：npm latest 的单调递增约束
category: concepts
tags: [decision, pitfall]
summary: 发版版本号必须严格大于 npm 上已发布的最新版本（2026.10.211）才能推进 latest：10 月用 2026.10.250+，11 月起可用 YYYY.MM.N；26.x 线只能挂在 v26line tag。
tier: supporting
source: agent:release-versioning-2026-10-25
confidence: extracted
created: 2026-10-24T18:44:28.466Z
updated: 2026-10-24T18:44:28.466Z
---

## 结论

npm 的 `latest` dist-tag 在 semver 上必须**严格递增**。插件发版后版本号必须大于
`2026.10.211`（最后一次以 latest 发布的版本），否则 `npm publish` 直接拒绝。

## 为什么 `26.10.2` 不能当 latest

2026-10-25 实测报错：

```
npm error Cannot implicitly apply the "latest" tag because previously published
version 2026.10.211 is higher than the new version 26.10.2.
You must specify a tag using --tag.
```

semver 先比 major：`26 < 2026`，所以整条 `26.x` 线在 npm 看来比 `2026.10.211` 旧。
当时用 `--tag v26line` 发布成功（`v26` 本身非法——npm 报 `Tag name must not be a valid SemVer range`）。
实测 `dist-tags`：`latest = 2026.10.211`、`v26line = 26.10.2`。

## 规则：`YYYY.M.D<N>`

| 例子 | 含义 |
|---|---|
| `2026.10.250` | 2026-10-25 第 0 次发布（`250 > 211`，可进 latest） |
| `2026.10.251` | 同一天第 1 次发布 |
| `2026.11.10` | 2026-11-01 第 0 次发布（月份进位后天然更大） |

- **10 月剩余时间**：必须用 `2026.10.250` 起的「日+序号」，否则仍小于 211；
- **11 月 1 日起**：月份段进位，可改用 `YYYY.MM.N`（如 `2026.11.1`），但整月不要与日期方案混用。

硬规则（semver 实测）：

- 前导零非法：`2026.10.02` 会被 npm 自动纠正成 `2026.10.2`（发布日志 `"version" was cleaned and set to ...`），
  仓库与 npm 从此对不上；
- 禁止四段（`2026.10.25.1`）、`-prerelease`（市场更新检测判「无更新」）、`+build`（不参与比较，npm 拒绝覆盖）；
- 一天最多 10 次（序号 0–9），否则 `2026.10.2510 > 2026.10.260` 破坏跨天排序。

## 改版本要改两处

1. `package.json` 的 `version`；
2. `src/client/index.ts` 的 `CLIENT_BUILD` —— 面板底部会显示它，用来人眼确认浏览器加载的是哪一次构建。

发版前必须重建服务端与客户端产物并跑全量测试，否则发布出去的还是旧产物
（见 [[只改编译产物的修复会被下一次构建静默回滚]]）。

## 当前落地状态（2026-10-25）

- `26.10.2` 已发布，挂在 tag `v26line` 上：`npm i dsh-knj-obsidian@v26line`；
- `latest` 仍是 `2026.10.211`，下一次正常发版（`2026.10.250+`）会重新推进 latest。

## 关联

- 发布流程与市场收录：`publishing-dsh-plugins` skill。

