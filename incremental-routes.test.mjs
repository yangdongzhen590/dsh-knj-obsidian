// incremental-routes.test.mjs — v6 端点（rebuild-index / import）先红后绿
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { VaultStore } from './lib/vault-store.js'
import { mountWikiRoutes } from './lib/routes.js'

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

function req(handlers, path, { method = 'GET', headers = {}, body } = {}) {
  const route = [...handlers.values()].find((h) => {
    const p = path.split('?')[0]
    return h.path === p || (h.kind === 'prefix' && p.startsWith(h.path))
  })
  assert.ok(route, `no handler for ${path}`)
  const url = new URL(`http://localhost${path}`)
  const request = new EventEmitter()
  request.url = url.pathname + url.search
  request.method = method
  request.headers = headers
  let out = ''
  let status = 0
  const response = {
    setHeader: () => {},
    writeHead: (code) => { status = code },
    end: (chunk) => { out += chunk ?? '' },
  }
  const done = Promise.resolve(route.handler(request, response)).then(() => {
    try { return { status, json: JSON.parse(out || '{}') } } catch { return { status, text: out } }
  })
  queueMicrotask(() => {
    if (body !== undefined) request.emit('data', Buffer.from(body))
    request.emit('end')
  })
  return done
}

const JSON_HDR = { 'content-type': 'application/json' }
const SAME_ORIGIN = { origin: 'http://localhost:3080', host: 'localhost:3080' }

const NOW = '2026-08-26T00:00:00.000Z'
function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-v6-'))
  const store = new VaultStore(dir)
  store.ensure()
  store.writePage({ id: 'orders', title: '订单', category: 'projects', tags: [], source: 't', confidence: 'extracted', created: NOW, updated: NOW, body: '订单流程说明。' })
  return { dir, store }
}

test('POST /rebuild-index：重建并返回页数', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const r = await req(handlers, '/api/obsidian-wiki/rebuild-index', { method: 'POST', headers: { ...JSON_HDR, ...SAME_ORIGIN }, body: '{}' })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.pageCount, 1)
  const idx = readFileSync(join(dir, '.wiki', 'index.md'), 'utf8')
  assert.ok(idx.includes('[[orders]]'), '索引含页面行')
})

test('POST /rebuild-index 跨源 403 / 非 JSON 415', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const cross = await req(handlers, '/api/obsidian-wiki/rebuild-index', { method: 'POST', headers: { ...JSON_HDR, origin: 'http://evil.example', host: 'localhost:3080' }, body: '{}' })
  assert.equal(cross.status, 403)
  const badType = await req(handlers, '/api/obsidian-wiki/rebuild-index', { method: 'POST', headers: { 'content-type': 'text/plain', ...SAME_ORIGIN }, body: 'x' })
  assert.equal(badType.status, 415)
})

test('POST /import：目录导入返回清单', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const src = mkdtempSync(join(tmpdir(), 'dsh-obsidian-v6src-'))
  t.after(() => rmSync(src, { recursive: true, force: true }))
  writeFileSync(join(src, 'note-a.md'), '# 笔记A\n\n内容A。', 'utf8')
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const r = await req(handlers, '/api/obsidian-wiki/import', {
    method: 'POST',
    headers: { ...JSON_HDR, ...SAME_ORIGIN },
    body: JSON.stringify({ path: src, category: 'references' }),
  })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.imported, 1)
  assert.ok(store.readPage('note-a', 'references'))
})

test('POST /import：路径缺失 400 / 不存在 4xx / 跨源 403', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const noPath = await req(handlers, '/api/obsidian-wiki/import', { method: 'POST', headers: { ...JSON_HDR, ...SAME_ORIGIN }, body: '{}' })
  assert.equal(noPath.status, 400)
  const ghost = await req(handlers, '/api/obsidian-wiki/import', { method: 'POST', headers: { ...JSON_HDR, ...SAME_ORIGIN }, body: JSON.stringify({ path: 'Z:/ghost-dir', category: 'references' }) })
  assert.ok(ghost.status >= 400 && ghost.status < 500)
  const cross = await req(handlers, '/api/obsidian-wiki/import', { method: 'POST', headers: { ...JSON_HDR, origin: 'http://evil.example', host: 'localhost:3080' }, body: JSON.stringify({ path: 'C:/', category: 'references' }) })
  assert.equal(cross.status, 403)
})
