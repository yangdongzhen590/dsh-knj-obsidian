# dsh-client-demo — 把 Vite+React 前端挂进 dsh web 的最小插件示例

由一次真实需求驱动：把一个 Vite + React + TS 的 `client` 前端项目作为 DSH 插件注册进 dsh web。
本示例用 `D:\dsh-knj\dsh-knj-obsidian\.wiki` 知识库当验证数据源。

## 结构

```
dsh-client-demo/
├─ package.json          # 插件包：dsh.bundle.patch 指向 cordis.patch.yml（可安装性的硬要求）
├─ plugin.js             # 插件入口（cordis apply），零运行时依赖
├─ cordis.patch.yml      # bundle patch（与 dsh-knj-obsidian 同款结构）
├─ copy-dist.mjs         # client/dist → client-dist（打包白名单只含后者）
├─ client-dist/          # 前端构建产物（npm pack 时进包）
└─ client/               # Vite + React + TS 脚手架（可独立 npm run dev）
```

## 注册机制（照抄 dsh-knj-obsidian 的真源，非猜测）

```js
// plugin.js
export const name = 'dsh-client-demo'
export function apply(ctx) {
  ctx.inject(['webServer'], (hostCtx) => {
    hostCtx.webServer.register({ kind: 'prefix', path: '/client-demo', handler })      // 静态页
    hostCtx.webServer.register({ kind: 'exact',  path: '/api/client-demo/pages', handler }) // API
    return () => { /* dispose 两条路由 */ }
  })
}
```

- 页面地址：`http://127.0.0.1:3080/client-demo/`
- 数据接口：`/api/client-demo/pages`（读知识库七个正式分类下的 *.md，标题取 frontmatter）

## 构建与安装（Windows，用 .cmd 避免 ps1 执行策略问题）

```cmd
cd client
npm install
npm run build            :: tsc 类型检查 + vite build（base:'./' 保证子路径资源引用正确）
cd ..
node copy-dist.mjs       :: 同步 dist -> client-dist
npm pack                 :: 产出 dsh-client-demo-<版本>.tgz
dsh plugin --profile web add ./dsh-client-demo-<版本>.tgz
:: 然后重启 dsh web，访问 http://127.0.0.1:3080/client-demo/
```

## 开发循环建议

- **前端改动的完整回路**是 build → copy → pack → add → 重启。嫌长可给 `client/vite.config.ts`
  加 dev 代理（本地开发不经过插件）：
  ```ts
  server: { proxy: { '/api': 'http://127.0.0.1:3080' } }
  ```
  这样 `npm run dev` 时页面跑在 Vite 上、API 打到 dsh web（需要插件已装且服务已重启过一次）。
- **库根可换**：环境变量 `DSH_CLIENT_DEMO_WIKI_ROOT` 或插件 config 的 `wikiRoot`。

## 踩坑记录（本机实测，2026-10-17）

| 坑 | 现象 | 处置 |
|---|---|---|
| `dsh plugin add` 装完不退出 | 命令 10 分钟超时，但文件已完整落盘 | 以 `node_modules/<pkg>` 文件为准判断成败，别只看退出码 |
| 服务启动早于安装 | `/client-demo/` 404 | 重启 dsh web 才会加载新插件 |
| `/api/*` 有鉴权层 | curl 直接打 API 返回 401 | 浏览器里有会话不受影响；脚本验证走假宿主驱动 handler |
| 前端产物不进包 | pack 只打 4 个文件 | `files` 白名单必须含 `client-dist`，且先跑 `copy-dist.mjs` |
| 版本号 | 同日多次打包 | 按 `YYYY.M.D<N>` 递增序号（如 2026.10.170 → 171）；本地 tgz 重装同版本可行，npm publish 不行 |

## 版本

`2026.10.170`（2026-10-17 当日第 0 次）。
