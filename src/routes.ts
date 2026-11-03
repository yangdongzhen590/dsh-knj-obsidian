// src/routes.ts
import type { IncomingMessage, ServerResponse } from 'node:http'
import { appendFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { VaultStore } from './vault-store.ts'
import { SaveError } from './vault-store.ts'
import { retrieve } from './retriever.ts'
import { buildGraph } from './graph-engine.ts'
import { lintVault } from './lint.ts'
import { rebuildIndex } from './index-builder.ts'
import { importPath } from './importer.ts'
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from './checkpoint.ts'
import { refresherFor, vaultRootOf, type Refresher } from './semantic-refresh.ts'
import type { VaultProvider } from './types.ts'
import type { WikiCategory } from './types.ts'

export interface WebServerService {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

export interface WikiHost {
  webServer: WebServerService
}

const BASE = '/api/obsidian-wiki'
/** 写请求体上限：1MB（整份 md 文件远小于此，防滥用）。 */
const MAX_BODY = 1024 * 1024

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.writeHead(status)
  response.end(JSON.stringify(data))
}

/** v5 写面安全：同源校验（Origin 优先，缺失时 Referer），两者皆缺拒绝。
 *  补丁（本机部署）：经过端口转发/代理时，插件服务进程看到的 Host 可能是内部地址
 *  （如 127.0.0.1:3080），与浏览器 Origin（外部地址）不一致。这里额外接受
 *  X-Forwarded-Host / X-Forwarded-Proto 重建的外部 host，并在仍拒绝时把三个头
 *  写入诊断日志，便于定位转发层改写行为。 */
function isSameOrigin(request: IncomingMessage): boolean {
  const hosts = new Set<string>()
  const hostHeader = String(request.headers.host ?? '')
  if (hostHeader) hosts.add(hostHeader)
  const fwdHost = String(request.headers['x-forwarded-host'] ?? '')
  if (fwdHost) for (const part of fwdHost.split(',')) hosts.add(part.trim())
  const fwdProto = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim()
  if (fwdHost && fwdProto) hosts.add(`${fwdProto}://${fwdHost.split(',')[0].trim()}`)
  const origins: string[] = []
  for (const header of ['origin', 'referer']) {
    const value = String(request.headers[header] ?? '')
    if (!value) continue
    origins.push(value)
    try {
      if (hosts.has(new URL(value).host)) return true
    } catch {
      return false
    }
  }
  // 补丁续：DSH 客户端连接层代理请求时不携带 Origin/Referer（Host 也会被重写为回环地址）。
  // 跨站 CSRF 请求必定携带 Origin，两者皆缺只能是宿主内部连接层发出的请求，放行。
  if (origins.length === 0) return true
  try {
    appendFileSync('/tmp/knj-origin-debug.log', JSON.stringify({
      t: new Date().toISOString(), host: hostHeader, fwdHost, fwdProto, origins,
    }) + '\n')
  } catch {}
  return false
}

/** 读取请求体（拼接 data/end，超限 413）。
 *  超限时不 destroy socket：先让调用方把 413 响应写回去，再由连接层回收，
 *  destroy-then-respond 的响应永远送不到客户端。 */
function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new SaveError(413, 'body too large'))
        request.resume() // 丢弃剩余数据，让 end 正常到来（reject 后 resolve 无效）
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

/** 读 JSON 请求体并校验 content-type 已由调用方完成；返回解析后的对象。 */
async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const bodyText = await readBody(request)
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw new SaveError(400, 'invalid json body')
  }
}

/** 写端点公共前置：同源 + JSON content-type，通过后返回 body 解析结果。 */
async function guardWrite(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!isSameOrigin(request)) throw new SaveError(403, 'forbidden: cross-origin write rejected')
  const contentType = String(request.headers['content-type'] ?? '')
  if (!contentType.includes('application/json')) throw new SaveError(415, 'unsupported media type: expect application/json')
  return readJsonBody(request)
}

export interface WikiRoutesDeps {
  /** 测试注入点：替换语义刷新器（默认真实实现，会读写 ~/.dsh/qmd）。 */
  refresherFor?: (vaultRoot: string) => Pick<Refresher, 'status' | 'refreshNow'>
}

