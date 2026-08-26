// src/routes.ts
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { VaultStore } from './vault-store.ts'
import { retrieve } from './retriever.ts'
import { buildGraph } from './graph-engine.ts'
import { lintVault } from './lint.ts'

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

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.writeHead(status)
  response.end(JSON.stringify(data))
}

export function mountWikiRoutes(host: WikiHost, store: VaultStore): () => void {
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname
    const method = request.method ?? 'GET'
    if (method !== 'GET') {
      sendJson(response, 405, { error: 'method not allowed' })
      return
    }
    try {
      if (path === `${BASE}/pages`) {
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
        const page = store.readPage(id, category)
        if (!page) {
          sendJson(response, 404, { error: 'page not found' })
          return
        }
        sendJson(response, 200, { page })
        return
      }
      if (path === `${BASE}/search`) {
        const q = url.searchParams.get('q') ?? ''
        const mode = url.searchParams.get('mode') === 'index-only' ? 'index-only' : 'auto'
        sendJson(response, 200, retrieve(store, q, { mode }))
        return
      }
      if (path === `${BASE}/graph`) {
        sendJson(response, 200, buildGraph(store))
        return
      }
      if (path === `${BASE}/lint`) {
        sendJson(response, 200, lintVault(store))
        return
      }
      sendJson(response, 404, { error: 'not found' })
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  return host.webServer.register({ kind: 'prefix', path: BASE, handler })
}
