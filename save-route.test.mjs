// save-route.test.mjs — v5 写路径测试（先红后绿）。
// 覆盖：GET /page?raw=1、POST /page 正常保存、坏 frontmatter 拒绝、id 不符拒绝、
// 路径穿越拒绝、跨源 403、非 JSON 415、保存后原文件在失败时不变。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
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

/** 支持 method/headers/body 的请求假实现（EventEmitter 流），返回 { status, json } */
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
  // 异步投递 body（模拟 Node http 流）
  queueMicrotask(() => {
    if (body !== undefined) request.emit('data', Buffer.from(body))
    request.emit('end')
  })
  return done
}

const NOW = '2026-08-26T00:00:00.000Z'

function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-save-'))
  const store = new VaultStore(dir)
  store.ensure()
  store.writePage({ id: 'orders', title: '订单', category: 'projects', tags: ['t'], source: 's', confidence: 'extracted', created: NOW, updated: NOW, body: '订单流程。' })
  return { dir, store }
}

const JSON_HDR = { 'content-type': 'application/json' }
const SAME_ORIGIN = { origin: 'http://localhost:3080', host: 'localhost:3080' }

test('GET /page?raw=1 返回磁盘原文（含 frontmatter）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const r = await req(handlers, '/api/obsidian-wiki/page?id=orders&category=projects&raw=1', { headers: SAME_ORIGIN })
  assert.equal(r.status, 200)
  assert.ok(r.json.raw.startsWith('---'), 'raw 应以 frontmatter 开头')
  assert.ok(r.json.raw.includes('id: orders'), 'raw 应含 frontmatter id')
  assert.ok(r.json.raw.includes('订单流程'), 'raw 应含正文')
})

test('POST /page 正常保存：原子落盘并返回解析页', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const raw = ['---', 'id: orders', 'title: 订单 v2', 'category: projects', 'tags: [t, x]', 'source: s', 'confidence: extracted', `created: ${NOW}`, `updated: ${NOW}`, '---', '', '新正文，见 [[rate-limiting]]。', ''].join('\n')
  const r = await req(handlers, '/api/obsidian-wiki/page?id=orders&category=projects', {
    method: 'POST', headers: { ...JSON_HDR, ...SAME_ORIGIN }, body: JSON.stringify({ raw }),
  })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.page.title, '订单 v2')
  // 落盘核验
  const disk = readFileSync(join(dir, '.wiki', 'projects', 'orders.md'), 'utf8')
  assert.ok(disk.includes('订单 v2') && disk.includes('新正文'), '磁盘文件应已更新')
  // 再读回
  const page = store.readPage('orders', 'projects')
  assert.equal(page.title, '订单 v2')
})

test('POST /page 坏 frontmatter → 422，磁盘不变', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const before = readFileSync(join(dir, '.wiki', 'projects', 'orders.md'), 'utf8')
  const r = await req(handlers, '/api/obsidian-wiki/page?id=orders&category=projects', {
    method: 'POST', headers: { ...JSON_HDR, ...SAME_ORIGIN }, body: JSON.stringify({ raw: '没有 frontmatter 的裸文本' }),
  })
  assert.equal(r.status, 422)
  assert.ok(r.json.error)
  const after = readFileSync(join(dir, '.wiki', 'projects', 'orders.md'), 'utf8')
  assert.equal(after, before, '失败时磁盘文件不得变化')
})

test('POST /page frontmatter id 与目标不符 → 422', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const raw = ['---', 'id: other-page', 'title: x', 'category: projects', 'tags: []', 'source: s', 'confidence: extracted', `created: ${NOW}`, `updated: ${NOW}`, '---', '', 'body', ''].join('\n')
  const r = await req(handlers, '/api/obsidian-wiki/page?id=orders&category=projects', {
    method: 'POST', headers: { ...JSON_HDR, ...SAME_ORIGIN }, body: JSON.stringify({ raw }),
  })
  assert.equal(r.status, 422)
})

test('POST /page 路径穿越 id → 4xx 且无写入', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const raw = ['---', 'id: ../evil', 'title: x', 'category: projects', 'tags: []', 'source: s', 'confidence: extracted', `created: ${NOW}`, `updated: ${NOW}`, '---', '', 'x', ''].join('\n')
  const r = await req(handlers, '/api/obsidian-wiki/page?id=..%2Fevil&category=projects', {
    method: 'POST', headers: { ...JSON_HDR, ...SAME_ORIGIN }, body: JSON.stringify({ raw }),
  })
  assert.ok(r.status >= 400 && r.status < 500, `status=${r.status}`)
  assert.ok(r.json.error)
})

test('POST /page 跨源 → 403', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const raw = ['---', 'id: orders', 'title: x', 'category: projects', 'tags: []', 'source: s', 'confidence: extracted', `created: ${NOW}`, `updated: ${NOW}`, '---', '', 'x', ''].join('\n')
  const r = await req(handlers, '/api/obsidian-wiki/page?id=orders&category=projects', {
    method: 'POST', headers: { ...JSON_HDR, origin: 'http://evil.example', host: 'localhost:3080' }, body: JSON.stringify({ raw }),
  })
  assert.equal(r.status, 403)
})

test('POST /page 非 JSON Content-Type → 415', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const r = await req(handlers, '/api/obsidian-wiki/page?id=orders&category=projects', {
    method: 'POST', headers: { 'content-type': 'text/plain', ...SAME_ORIGIN }, body: 'x',
  })
  assert.equal(r.status, 415)
})

test('POST /page 无 Origin/Referer → 403（localhost 写面默认拒绝）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  const raw = ['---', 'id: orders', 'title: x', 'category: projects', 'tags: []', 'source: s', 'confidence: extracted', `created: ${NOW}`, `updated: ${NOW}`, '---', '', 'x', ''].join('\n')
  const r = await req(handlers, '/api/obsidian-wiki/page?id=orders&category=projects', {
    method: 'POST', headers: { ...JSON_HDR }, body: JSON.stringify({ raw }),
  })
  assert.equal(r.status, 403)
})