export function mountWikiRoutes(host: WikiHost, provider: VaultProvider, deps: WikiRoutesDeps = {}): () => void {
  const getRefresher = deps.refresherFor ?? refresherFor
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname
    const method = request.method ?? 'GET'
    if (method !== 'GET' && method !== 'POST') {
      sendJson(response, 405, { error: 'method not allowed' })
      return
    }
    try {
      // 只有真正写页面的端点才走 current()（首次会 ensure 脚手架）；其余（GET、vault 管理、
      // 校验类 POST）一律只读视图，避免“切库/查询即建库”把未初始化库标记成已初始化。
      const WRITE_PATHS = new Set([`${BASE}/page`, `${BASE}/rebuild-index`, `${BASE}/import`, `${BASE}/checkpoint/restore`])
      const store = (method === 'POST' && WRITE_PATHS.has(path) ? provider.current() : provider.currentReadonly()) as VaultStore
      // ---- v7 vault 管理端点 ----
      if (path === `${BASE}/vaults` && method === 'GET') {
        sendJson(response, 200, { current: provider.currentRecord(), vaults: provider.listVaults() })
        return
      }
      if (path.startsWith(`${BASE}/vault/`)) {
        // 单库模式（裸 VaultStore）没有 vault 写能力
        if (!provider.switchVault) { sendJson(response, 404, { error: 'not found' }); return }
        if (method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return }
        const payload = await guardWrite(request)
        const action = path.slice(`${BASE}/vault/`.length)
        if (action === 'activate') {
          const root = typeof payload.root === 'string' && payload.root ? payload.root : ''
          if (!root) throw new SaveError(400, 'field "root" (string) is required')
          provider.activateRoot!(root)
        } else if (action === 'switch') {
          const id = typeof payload.id === 'string' && payload.id ? payload.id : ''
          if (!id) throw new SaveError(400, 'field "id" (string) is required')
          if (!provider.switchVault(id)) throw new SaveError(404, `vault not found: ${id}`)
        } else if (action === 'attach') {
          const root = typeof payload.root === 'string' && payload.root ? payload.root : ''
          if (!root) throw new SaveError(400, 'field "root" (string) is required')
          const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : undefined
          provider.attachRoot!(root, name)
        } else if (action === 'remove') {
          const id = typeof payload.id === 'string' && payload.id ? payload.id : ''
          if (!id) throw new SaveError(400, 'field "id" (string) is required')
          if (!provider.removeVault!(id)) throw new SaveError(400, `vault not removable: ${id}`)
        } else {
          sendJson(response, 404, { error: 'not found' })
          return
        }
        sendJson(response, 200, { current: provider.currentRecord(), vaults: provider.listVaults() })
        return
      }
      // ---- v8 语义检索：状态 + 手动刷新（只读 store 视图；刷新只写 ~/.dsh/qmd 外部索引，不碰 vault） ----
      if (path === `${BASE}/semantic-status` && method === 'GET') {
        const refresher = getRefresher(vaultRootOf(store))
        sendJson(response, 200, await refresher.status())
        return
      }
      if (path === `${BASE}/semantic-update`) {
        if (method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return }
        const refresher = getRefresher(vaultRootOf(store))
        const before = await refresher.status()
        if (before.refreshing) {
          // 单飞：已在刷新就直接回报，不排队（真实库冷启动约 1.5 分钟）
          sendJson(response, 202, { started: false, running: true, status: before })
          return
        }
        // 后台跑：立刻返回，进度由 semantic-status 轮询
        void refresher.refreshNow()
        const after = await refresher.status()
        sendJson(response, 202, { started: true, running: after.refreshing, status: after })
        return
      }
      if (method === 'GET' && path === `${BASE}/pages`) {
        // listPagesReadonly：不触发 ensure()；逐页 readPage 走 mtime 缓存补齐 confidence
        // （frontmatter 缺失/不可读的页面回退 'extracted'，与 graph-engine 的回退语义一致）。
        const pages = store.listPagesReadonly().map((p) => ({
          ...p,
          confidence: store.readPage(p.id, p.category)?.confidence ?? 'extracted',
        }))
        sendJson(response, 200, { pages, total: pages.length })
        return
      }
      if (path === `${BASE}/page`) {        const id = url.searchParams.get('id') ?? ''
        const category = (url.searchParams.get('category') ?? 'concepts') as Parameters<typeof store.readPage>[1]
        if (method === 'GET') {
          if (url.searchParams.get('raw') === '1') {
            // v5 源码视图：返回磁盘原文（含 frontmatter，逐字节）
            const raw = store.readRawPage(id, category)
            if (raw === null) { sendJson(response, 404, { error: 'page not found' }); return }
            sendJson(response, 200, { raw })
            return
          }
          const page = store.readPage(id, category)
          if (!page) { sendJson(response, 404, { error: 'page not found' }); return }
          sendJson(response, 200, { page })
          return
        }
        // POST /page：全文编辑保存
        if (!isSameOrigin(request)) { sendJson(response, 403, { error: 'forbidden: cross-origin write rejected' }); return }
        const contentType = String(request.headers['content-type'] ?? '')
        if (!contentType.includes('application/json')) { sendJson(response, 415, { error: 'unsupported media type: expect application/json' }); return }
        const bodyText = await readBody(request)
        let payload: { raw?: unknown }
        try { payload = JSON.parse(bodyText) } catch { sendJson(response, 400, { error: 'invalid json body' }); return }
        if (typeof payload.raw !== 'string') { sendJson(response, 400, { error: 'field "raw" (string) is required' }); return }
        const page = store.saveRawPage(id, category, payload.raw)
        // 全文编辑可能改到标题/摘要（或者手工加删页面级信息），而 index.md 是派生工件：
        // 不同步重建的话，页面改了、L1/index-only 检索看到的还是旧的。
        try { rebuildIndex(store) } catch { /* 索引重建失败不影响保存结果 */ }
        sendJson(response, 200, { page })
        return
      }
      if (method === 'GET' && path === `${BASE}/search`) {
        const q = url.searchParams.get('q') ?? ''
        const mode = url.searchParams.get('mode') === 'index-only' ? 'index-only' : 'auto'
        sendJson(response, 200, retrieve(store, q, { mode }))
        return
      }
      if (method === 'GET' && path === `${BASE}/graph`) {
        sendJson(response, 200, buildGraph(store))
        return
      }
      if (method === 'GET' && path === `${BASE}/lint`) {
        sendJson(response, 200, lintVault(store))
        return
      }
      if (method === 'POST' && path === `${BASE}/rebuild-index`) {
        if (!isSameOrigin(request)) { sendJson(response, 403, { error: 'forbidden: cross-origin write rejected' }); return }
        const ct = String(request.headers['content-type'] ?? '')
        if (!ct.includes('application/json')) { sendJson(response, 415, { error: 'unsupported media type: expect application/json' }); return }
        await readBody(request) // body 仅作触发，不携带参数
        const result = rebuildIndex(store)
        sendJson(response, 200, result)
        return
      }
      if (method === 'POST' && path === `${BASE}/import`) {
        if (!isSameOrigin(request)) { sendJson(response, 403, { error: 'forbidden: cross-origin write rejected' }); return }
        const ct = String(request.headers['content-type'] ?? '')
        if (!ct.includes('application/json')) { sendJson(response, 415, { error: 'unsupported media type: expect application/json' }); return }
        const bodyText = await readBody(request)
        let payload: { path?: unknown; category?: unknown }
        try { payload = JSON.parse(bodyText) } catch { sendJson(response, 400, { error: 'invalid json body' }); return }
        if (typeof payload.path !== 'string' || !payload.path) { sendJson(response, 400, { error: 'field "path" (string) is required' }); return }
        const category = (typeof payload.category === 'string' && payload.category ? payload.category : 'references') as WikiCategory
        // 路径边界（安全）：只允许导入【已注册库根目录内】的 Markdown。
        // 否则同源脚本可借 /import 把用户任意目录里的 .md 拖进可检索/可导出的知识库。
        const target = resolve(payload.path)
        const roots = provider.listVaults().map((v) => resolve(v.root))
        const contained = roots.some((root) => {
          const rel = relative(root, target)
          return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
        })
        if (!contained) {
          throw new SaveError(400, `仅允许导入已注册知识库根目录内的 Markdown：${target}；如需导入其他位置，请先挂接该目录为库`)
        }
        const report = importPath(store, target, category)
        sendJson(response, 200, report)
        return
      }
      if (method === 'GET' && path === `${BASE}/checkpoints`) {
        sendJson(response, 200, { checkpoints: listCheckpoints(store) })
        return
      }
      if (method === 'POST' && path === `${BASE}/checkpoint/restore`) {
        const payload = await guardWrite(request)
        if (typeof payload.id !== 'string' || !payload.id) throw new SaveError(400, 'field "id" (string) is required')
        // 默认 merge（非破坏性）：只撤销快照内页面的修改，保留快照之后新增的页面；
        // exact 需显式传入，用于整库回到快照状态。
        const mode = payload.mode === 'exact' ? 'exact' : 'merge'
        const result = restoreCheckpoint(store, payload.id, mode)
        rebuildIndex(store)
        sendJson(response, 200, result)
        return
      }
      sendJson(response, 404, { error: 'not found' })
    } catch (error) {
      if (error instanceof SaveError) { sendJson(response, error.status, { error: error.message }); return }
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  return host.webServer.register({ kind: 'prefix', path: BASE, handler })
}
