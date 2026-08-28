// src/routes.ts
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { VaultStore } from './vault-store.ts'
import { SaveError } from './vault-store.ts'
import { retrieve } from './retriever.ts'
import { buildGraph } from './graph-engine.ts'
import { lintVault } from './lint.ts'
import { rebuildIndex } from './index-builder.ts'
import { importPath } from './importer.ts'
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

/** v5 写面安全：同源校验（Origin 优先，缺失时 Referer），两者皆缺拒绝。 */
function isSameOrigin(request: IncomingMessage): boolean {
  const host = String(request.headers.host ?? '')
  if (!host) return false
  for (const header of ['origin', 'referer']) {
    const value = String(request.headers[header] ?? '')
    if (!value) continue
    try {
      return new URL(value).host === host
    } catch {
      return false
    }
  }
  return false
}

/** 读取请求体（拼接 data/end，超限 413）。 */
function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new SaveError(413, 'body too large'))
        request.destroy()
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

export function mountWikiRoutes(host: WikiHost, provider: VaultProvider): () => void {
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname
    const method = request.method ?? 'GET'
    if (method !== 'GET' && method !== 'POST') {
      sendJson(response, 405, { error: 'method not allowed' })
      return
    }
    try {
      const store = provider.current() as VaultStore
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
      if (method === 'GET' && path === `${BASE}/pages`) {
        // listPages() 不含 confidence：逐页 readPage 补齐（计划 Self-Review 裁决），
        // frontmatter 缺失/不可读的页面回退 'extracted'，与 graph-engine 的回退语义一致。
        const pages = store.listPages().map((p) => ({
          ...p,
          confidence: store.readPage(p.id, p.category)?.confidence ?? 'extracted',
        }))
        sendJson(response, 200, { pages, total: pages.length })
        return
      }
      if (path === `${BASE}/page`) {
        const id = url.searchParams.get('id') ?? ''
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
        const report = importPath(store, payload.path, category)
        sendJson(response, 200, report)
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
