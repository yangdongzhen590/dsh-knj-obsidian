// lint.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
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

test('行内代码里的 [[wikilink]] 是示例字面量，不算断链', (t) => {
  const { dir, store } = makeStore()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  // 复现 2026-10-24 实测：能力页正文用 `[[wikilink]]` 讲"链接长什么样"，
  // 旧实现直接对正文跑 WIKILINK_RE，把它当成真链接 → 报出不存在的断链。
  store.writePage({ id: 'a', title: 'A', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: '链接写作 `[[wikilink]]`；真链接是 [[b]]' })
  store.writePage({ id: 'b', title: 'B', category: 'entities', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: 'ok' })
  const report = lintVault(store)
  assert.deepEqual(report.brokenLinks, [], '行内代码里的字面量不应产生断链')
})

test('围栏代码块里的 [[x]] 不算断链', (t) => {
  const { dir, store } = makeStore()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.writePage({ id: 'a', title: 'A', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: '示例：\n\n```md\n[[ghost]]\n```\n\n真链接 [[b]]' })
  store.writePage({ id: 'b', title: 'B', category: 'entities', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: 'ok' })
  const report = lintVault(store)
  assert.deepEqual(report.brokenLinks, [], '围栏代码块里的内容不应产生断链')
})

test('代码之外的断链仍必须报（防止剥代码剥过头）', (t) => {
  const { dir, store } = makeStore()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.writePage({ id: 'a', title: 'A', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: '正文 [[ghost]] 是真断链；行内 `[[ghost2]]` 不是' })
  const report = lintVault(store)
  assert.deepEqual(report.brokenLinks, [{ from: 'a', target: 'ghost' }])
})

test('index 页不计孤儿（索引天然无入链）', (t) => {
  const { dir, store } = makeStore()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.writePage({ id: 'index', title: 'Index', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: '索引页，不链任何页' })
  store.writePage({ id: 'a', title: 'A', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: '见 [[b]]' })
  store.writePage({ id: 'b', title: 'B', category: 'entities', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: '回到 [[a]]' })
  const report = lintVault(store)
  assert.ok(!report.orphans.includes('index'), `index 不应计入孤儿，实际 ${JSON.stringify(report.orphans)}`)
  assert.deepEqual(report.orphans, [], 'a/b 有出有入，不应是孤儿')
})

test('lint 是只读操作：不给未初始化的库建 .wiki', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-lint-ro-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new VaultStore(dir)
  assert.equal(existsSync(join(dir, '.wiki')), false, '夹具前提：目录里还没有 .wiki')
  const report = lintVault(store)
  assert.equal(report.pageCount, 0)
  // 旧实现走 listPages()（内部 ensure()），一次只读 lint 就凭空建出脚手架。
  assert.equal(existsSync(join(dir, '.wiki')), false, 'lint 不应创建 .wiki')
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
