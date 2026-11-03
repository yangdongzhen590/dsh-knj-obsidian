# dsh-knj-obsidian 本机部署现状与 Rebase 方案

> 记录日期：2026-10-22
> 维护背景：上游作者未合并 PR#2（0.2.0 兼容），本机原基于 PR#2 自构建 `2026.9.301-p2` 运行。
> 本文档供后续会话接手：先读「现状」，再按「方案 A」执行即可。
>
> **⚡ 2026-10-22 方案 A 已执行完毕**，见文末「七、执行记录」。现役版本已是 `2026.10.140-p5`。

## 〇、执行后现状速览（2026-10-22 起）

| 项 | 值 |
|---|---|
| 现役插件 | `dsh-knj-obsidian@2026.10.140-p5`（分支 `feat/dsh020-rebase` 自构建） |
| 安装引用 | `~/.dsh/profiles/web/package.json` → `file:/home/admin/.dsh/local-plugins/dsh-knj-obsidian-2026.10.140-p5.tgz` |
| 回滚方式 | `dsh plugin install ~/.dsh/local-plugins/dsh-knj-obsidian-2026.9.301-p2.tgz --profile web` 后重启 dsh-web |
| 分支 | `feat/dsh020-rebase` = main(1560988) + PR#2 四提交 + p5 三提交（见执行记录） |
| 语义通道 | ✅ 已启用（2026-10-22）：`@tobilu/qmd@2.8.3` 显式装入 web profile，`available:true / modelPresent:true`；详见「八、语义检索启用记录」 |

## 一、本机部署现状（运行中，勿破坏）

| 项 | 值 |
|---|---|
| DSH 宿主 | `0.2.0-rc.2`（web profile，`dsh web --host 127.0.0.1 --port 3080`，systemd `dsh-web.service`） |
| 已安装插件 | `dsh-knj-obsidian@2026.9.301-p2`（自构建，非 npm 官方包） |
| tarball 存放 | `~/.dsh/local-plugins/`（p2 为现役，另有 p1/原始版/pr2.tar.gz 源码快照） |
| 安装引用 | `~/.dsh/profiles/web/package.json` → `file:/home/admin/.dsh/local-plugins/dsh-knj-obsidian-2026.9.301-p2.tgz` |
| skills | `~/.dsh/skills/wiki-{init,collect,distill,mine,query}` 符号链接 → 插件包内目录 |
| 嵌入模型 | `~/.dsh/qmd/models/embeddinggemma-300M-Q8_0.gguf`（319MB，已就位） |
| 知识库 | `/vol3/1000/Software/openclaw/data/home/.openclaw/wiki`（main/david/psyche 三 vault） |

### p2 相对 PR#2 原始版的全部改动（仅两处，都在运行时验证过）

1. **`src/routes.ts` `isSameOrigin()` 重写**（补丁 p1+p2）：
   - 接受 `X-Forwarded-Host` / `X-Forwarded-Proto`
   - **Origin 与 Referer 皆缺时放行**——DSH 客户端连接层代理请求时不携带这两者且重写 Host 为 `127.0.0.1:3080`，原版必然 403（`cross-origin write rejected`），表现为边栏"挂接 vault"失败
   - 拒绝时写诊断日志 `/tmp/knj-origin-debug.log`
2. **`package.json` version 字段**（仅版本号，便于区分）

## 二、版本谱系与上游动态

```
upstream/main = 1560988 (2026-10-14, 对应 npm v2026.10.140)
   └─ PR#2 分支 = de59384（父提交即 main HEAD，4 个兼容提交，未合并）
                    └─ 本机 p2 = de59384 + isSameOrigin 补丁 + 版本号改写

npm 独发版本：2026.10.171 / .173 / .210 / .211（10-16 ~ 10-21）
  ⚠ GitHub 仓库无对应提交——作者只发 npm 未回灌源码
```

- PR #2：<https://github.com/yangdongzhen590/dsh-knj-obsidian/pull/2>（open，无人回复）
- Issue #3：同报 0.2.0-rc.2 不兼容（open）
- 本仓库（fork）：`origin` = `git@github.com:lpreterite/dsh-knj-obsidian.git`，`upstream` 已挂

