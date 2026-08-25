// retriever.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from './lib/vault-store.js'
import { retrieve } from './lib/retriever.js'

function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-retriever-'))
  const store = new VaultStore(dir)
  store.ensure()
  return { dir, store }
}

function seed(store) {
  const now = '2026-08-25T00:00:00.000Z'
  store.writePage({ id: 'rate-limiting', title: 'Rate Limiting 踩坑', category: 'concepts', tags: ['rate-limiting', 'api'], source: 's', confidence: 'extracted', created: now, updated: now, body: '429 处理要指数退避。重试窗口要加抖动。' })
  store.writePage({ id: 'stale-closure', title: 'React Stale Closure', category: 'concepts', tags: ['react', 'hooks'], source: 's', confidence: 'extracted', created: now, updated: now, body: '闭包捕获旧值，useEffect 依赖数组要写全。' })
  store.writePage({ id: 'orders', title: '订单模块', category: 'projects', tags: ['orders', 'billing'], source: 's', confidence: 'inferred', created: now, updated: now, body: '订单状态机：created → paid → shipped。' })
}

test('空查询返回空结果', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  const r = retrieve(store, '   ')
  assert.equal(r.candidates.length, 0)
  assert.equal(r.strategy, 'empty-query')
})

test('L1 index-only 模式只读 index.md 命中行', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  // 在 index.md 里写入一个提及
  writeFileSync(join(dir, '.wiki', 'index.md'), '# Wiki Index\n\n## 概念页\n- [[rate-limiting]]\n', 'utf8')
  const r = retrieve(store, 'rate-limiting', { mode: 'index-only' })
  assert.equal(r.strategy, 'index-only')
  assert.ok(r.candidates.some((c) => c.page.includes('rate-limiting')), 'index-only 应从 index.md 命中')
})

test('L2 标题匹配返回带 confidence 的候选', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  const r = retrieve(store, 'rate limiting')
  assert.ok(r.candidates.some((c) => c.id === 'rate-limiting' && c.matchedBy === 'title'))
  assert.equal(r.candidates.find((c) => c.id === 'rate-limiting').confidence, 'extracted')
  assert.ok(r.totalPages >= 3)
})

test('L2 标签匹配（标题不含但标签含）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  const r = retrieve(store, 'billing')
  assert.ok(r.candidates.some((c) => c.id === 'orders' && c.matchedBy === 'tag'))
})

test('L3 正文匹配返回 snippet（截断 ≤200 字符）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  const r = retrieve(store, '指数退避')
  const hit = r.candidates.find((c) => c.id === 'rate-limiting')
  assert.ok(hit, '正文命中应返回 rate-limiting')
  assert.equal(hit.matchedBy, 'body')
  assert.ok(hit.snippet.length <= 200, 'snippet 应截断')
  assert.ok(hit.snippet.includes('指数退避'))
})

test('L2 命中足够时不升 L3（strategy 为 title+tag）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  const r = retrieve(store, 'rate limiting')
  assert.equal(r.strategy, 'title+tag', '标题命中后不应再查正文')
})

test('maxCandidates 限制候选数', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  const r = retrieve(store, 'a', { maxCandidates: 1 })
  assert.ok(r.candidates.length <= 1)
})
