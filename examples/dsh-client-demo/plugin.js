// plugin.js — dsh-client-demo 插件入口（零运行时依赖，纯 Node 内置模块）
//
// 做两件事（对应 dsh web 的两个注册面）：
//   1) prefix 路由 /client-demo      → 伺服 client-dist/ 里的前端构建产物（Vite build 输出）
//   2) exact  路由 /api/client-demo/pages → 读取知识库 .wiki 的页面清单（本示例的验证数据源）
//
// 注册机制与 dsh-knj-obsidian 完全一致（其 src/routes.ts 的 WebServerService）：
//   ctx.inject(['webServer'], hostCtx => hostCtx.webServer.register({ kind, path, handler }))
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-client-demo'

/** 插件自身的配置（dsh 配置面传入；均可缺省）。 */
export function apply(ctx, config = {}) {
  // 与 dsh-knj-obsidian 相同的纪律：webServer 是官方 base bundles 保证提供的安全核心依赖。
  ctx.inject(['webServer'], (hostCtx) => {
    const webServer = hostCtx.webServer

    const here = dirname(fileURLToPath(import.meta.url))
    const distDir = resolve(here, 'client-dist')
    // 验证用知识库根：默认指向 dsh-knj-obsidian 的库；可用配置或环境变量覆盖。
    const wikiRoot = config.wikiRoot
      || process.env.DSH_CLIENT_DEMO_WIKI_ROOT
      || 'D:\\dsh-knj\\dsh-knj-obsidian\\.wiki'

    const MIME = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.ico': 'image/x-icon',
      '.map': 'application/json',
      '.txt': 'text/plain; charset=utf-8',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    }

    function sendText(res, status, body, type = 'text/plain; charset=utf-8') {
      res.setHeader('Content-Type', type)
      res.writeHead(status)
      res.end(body)
    }

    function sendJson(res, status, data) {
      sendText(res, status, JSON.stringify(data), 'application/json; charset=utf-8')
    }

    /** 伺服 client-dist 下的静态文件（含路径穿越防护）。 */
    function serveStatic(req, res, url) {
      if ((req.method ?? 'GET') !== 'GET') {
        sendText(res, 405, 'method not allowed')
        return
      }
      // prefix 路由拿到的 url 形如 /client-demo 或 /client-demo/assets/index-xxx.js
      let rel = decodeURIComponent(url.pathname.replace(/^\/client-demo\/?/, ''))
      if (rel === '' || rel === '/') rel = 'index.html'
      const file = resolve(distDir, rel)
      if (!file.startsWith(distDir)) {
        sendText(res, 403, 'forbidden')
        return
      }
      let st
      try {
        st = statSync(file)
      } catch {
        // SPA 回退：未知路径回 index.html（hash 路由场景也够用）
        const index = join(distDir, 'index.html')
        if (existsSync(index)) {
          sendText(res, 200, readFileSync(index), MIME['.html'])
        } else {
          sendText(res, 404, 'not built: run npm run build in client/ first')
        }
        return
      }
      if (!st.isFile()) {
        sendText(res, 404, 'not found')
        return
      }
      res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
      readFileSync(file) // 小产物直接读；演示规模足够，避免流式复杂度
      res.writeHead(200)
      res.end(readFileSync(file))
    }

    /** 读知识库页面清单：七个正式分类下的 *.md，标题取 frontmatter title。 */
    function listWikiPages() {
      const CATEGORIES = ['concepts', 'entities', 'references', 'synthesis', 'projects', 'dictionaries', 'tables']
      const pages = []
      for (const category of CATEGORIES) {
        const dir = join(wikiRoot, category)
        if (!existsSync(dir)) continue
        for (const name of readdirSync(dir)) {
          if (!name.endsWith('.md')) continue
          const id = name.slice(0, -3)
          let title = id
          try {
            const raw = readFileSync(join(dir, name), 'utf8')
            const m = /^title:\s*(.+)$/m.exec(raw)
            if (m) title = m[1].trim().replace(/^["']|["']$/g, '')
          } catch { /* 读失败用 id 当标题 */ }
          pages.push({ category, id, title })
        }
      }
      pages.sort((a, b) => (a.category + '/' + a.id).localeCompare(b.category + '/' + b.id))
      return pages
    }

    const disposeStatic = webServer.register({
      kind: 'prefix',
      path: '/client-demo',
      handler: (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        serveStatic(req, res, url)
      },
    })

    const disposeApi = webServer.register({
      kind: 'exact',
      path: '/api/client-demo/pages',
      handler: (req, res) => {
        if ((req.method ?? 'GET') !== 'GET') {
          sendText(res, 405, 'method not allowed')
          return
        }
        try {
          const pages = listWikiPages()
          sendJson(res, 200, { root: wikiRoot, count: pages.length, pages })
        } catch (error) {
          sendJson(res, 200, { root: wikiRoot, count: 0, pages: [], error: String(error?.message ?? error) })
        }
      },
    })

    return () => {
      disposeStatic()
      disposeApi()
    }
  })
}