## 三、上游 latest（npm 2026.10.211 tarball 实测 diff）相对我们 p2 的差异

### 3.1 上游仍然缺失（= 我们必须继续自持的）

- peer 仍锁死 `@deepseek-ai/dsh-llm` / `dsh-tools` = `0.1.2-rc.1` → 在 0.2.0-rc.2 宿主上**装不上**
- `isSameOrigin` 仍是原版严格校验 → 装上了也会复现 403

### 3.2 上游新增（= rebase 的收益）

| 变更 | 内容 |
|---|---|
| `src/trigger.ts` 重写 | 知识触发四层：**L0 会话级库绑定**（9-28）+ **L1 两档提醒**（一档路径+摘要 / 二档追投正文，开关 `KNJ_OBSIDIAN_TRIGGER_FULLTEXT`）+ **L3 复发提醒**（开关 `..._RECURRENCE`）+ L5 沉淀提醒 |
| `src/skill-provider.ts`（新） | 包内 skill **自动注册进模型 catalog**——若采用，应移除 `~/.dsh/skills/` 里的手动符号链接以免双份 |
| `src/drill.ts`（新） | `wiki_drill` 语义种子 + 一跳双链下钻 |
| `src/graph-layout.ts`（新） | 图谱布局独立模块（10.140 图谱渲染改进） |
| `src/semantic-hits.ts`（新） | 语义命中映射/评分 |
| `wiki-capability/`（新 skill） | 包内第 6 个 skill |
| client 四文件 | `GraphView` / `KnowledgeDistillLauncher` / `LintPanel` / `api.ts` GUI 改进 |
| 安装健壮性 | `@tobilu/qmd` 转 optional peer（`autoInstallPeers:false` 不自动装，README 有内网部署说明） |
| 其余差异文件 | `index.ts` / `tools.ts` / `retriever.ts` / `index-builder.ts` / `importer.ts` / `semantic-index.ts` / `semantic-refresh.ts` / `vault-manager.ts` / `vault-store.ts` / `types.ts` |

## 四、建议：方案 A —— 干净 rebase（推荐）

PR#2 分支父提交即 main HEAD，**无 rebase 冲突**，步骤：

```bash
cd /vol2/1000/Works/github/dsh-knj-obsidian
git switch -c feat/dsh020-rebase main        # 基于 1560988 (v2026.10.140)
git cherry-pick e7887bd 68fa57b e7cf2c3 de59384   # PR#2 的 4 个兼容提交（零冲突预期）
# 追加 p2 的第 5 个提交：routes.ts isSameOrigin 补丁
#   参考实现：从 p2 tarball 提取 src/routes.ts 直接覆盖
#   tar -xOzf ~/.dsh/local-plugins/dsh-knj-obsidian-2026.9.301-p2.tgz package/src/routes.ts > src/routes.ts
#   ⚠ diff 检查一遍：上游 routes.ts 后续若改过写端点，需手工融合而非整文件覆盖
git commit -am "fix: relax same-origin check for DSH client connection layer (p2)"
sed -i 's/"version": ".*"/"version": "2026.10.140-p5"/' package.json  # 版本号自定
```

构建与验证：

```bash
npm ci --no-audit --no-fund        # ⚠ 先从 devDependencies 移除 @rolldown/binding-win32-x64-msvc（Linux 装不上）
npm run build && npm run build:client
node test/compat/check-peer-ranges.js   # 应显示 0.1.2-rc.1 与 0.2.0-rc.2 双基线通过
npm_config_cache=/tmp/.npm-cache npm pack
dsh plugin install <生成的 tgz> --profile web
# 重启 dsh-web（kill 进程，systemd Restart=on-failure 自动拉起）
```

