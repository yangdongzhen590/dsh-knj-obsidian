// vault-routes.test.mjs — v7 vault 管理端点测试（先红后绿）。
// 覆盖：GET /vaults、POST /vault/switch、/vault/activate、/vault/attach、/vault/remove、
// 写端点同源 403、单库模式（传 VaultStore）向后兼容。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { VaultStore } from './lib/vault-store.js'
import { VaultManager } from './lib/vault-manager.js'
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
  queueMicrotask(() => {
    if (body !== undefined) request.emit('data', Buffer.from(body))
    request.emit('end')
  })
  return done
}

const JSON_HDR = { 'content-type': 'application/json' }
const SAME_ORIGIN = { origin: 'http://localhost:3080', host: 'localhost:3080' }

function setup(t, workspaceNames = []) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-vroutes-'))
  const reg = join(dir, 'registry', 'vaults.json')
  const cwd = join(dir, 'cwd-project')
  mkdirSync(cwd, { recursive: true })
  const ws = workspaceNames.map((n) => join(dir, n))
  for (const w of ws) mkdirSync(w, { recursive: true })
  const manager = new VaultManager({ registryFile: reg, cwdRoot: cwd, workspaceRoots: ws.map((p) => ({ path: p })) })
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, manager)
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, reg, cwd, ws, manager, handlers }
}

test('GET /vaults 返回当前库与列表（含 pageCount）', async (t) => {
  const s = setup(t, ['proj-a'])
  const r = await req(s.handlers, '/api/obsidian-wiki/vaults')
  assert.equal(r.status, 200)
  assert.equal(r.json.current.root, s.cwd)
  assert.equal(r.json.vaults.length, 2)
  assert.equal(typeof r.json.vaults[0].pageCount, 'number')
})

test('POST /vault/switch 切换当前库，/pages 反映新库', async (t) => {
  const s = setup(t, ['proj-a'])
  // 给 proj-a 库写一页，验证切换后 pages 变化
  const aStore = new VaultStore(join(s.dir, 'proj-a'))
  aStore.ensure()
  aStore.writePage({ id: 'alpha', title: 'Alpha', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: '', updated: '', body: 'a' })
  const target = s.manager.listVaults().find((v) => v.source === 'workspace')
  const r = await req(s.handlers, '/api/obsidian-wiki/vault/switch', { method: 'POST', headers: { ...JSON_HDR, ...SAME_ORIGIN }, body: JSON.stringify({ id: target.id }) })
  assert.equal(r.status, 200)
  assert.equal(r.json.current.id, target.id)
  const pages = await req(s.handlers, '/api/obsidian-wiki/pages')
  assert.equal(pages.json.total, 1)
  assert.equal(pages.json.pages[0].id, 'alpha')
})

test('POST /vault/activate 按目录激活；未注册目录自动挂接', async (t) => {
  const s = setup(t)
  const fresh = join(s.dir, 'activated')
  const r = await req(s.handlers, '/api/obsidian-wiki/vault/activate', { method: 'POST', headers: { ...JSON_HDR, ...SAME_ORIGIN }, body: JSON.stringify({ root: fresh }) })
  assert.equal(r.status, 200)
  assert.equal(r.json.current.root, fresh)
  assert.ok(r.json.vaults.some((v) => v.root === fresh && v.source === 'attached'))
})

test('POST /vault/attach 新建/挂接并切换；同根幂等', async (t) => {
  const s = setup(t)
  const root = join(s.dir, 'attach-me')
  const r1 = await req(s.handlers, '/api/obsidian-wiki/vault/attach', { method: 'POST', headers: { ...JSON_HDR, ...SAME_ORIGIN }, body: JSON.stringify({ root, name: '挂接库' }) })
  assert.equal(r1.status, 200)
  assert.equal(r1.json.current.name, '挂接库')
  const r2 = await req(s.handlers, '/api/obsidian-wiki/vault/attach', { method: 'POST', headers: { ...JSON_HDR, ...SAME_ORIGIN }, body: JSON.stringify({ root }) })
  assert.equal(r2.json.current.id, r1.json.current.id)
})

test('POST /vault/remove 移除 attached 库；当前落到其余库', async (t) => {
  const s = setup(t)
  await req(s.handlers, '/api/obsidian-wiki/vault/attach', { method: 'POST', headers: { ...JSON_HDR, ...SAME_ORIGIN }, body: JSON.stringify({ root: join(s.dir, 'tmp-a') }) })
  await req(s.handlers, '/api/obsidian-wiki/vault/attach', { method: 'POST', headers: { ...JSON_HDR, ...SAME_ORIGIN }, body: JSON.stringify({ root: join(s.dir, 'tmp-b') }) })
  const list = await req(s.handlers, '/api/obsidian-wiki/vaults')
  const target = list.json.vaults.find((v) => v.name === 'tmp-a')
  const r = await req(s.handlers, '/api/obsidian-wiki/vault/remove', { method: 'POST', headers: { ...JSON_HDR, ...SAME_ORIGIN }, body: JSON.stringify({ id: target.id }) })
  assert.equal(r.status, 200)
  assert.notEqual(r.json.current.id, target.id)
  assert.ok(!r.json.vaults.some((v) => v.id === target.id))
})

test('写端点缺 Origin/Referer → 403', async (t) => {
  const s = setup(t)
  const r = await req(s.handlers, '/api/obsidian-wiki/vault/switch', { method: 'POST', headers: JSON_HDR, body: JSON.stringify({ id: 'whatever' }) })
  assert.equal(r.status, 403)
})

test('单库模式：传 VaultStore 时 /vaults 返回一个库，写端点 404', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-vroutes-single-'))
  const store = new VaultStore(dir)
  store.ensure()
  const { host, handlers } = makeHost()
  mountWikiRoutes(host, store)
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const r = await req(handlers, '/api/obsidian-wiki/vaults')
  assert.equal(r.status, 200)
  assert.equal(r.json.vaults.length, 1)
  assert.equal(r.json.current.root, dir)
  const sw = await req(handlers, '/api/obsidian-wiki/vault/switch', { method: 'POST', headers: { ...JSON_HDR, ...SAME_ORIGIN }, body: JSON.stringify({ id: 'x' }) })
  assert.equal(sw.status, 404)
})
