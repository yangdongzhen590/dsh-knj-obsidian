// routes.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from './lib/vault-store.js'
import { mountWikiRoutes } from './lib/routes.js'

/** 最小 webServer 假实现：捕获注册的 route（含 kind/path，供 req 做前缀匹配），供测试直接调用 */
function makeHost() {
  const handlers = new Map()
  const host = {
    webServer: {
      register: (route) => {
        handlers.set(`${route.kind}:${route.path}`, route)
        return () => handlers.delete(`${route.kind}:${route.path}`)
      },
    },
  }
  return { host, handlers }
}

function req(handlers, path, method = 'GET') {
  const route = [...handlers.values()].find((h) => {
    const p = path.split('?')[0]
    return h.path === p || (h.kind === 'prefix' && p.startsWith(h.path))
  })
  assert.ok(route, `no handler for ${path}`)
  const handler = route.handler
  return new Promise((resolve, reject) => {
    const url = new URL(`http://localhost${path}`)
    const request = { url: url.pathname + url.search, method }
    let body = ''
    const response = {
      setHeader: () => {},
      writeHead: () => {},
      end: (chunk) => { body += chunk ?? '' },
    }
    Promise.resolve(handler(request, response)).then(() => resolve(JSON.parse(body || '{}'))).catch(reject)
  })
}

const NOW = '2026-08-26T00:00:00.000Z'

function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-routes-'))
  const store = new VaultStore(dir)
  store.ensure()
  store.writePage({ id: 'rate-limiting', title: 'Rate Limiting 踩坑', category: 'concepts', tags: ['api'], source: 's', confidence: 'extracted', created: NOW, updated: NOW, body: '429 指数退避。参考 [[orders]]。' })
  store.writePage({ id: 'orders', title: '订单', category: 'projects', tags: [], source: 's', confidence: 'inferred', created: NOW, updated: NOW, body: '订单流程。' })
  return { dir, store }
}

test('GET /pages 返回页面摘要列表', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const result = await req(handlers, '/api/obsidian-wiki/pages')
  assert.equal(result.total, 2)
  assert.ok(result.pages.some((p) => p.id === 'rate-limiting' && p.category === 'concepts'))
  assert.equal(result.pages[0].confidence, 'extracted')
})

test('GET /page 返回单页内容', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const result = await req(handlers, '/api/obsidian-wiki/page?id=orders&category=projects')
  assert.equal(result.page.id, 'orders')
  assert.equal(result.page.title, '订单')
  assert.ok(result.page.body.includes('订单流程'))
})

test('GET /page 未知页返回 error', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const result = await req(handlers, '/api/obsidian-wiki/page?id=ghost&category=concepts')
  assert.ok(result.error)
})

test('GET /search 复用 retrieve 内核', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const result = await req(handlers, '/api/obsidian-wiki/search?q=rate%20limiting')
  assert.ok(result.candidates.some((c) => c.id === 'rate-limiting'))
  assert.ok(result.strategy.length > 0)
})

test('GET /graph 复用 buildGraph 内核', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const result = await req(handlers, '/api/obsidian-wiki/graph')
  assert.equal(result.nodes.length, 2)
  assert.ok(result.edges.some((e) => e.source === 'rate-limiting' && e.target === 'orders'))
  assert.equal(result.pageCount, 2)
})
