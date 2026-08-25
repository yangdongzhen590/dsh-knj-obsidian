// tools.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from './lib/vault-store.js'
import { mountTools } from './lib/tools.js'

// 工具 body 不引用 exec；提供最小 stub 即可（ToolRunContext 契约由 registry 在真实环境注入）
const EXEC = { deferContext() {}, concludeTurn() {} }

function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-tools-'))
  const store = new VaultStore(dir)
  store.ensure()
  return { dir, store }
}

test('store 实例 + ensure 后 .wiki 可写（工具执行的存储基座）', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-tools-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new VaultStore(dir)
  store.ensure()
  assert.ok(existsSync(join(dir, '.wiki', '.manifest.json')))
  assert.ok(existsSync(join(dir, '.wiki', 'index.md')))
})

test('mountTools 注册 wiki_ingest + wiki_capture 并返回 dispose', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  const dispose = mountTools(fakeCtx, store)
  const names = registered.map((d) => d.name)
  assert.deepEqual(names.sort(), ['wiki_capture', 'wiki_ingest'])
  assert.equal(typeof dispose, 'function')
})

test('wiki_ingest 落盘页面并更新 manifest（created/updated 分流）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, store)
  const def = registered.find((d) => d.name === 'wiki_ingest')

  const source = 'docs/input.md'
  const pages = [
    { id: 'rate-limiting', title: 'Rate Limiting', category: 'concepts', tags: ['api'], confidence: 'extracted', body: '## 核心\n429 要指数退避。' },
    // confidence 缺省 → extracted
    { id: 'billing', title: 'Billing', category: 'entities', body: '账单流程。' },
  ]
  const res = await def.execute({ source, pages }, EXEC)
  assert.deepEqual(res, { created: ['rate-limiting', 'billing'], updated: [], skipped: false })

  // 页面与 frontmatter 落盘
  const raw = readFileSync(join(dir, '.wiki', 'concepts', 'rate-limiting.md'), 'utf8')
  assert.match(raw, /^---\n/)
  assert.match(raw, /confidence: extracted/)
  assert.match(raw, /source: docs\/input\.md/)
  assert.ok(existsSync(join(dir, '.wiki', 'entities', 'billing.md')))

  // manifest 记录 source → 内容哈希 + 产出页面
  const entry = store.manifestEntry(source)
  assert.ok(entry)
  assert.equal(entry.content_hash, store.sha256(source + JSON.stringify(pages)))
  assert.deepEqual(entry.pages_produced, ['rate-limiting', 'billing'])
})

test('wiki_ingest 重写同 id 页面：保留 created、更新 updated', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, store)
  const def = registered.find((d) => d.name === 'wiki_ingest')

  const source = 'docs/input.md'
  const first = { id: 'rate-limiting', title: 'Rate Limiting', category: 'concepts', body: '## 核心\n429 要指数退避。' }
  await def.execute({ source, pages: [first] }, EXEC)
  const createdAt = store.readPage('rate-limiting', 'concepts').created

  const second = { ...first, body: '## 核心\n429 要指数退避，且要有 jitter。' }
  const res = await def.execute({ source, pages: [second] }, EXEC)
  assert.deepEqual(res, { created: [], updated: ['rate-limiting'], skipped: false })

  const back = store.readPage('rate-limiting', 'concepts')
  assert.equal(back.created, createdAt) // created 保留
  assert.notEqual(back.updated, createdAt)
  assert.match(back.body, /jitter/)
})

test('wiki_ingest 校验必填参数（缺 source 报错）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, store)
  const def = registered.find((d) => d.name === 'wiki_ingest')
  await assert.rejects(def.execute({ pages: [] }, EXEC))
})

test('wiki_capture 沉淀单页（默认 references/，confidence=inferred）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, store)
  const def = registered.find((d) => d.name === 'wiki_capture')

  const r = await def.execute({ title: ' 关于 429 的总结 ', body: '知识内容：指数退避。' }, EXEC)
  assert.equal(r.page, 'references/关于-429-的总结.md')
  const raw = readFileSync(join(dir, '.wiki', 'references', '关于-429-的总结.md'), 'utf8')
  assert.match(raw, /confidence: inferred/)
  assert.match(raw, /source: agent:capture/)
  assert.match(raw, /指数退避/)
})
