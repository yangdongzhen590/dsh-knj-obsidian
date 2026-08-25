// lint.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

test('别名/锚点语法出链计入 hasOut，不产生假孤儿', (t) => {
  const { dir, store } = makeStore()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  // a 的唯一出链是别名语法 [[b|别名]]；c 链回 a 提供入链。
  // 旧实现用窄正则 /\[\[[^\]|#]+\]\]/ 判 hasOut，识别不出别名语法 → a 被误报孤儿。
  store.writePage({ id: 'a', title: 'A', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: '参考 [[b|别名]]' })
  store.writePage({ id: 'b', title: 'B', category: 'entities', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: 'ok' })
  store.writePage({ id: 'c', title: 'C', category: 'references', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: '链接 [[a]]' })
  const report = lintVault(store)
  // a 有出链（WIKILINK_RE 计入别名语法）且有入链（c→a）→ 非孤儿；b 无出链 → 孤儿；c 无入链 → 孤儿
  assert.ok(!report.orphans.includes('a'), `a 不应是孤儿，实际 ${JSON.stringify(report.orphans)}`)
  assert.deepEqual(report.orphans.sort(), ['b', 'c'])
  assert.deepEqual(report.brokenLinks, [])
})

test('无 frontmatter 的页面被 lint 标记缺 frontmatter', (t) => {
  const { dir, store } = makeStore()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.writePage({ id: 'ok', title: 'OK', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: '正常页' })
  // 手工写入一个完全没有 frontmatter 的文件（仅 markdown 标题）
  writeFileSync(join(dir, '.wiki', 'concepts', 'plain.md'), '# 无 frontmatter\n\n正文内容。\n', 'utf8')
  const report = lintVault(store)
  assert.ok(report.missingFrontmatter.includes('plain'), `missingFrontmatter 应包含 plain，实际 ${JSON.stringify(report.missingFrontmatter)}`)
  assert.equal(report.pageCount, 2)
})
