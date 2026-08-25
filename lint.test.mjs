// lint.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from './lib/vault-store.js'
import { lintVault } from './lib/lint.js'

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-lint-'))
  const store = new VaultStore(dir)
  store.ensure()
  return { dir, store }
}

test('孤儿页被识别', (t) => {
  const { dir, store } = makeStore()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.writePage({ id: 'a', title: 'A', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: 'b' })
  store.writePage({ id: 'b', title: 'B', category: 'entities', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: 'b' })
  const report = lintVault(store)
  assert.deepEqual(report.orphans.sort(), ['a', 'b'])
  assert.equal(report.pageCount, 2)
})

test('断链（指向不存在页面）被识别', (t) => {
  const { dir, store } = makeStore()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.writePage({ id: 'a', title: 'A', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: '参考 [[ghost-page]] 与 [[b]]' })
  store.writePage({ id: 'b', title: 'B', category: 'entities', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: 'ok' })
  const report = lintVault(store)
  assert.deepEqual(report.brokenLinks, [{ from: 'a', target: 'ghost-page' }])
  assert.deepEqual(report.orphans.sort(), ['a', 'b']) // 双向链接未织好前都算孤儿
})
