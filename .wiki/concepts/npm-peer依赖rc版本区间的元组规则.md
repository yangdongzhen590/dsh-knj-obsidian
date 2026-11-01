---
id: npm-peer依赖rc版本区间的元组规则
title: npm peer 依赖：rc 版本区间的元组规则
category: concepts
tags: [pitfall, dependency]
summary: semver 让 `>=0.1.1-rc.2 <0.3.0-0` 只匹配 0.1.1-rc.2 这条 rc 线：pre-release 版本必须命中同 x.y.z 元组的 prerelease comparator。修法是枚举每条 rc 线；2026-11-01 因此把 4 个包重发为 2026.11.10。
tier: supporting
source: agent:release-versioning-2026-10-25
confidence: extracted
created: 2026-11-01T07:42:04.176Z
updated: 2026-11-01T07:42:04.176Z
---

## 结论

给 DSH 插件写 `peerDependencies` 时，**`>=0.1.1-rc.2 <0.3.0-0` 看起来宽，实际只匹配 0.1.1-rc.2 这一条 rc 线**，装 0.1.2-rc.1 / 0.1.3-rc.1 / 0.2.0-rc.1 的机器全会 `ERESOLVE`。

## 为什么：semver 的 prerelease 元组规则

只有两种版本能落入区间：

1. **正式版**（无 `-rc` 后缀）——只受上下界比较约束，`0.2.0` 在 `>=0.1.1-rc.2 <0.3.0-0` 里没问题；
2. **pre-release 版**——额外要求：区间里必须有一个 comparator 的 `x.y.z` **与它完全相同且带 prerelease**，否则一律不匹配。

`>=0.1.1-rc.2 <0.3.0-0` 里带 prerelease 的 comparator 只有 `>=0.1.1-rc.2`（元组 0.1.1）和 `<0.3.0-0`（元组 0.3.0）。所以：

| 版本 | `>=0.1.1-rc.2 <0.3.0-0` | `>=0.1.1-rc.2 <0.1.2-0 \|\| >=0.1.2-rc.1 <0.1.3-0` | 完整枚举式 |
|---|---|---|---|
| 0.1.1-rc.2 | ✅ | ✅ | ✅ |
| 0.1.2-rc.1 | ❌ | ✅ | ✅ |
| 0.1.3-rc.1 | ❌ | ❌ | ✅ |
| 0.2.0-rc.1 | ❌ | ❌ | ✅ |
| 0.2.0（正式） | ✅ | ❌ | ✅ |

## 正确写法：枚举 rc 线

```
>=0.1.1-rc.2 <0.1.2-0 || >=0.1.2-rc.1 <0.1.3-0 || >=0.1.3-rc.1 <0.2.0-0 || >=0.2.0-rc.1 <0.3.0-0
```

每段都满足「元组相同 + 有 prerelease」，兼容当前所有 rc 线以及 0.2.0 正式版。代价是无法预知未来新增的 rc 线（如 `0.2.1-rc.1`），届时再追一条。

## 自查命令（发版前必跑）

```powershell
node -e "const s=require('semver');for(const v of ['0.1.1-rc.2','0.1.2-rc.1','0.1.3-rc.1','0.2.0-rc.1','0.2.0'])console.log(v, s.satisfies(v, require('./package.json').peerDependencies['@deepseek-ai/dsh-agent']))"
```

更彻底的做法：干净临时目录里真装一次——`--dry-run` 不够（本地 packument 缓存会骗你），要确认 `node_modules` 里真出现目标版本：

```powershell
mkdir $env:TEMP\probe; cd $env:TEMP\probe
'{"name":"probe","version":"0.0.0","private":true}' | Set-Content package.json
npm install <pkg>@<ver> --no-audit --no-fund --prefer-online
```

## 2026-11-01 事故：2026.11.9 有 4 个包装不上

- 上一轮把 peer 区间从窄双段改成 `>=0.1.1-rc.2 <0.3.0-0`，目的是「放宽」，结果适得其反：`dsh-knj-workflow`(6 条)、`dsh-scheduler`(2)、`dsh-knj-session-management`(2)、`dsh-knj-reqwork`(1) 在 DSH 0.1.2-rc.1 的机器上全部 `ERESOLVE`；`dsh-knj-obsidian` 因为写的是 `>=0.1.2-rc.1` 反而正常。
- 用干净目录复现：`workflow@2026.9.192`（窄双段）✅、`workflow@2026.11.9` ❌、`obsidian@2026.11.9` ✅。
- 修复：4 个包换枚举式区间 → 重发 `2026.11.10` → 干净工程目录真实安装验证 `added 40 packages`、`installed=2026.11.10`。旧的 2026.11.9 已发布不可变，只能提醒用新号。

## 关联

- 版本号规则本身见 [[版本号方案-npm-latest-单调递增]]。
- 排查路径：`ERESOLVE` → 看 `Conflicting peer dependency: X@ver` → 用上面的 semver 矩阵验证区间是否排除掉了该 `ver`。
