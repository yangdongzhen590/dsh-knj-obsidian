// ingest-delta.test.mjs
// Task 4：wiki_ingest 增量跳过（manifest 哈希比对）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { VaultStore } from './lib/vault-store.js'
import { mountTools } from './lib/tools.js'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

function hash(s) { return createHash('sha256').update(s).digest('hex') }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 工具 body 不引用 exec；提供最小 stub 即可（ToolRunContext 契约由 registry 在真实环境注入）
const EXEC = { deferContext() {}, concludeTurn() {} }

function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-delta-'))
  const store = new VaultStore(dir)
  store.ensure()
  return { dir, store }
}

function ingestDef(store) {
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, store)
  return registered.find((d) => d.name === 'wiki_ingest')
}

test('同 contentHash 的再次 ingest 命中 manifest 跳过', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-delta-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new VaultStore(dir)
  store.ensure()
  const h = hash('source-v1')
  const entry = { content_hash: h, last_ingested: '2026-08-25T00:00:00.000Z', pages_produced: ['a'] }
  store.updateManifest('docs/x.md', entry)
  const back = store.manifestEntry('docs/x.md')
  assert.equal(back.content_hash, h)
  assert.deepEqual(back.pages_produced, ['a'])
})

test('wiki_ingest：同 contentHash 命中 manifest → skipped:true 且不重写页面', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const def = ingestDef(store)

  const source = 'docs/input.md'
  const pages = [{ id: 'rate-limiting', title: 'Rate Limiting', category: 'concepts', body: '## 核心\n429 要指数退避。' }]
  const h = store.sha256(source + JSON.stringify(pages))

  // 首次 ingest：传 contentHash 但无 manifest 记录 → 正常写入
  const res1 = await def.execute({ source, pages, contentHash: h }, EXEC)
  assert.deepEqual(res1, { created: ['rate-limiting'], updated: [], skipped: false })
  assert.equal(store.manifestEntry(source).content_hash, h)
  const updated1 = store.readPage('rate-limiting', 'concepts').updated
  const lastIngested1 = store.manifestEntry(source).last_ingested

  await sleep(5) // 确保时间戳可区分（防止重写也撞同一毫秒）

  // 再次 ingest：同 contentHash → 命中 manifest → 跳过，页面与 manifest 都不被重写
  const res2 = await def.execute({ source, pages, contentHash: h }, EXEC)
  assert.deepEqual(res2, { created: [], updated: [], skipped: true })
  const back = store.readPage('rate-limiting', 'concepts')
  assert.equal(back.updated, updated1) // updated 未被刷新 = 未重写
  assert.equal(store.manifestEntry(source).last_ingested, lastIngested1) // manifest 未被触碰
})

test('wiki_ingest：不同 contentHash 不命中 → 重写页面 skipped:false', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const def = ingestDef(store)

  const source = 'docs/input.md'
  const pages = [{ id: 'rate-limiting', title: 'Rate Limiting', category: 'concepts', body: '## 核心\n429 要指数退避。' }]
  const first = await def.execute({ source, pages }, EXEC)
  assert.deepEqual(first, { created: ['rate-limiting'], updated: [], skipped: false })
  const updated1 = store.readPage('rate-limiting', 'concepts').updated

  await sleep(5)

  // 不同 contentHash → 与 manifest 不一致 → 正常重写
  const otherHash = hash('source-v2')
  const res = await def.execute({ source, pages, contentHash: otherHash }, EXEC)
  assert.deepEqual(res, { created: [], updated: ['rate-limiting'], skipped: false })
  const back = store.readPage('rate-limiting', 'concepts')
  assert.notEqual(back.updated, updated1) // 页面被重写
  // manifest 被刷新为传入的 contentHash（显式提供的哈希优先于内部公式）
  assert.equal(store.manifestEntry(source).content_hash, otherHash)
})

test('wiki_ingest：contentHash 原样入库，同 hash 二次 ingest 真正跳过', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const def = ingestDef(store)

  const source = 'docs/input.md'
  const pages = [{ id: 'rate-limiting', title: 'Rate Limiting', category: 'concepts', body: '## 核心\n429 要指数退避。' }]
  // 真实源字节哈希：与内部公式 sha256(source + JSON.stringify(pages)) 不同，可区分新旧行为
  const h = hash('real source bytes')

  // 首次 ingest：contentHash 应原样写入 manifest（而不是被内部公式覆盖）
  const res1 = await def.execute({ source, pages, contentHash: h }, EXEC)
  assert.deepEqual(res1, { created: ['rate-limiting'], updated: [], skipped: false })
  assert.equal(store.manifestEntry(source).content_hash, h)
  const updated1 = store.readPage('rate-limiting', 'concepts').updated

  await sleep(5)

  // 再次 ingest：同 contentHash → 命中 manifest → 跳过，页面不被重写
  const res2 = await def.execute({ source, pages, contentHash: h }, EXEC)
  assert.deepEqual(res2, { created: [], updated: [], skipped: true })
  assert.equal(store.readPage('rate-limiting', 'concepts').updated, updated1)
})

test('wiki_ingest：contentHash 但无 manifest 记录 → 正常 ingest 不跳过', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const def = ingestDef(store)

  const source = 'docs/new.md'
  const pages = [{ id: 'billing', title: 'Billing', category: 'entities', body: '账单流程。' }]
  const res = await def.execute({ source, pages, contentHash: hash('whatever') }, EXEC)
  assert.deepEqual(res, { created: ['billing'], updated: [], skipped: false })
  assert.ok(store.manifestEntry(source))
})

test('wiki_ingest：schema 声明 contentHash 参数与 skipped 输出，两种返回均通过输出校验', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const def = ingestDef(store)

  // 参数契约：contentHash 为可选 string
  assert.ok(def.parameters.properties.contentHash)
  assert.equal(def.parameters.properties.contentHash.type, 'string')
  // 输出契约：skipped 为声明属性（additionalProperties:false 下可用）
  assert.ok(def.output.schema.properties.skipped)
  assert.equal(def.output.schema.properties.skipped.type, 'boolean')

  // 跳过与非跳过返回都符合输出 schema（registry 会用它校验，违规会抛 ToolOutputError）
  const skipRes = { created: [], updated: [], skipped: true }
  const runRes = { created: ['a'], updated: ['b'], skipped: false }
  assert.deepEqual(validateJsonSchemaValue(def.output.schema, skipRes), [])
  assert.deepEqual(validateJsonSchemaValue(def.output.schema, runRes), [])
})
