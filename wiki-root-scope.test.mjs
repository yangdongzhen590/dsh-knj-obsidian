/**
 * 路由作用域：`?root=` 必须把请求钉在该会话的工作区库上。
 *
 * 缺陷背景（2026-10-24 实测）：面板与全部数据端点都读 provider 的**全局当前库**，
 * 于是「切换到另一个工作区」后，边栏仍显示上一个库的标题/页树；且全局单值会被
 * 最后 activate 的面板劫持。契约：带 root 时按 root 只读解析，解析不出库就明确报
 * `vault-not-initialized`，**绝不回退全局库**（回退正是答偏来源）。
 *
 * 用编译产物 lib/routes.js 验证（宿主实际加载的就是它）：先构建再跑本文件。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const { mountWikiRoutes } = await import(pathToFileURL(join(ROOT, 'lib/routes.js')).href)

const OBSIDIAN = 'D:\\dsh-knj\\dsh-knj-obsidian'
const SCHEDULER = 'D:\\dsh-knj\\dsh-knj-scheduler'

function fakeStore(vaultRoot, pages) {
  // 与真实 VaultStore 一致：wikiRoot = <vaultRoot>/.wiki（项目目录本身不是 .wiki）
  return {
    wikiRoot: vaultRoot + '\\.wiki',
    listPagesReadonly: () => pages.map((p) => ({ id: p.id, category: p.category, title: p.title })),
    readPage: (id, category) => pages.find((p) => p.id === id && p.category === category) ?? null,
  }
}

/**
 * provider 记录调用：任何「回退全局库」都必须能在 fallbackCalls 里看到。
 */
function makeProvider() {
  const calls = { byRoot: [], fallbackReads: 0, fallbackWrites: 0 }
  const obsidianStore = fakeStore(OBSIDIAN, [{ id: 'page-a', category: 'concepts', title: 'A', confidence: 'extracted' }])
  const provider = {
    current() { calls.fallbackWrites += 1; return obsidianStore },
    currentReadonly() { calls.fallbackReads += 1; return obsidianStore },
    currentRecord() { return { id: 'v-obsidian', name: 'dsh-knj-obsidian', root: OBSIDIAN, source: 'workspace' } },
    listVaults() {
      return [
        { id: 'v-obsidian', name: 'dsh-knj-obsidian', root: OBSIDIAN, source: 'workspace', pageCount: 1, initialized: true },
        { id: 'v-scheduler', name: 'dsh-knj-scheduler', root: SCHEDULER, source: 'workspace', pageCount: 0, initialized: false },
      ]
    },
    readonlyVaultForRoot(root) {
      calls.byRoot.push(String(root))
      if (String(root).toLowerCase() === OBSIDIAN.toLowerCase()) return { store: obsidianStore, name: 'dsh-knj-obsidian' }
      return undefined
    },
    recordForRoot(root) {
      if (String(root).toLowerCase() === OBSIDIAN.toLowerCase()) return { id: 'v-obsidian', name: 'dsh-knj-obsidian', root: OBSIDIAN, source: 'workspace' }
      return undefined
    },
  }
  return { provider, calls }
}

function mount(provider) {
  let handler
  const host = { webServer: { register: (route) => { handler = route.handler; return () => {} } } }
  mountWikiRoutes(host, provider, { refresherFor: () => ({ status: async () => ({}), refreshNow: async () => {} }) })
  return handler
}

async function call(handler, url, method = 'GET') {
  const request = { url, method, headers: {}, on() {} }
  const out = { status: 0, body: undefined }
  const response = {
    setHeader() {},
    writeHead(status) { out.status = status; return response },
    end(payload) { out.body = payload === undefined ? undefined : JSON.parse(payload) },
  }
  await handler(request, response)
  return out
}

test('GET /pages?root=已初始化库 → 走该库，且不回退全局库', async () => {
  const { provider, calls } = makeProvider()
  const res = await call(mount(provider), '/api/obsidian-wiki/pages?root=' + encodeURIComponent(OBSIDIAN))
  assert.equal(res.status, 200)
  assert.equal(res.body.total, 1)
  assert.equal(calls.fallbackReads, 0, '带 root 解析成功时不应读全局当前库')
  assert.deepEqual(calls.byRoot, [OBSIDIAN])
})

test('GET /pages?root=未初始化工作区 → 409 vault-not-initialized，绝不回退全局库', async () => {
  const { provider, calls } = makeProvider()
  const res = await call(mount(provider), '/api/obsidian-wiki/pages?root=' + encodeURIComponent(SCHEDULER))
  assert.equal(res.status, 409)
  assert.equal(res.body.code, 'vault-not-initialized')
  assert.equal(calls.fallbackReads, 0, '解析不出库时回退全局库 = 答偏根源')
  assert.equal(calls.fallbackWrites, 0)
})

test('GET /vaults?root=已初始化库 → current 指向该库并带 followedRoot', async () => {
  const { provider } = makeProvider()
  const res = await call(mount(provider), '/api/obsidian-wiki/vaults?root=' + encodeURIComponent(OBSIDIAN))
  assert.equal(res.status, 200)
  assert.equal(res.body.current?.root, OBSIDIAN, '库根是项目目录，不是 <项目>/.wiki（否则下拉框 value 匹配不到任何 option，浏览器回落到第一个库 = iobs_pro）')
  assert.equal(res.body.current?.id, 'v-obsidian', 'id 必须能在 vaults 列表里匹配到，否则 select 会显示错误的库')
  assert.ok(res.body.vaults.some((v) => v.id === res.body.current.id), 'current.id 必须存在于 vaults 列表')
  assert.equal(res.body.followedRoot, OBSIDIAN)
  assert.equal(res.body.vaults.length, 2)
})

test('GET /vaults?root=未初始化工作区 → current=null + uninitialized，仍返回库列表', async () => {
  const { provider, calls } = makeProvider()
  const res = await call(mount(provider), '/api/obsidian-wiki/vaults?root=' + encodeURIComponent(SCHEDULER))
  assert.equal(res.status, 200)
  assert.equal(res.body.current, null)
  assert.equal(res.body.uninitialized, true)
  assert.equal(res.body.followedRoot, SCHEDULER)
  assert.equal(res.body.vaults.length, 2)
  assert.equal(calls.fallbackReads, 0)
})

test('不带 root → 保持旧全局行为（兼容无会话上下文的调用方）', async () => {
  const { provider, calls } = makeProvider()
  const res = await call(mount(provider), '/api/obsidian-wiki/pages')
  assert.equal(res.status, 200)
  assert.equal(calls.fallbackReads, 1)
  assert.equal(calls.byRoot.length, 0)
})