验收清单：
- [ ] 边栏「知识库」标签出现，挂接 vault 不再 403
- [ ] `lark-cli`……无关；验证搜索（关键词 + 语义通道均出结果）
- [ ] 图谱视图正常、点节点开笔记
- [ ] **skill 自动注册生效后，移除 `~/.dsh/skills/wiki-*` 手动符号链接**（避免 catalog 双份）
- [ ] trigger 四层新开关行为符合预期（`KNJ_OBSIDIAN_TRIGGER_RECURRENCE=off` 等）

### 方案 B（备选）：以 npm 2026.10.211 tarball 为基

tarball 自带 src+lib+client 构建产物，补两处（peers + isSameOrigin）后 `tsc` 重构建即可。优点是拿到 npm 独发的 10.171-211 变更；缺点是无 git 历史、是脏基线。**建议先做方案 A**，之后如需 10.171-211 的增量，再用 `diff -ru` 对比两个 npm tarball 评估要不要补。

## 五、相关资产索引

| 资产 | 路径 |
|---|---|
| 现役 tarball / 历史版本 / PR 源码快照 | `~/.dsh/local-plugins/` |
| p2 构建源码（含补丁后的 routes.ts） | `/tmp/knj-build/dsh-knj-obsidian-de59384536c41b693548d760d80d03fd0b3912f9/`（/tmp 可能已清，tarball 内 package/src/routes.ts 等价） |
| 上游 2026.10.211 解包（本对比所用） | `/tmp/knj-upstream/package/`（/tmp 可能已清，可重新下载） |
| 跨 harness 通用化提案（含 knj-view 只读 GUI 设计） | `/vol3/1000/Software/openclaw/data/home/.openclaw/wiki/proposal/跨Harness通用知识服务提案.md`（飞书同步件：file token `Zde4bbdfboUHvmxvuLnc8KqhnVg`） |
| lark-cli skill（上传飞书用） | `~/.dsh/skills/lark-cli/SKILL.md` |

## 六、注意事项

- `dsh web` 重启方式：`kill <node 子进程 pid>`，systemd `Restart=on-failure` 5 秒自动拉起；入口脚本会重新捕获带 token 的 URL 写 `/vol3/1000/Software/dsh-web-url.md`
- 插件硬依赖 `dsh-better-sidebar`（profile 内已装 0.26.0），若见 `web boot: entry did not activate: betterSidebar pending` 即此因
- 构建机 npm 全局缓存 `/home/admin/.npm` 曾有 root 属主问题，构建时用 `npm_config_cache=/tmp/.npm-cache`

## 七、执行记录（2026-10-22，方案 A 实际执行情况）

分支 `feat/dsh020-rebase` 提交谱系（main = 1560988，v2026.10.140）：

```
2f15548 test: align origin-check assertions with the p2 patch and fix a Windows-only path split
537b8e4 build: drop win32 rolldown binding and regenerate lock for Linux builds
5c9cadc fix: relax same-origin check for DSH client connection layer (p2)
df90b15 docs: …git-install trap                          ← PR#2 de59384
44b419b fix: cap the 0.2 peer branch at <0.2.1-0 …       ← PR#2 e7cf2c3
02e1765 fix: use a producer-owned source kind …          ← PR#2 68fa57b
8b35913 adapt to DSH 0.2.0-rc.2: widen peers …           ← PR#2 e7887bd
1560988 feat(trigger): … v2026.10.140                    ← main
```

与原计划的偏差（原计划"零冲突预期"不成立）：

1. **PR#2 分支父提交是 7859da5（v2026.9.201），不是 main HEAD**——上游在 PR 开出后又推进了 main。cherry-pick 首提交在 `package.json` / `package-lock.json` / `client/client.js.map` 三处冲突，已手工融合（version 取 main、devDeps 取 PR 双方并集、lock 从零重新生成、client 构建产物取 main 后统一重构建）。
2. **新增 `537b8e4`**：移除 `@rolldown/binding-win32-x64-msvc`（Linux EBADPLATFORM，原计划作为构建时临时步骤，改为落提交）并重建 lock（main 旧 lock 锁 0.1.2-rc.1 dev 线，与 0.2.0-rc.2 pins 冲突，须删 lock 重生成）。
3. **新增 `2f15548`**：上游两处同源测试断言旧 403 行为（与 p2 补丁有意放行冲突）已改为断言新行为（无 Origin/Referer → 200/进入业务；携带外来 Origin 仍 403 的 CSRF 用例原本就有且保留）；另修 `skill-provider.test.mjs` 的 `lastIndexOf('\\')` Windows 专用路径切分（Linux 上必挂的存量 bug）。

构建与测试结果：`tsc` / `check:client` / `build:client` 全过；`node test/compat/check-peer-ranges.js` 双基线（0.1.2-rc.1 与 0.2.0-rc.2）通过；`npm test` 432 例 429 过 / 0 挂 / 3 skip（环境门控）。

部署与验证：

- tarball 已入 `~/.dsh/local-plugins/`，web profile 已装 `2026.10.140-p5`，dsh-web 已重启（新 pid 正常，token 已重捕获）
- API 实测：带 token 无 Origin/Referer 请求 `/api/obsidian-wiki/vaults` → **200**（旧版 403 即边栏挂接失败根因）；外来 Origin 写端点 → **403**（CSRF 防线保留）
- 启动日志无 error、无 `betterSidebar pending`

验收清单遗留（需 GUI 或后续确认）：

- [ ] 边栏「知识库」标签与图谱视图：请在本机 GUI 里过一眼
- [x] 挂接 vault 不再 403（API 层已验证）
- [x] 关键词检索正常（wiki_query；语义通道已启用，见「八」）
- [x] **`~/.dsh/skills/wiki-*` 手动符号链接已移除**（2026-10-22）：自动注册已三重确证——①启动日志无 provider 警告且无 skills pending；②`src/skill-provider.ts:87` 包根从 `import.meta.url` 自解析，装进包内即指向正确位置；③用安装包内编译产物按运行时同路径实测 `createSkillProvider().list()` 返回全部 5 个 skill。如需还原：`ln -s ~/.dsh/profiles/web/node_modules/dsh-knj-obsidian/wiki-{collect,distill,init,mine,query} ~/.dsh/skills/`
- [x] trigger 四层开关默认值符合预期（`KNJ_OBSIDIAN_TRIGGER*` 系列默认开、`off` 显式关；`KNJ_OBSIDIAN_GATE`/`WRITE_GATE` 默认 off）

## 八、语义检索启用记录（2026-10-22）

1. **安装**：`dsh plugin --profile web add @tobilu/qmd@2.8.3`。首次执行报 `ERR_PNPM_IGNORED_BUILDS`——pnpm v12 默认拦截构建脚本，包已落盘但 node-llama-cpp/tree-sitter 系未构建。
2. **批准构建**：dsh 的白名单在 profile 的 `pnpm-workspace.yaml` `allowBuilds:` 键（package.json 的 `pnpm.onlyBuiltDependencies` 在 pnpm v12 不生效，勿用）。追加了 `node-llama-cpp` 与 `tree-sitter-{go,javascript,python,rust,typescript}` 六项后重跑 add，全部构建成功。
3. **重启**：kill node 子进程，systemd 拉起。`GET /api/obsidian-wiki/semantic-status` → `available:true, modelPresent:true`（此前一直是 `library-missing`）。
4. **模型**：`~/.dsh/qmd/models/embeddinggemma-300M-Q8_0.gguf`（333MB）文件名与 `DEFAULT_MODEL_FILENAME` 一致，无需动作。查询扩展/精排模型被插件钉死在本地不存在路径，全程零联网。
5. **各库页面数实测**（索引只认 `.wiki/七分类/*.md`，vault 根下的其他目录对插件不可见）：wiki 根库 0 页（纯脚手架，`proposal/` 等内容不在七分类下）、psyche 1 页、bili-mcp 21 页、叶帕奇 9 页。
6. **索引入口**：`POST /api/obsidian-wiki/semantic-update`（后台单飞，进度轮询 `GET semantic-status`），等价于边栏「更新索引」按钮。索引落在 `~/.dsh/qmd/index.sqlite`，不进 vault。
