// vault-store.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from './lib/vault-store.js'

function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-vault-'))
  return { dir, store: new VaultStore(dir) }
}

test('ensure 创建 .wiki 结构与 index.md（幂等）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.ensure()
  for (const c of ['concepts', 'entities', 'references', 'synthesis', 'projects', '_raw']) {
    assert.ok(existsSync(join(dir, '.wiki', c)), `缺少目录 ${c}`)
  }
  assert.ok(existsSync(join(dir, '.wiki', 'index.md')))
  const index = readFileSync(join(dir, '.wiki', 'index.md'), 'utf8')
  assert.match(index, /概念页/)
  // 幂等：再调一次不抛错
  store.ensure()
})

test('writePage 写出 frontmatter + body，readPage 读回', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.ensure()
  const page = {
    id: 'rate-limiting', title: 'Rate Limiting 踩坑', category: 'concepts',
    tags: ['rate-limiting', 'api'], source: 'docs/notes.md', confidence: 'extracted',
    created: '2026-08-25T00:00:00.000Z', updated: '2026-08-25T00:00:00.000Z',
    body: '## 核心\n429 处理要指数退避。',
  }
  const res = store.writePage(page)
  assert.equal(res.created, true)
  const back = store.readPage('rate-limiting', 'concepts')
  assert.ok(back)
  assert.equal(back.title, 'Rate Limiting 踩坑')
  assert.equal(back.confidence, 'extracted')
  assert.match(back.body, /指数退避/)
  const raw = readFileSync(join(dir, '.wiki', 'concepts', 'rate-limiting.md'), 'utf8')
  assert.match(raw, /^---\n/)
  assert.match(raw, /confidence: extracted/)
})

test('writePage 覆盖已存在页返回 created=false', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.ensure()
  const page = { id: 'x', title: 'X', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: 'b' }
  store.writePage(page)
  const again = store.writePage({ ...page, body: 'b2' })
  assert.equal(again.created, false)
  assert.equal(store.readPage('x', 'concepts').body, 'b2')
})

test('sha256 稳定且区分内容', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const h1 = store.sha256('hello')
  const h2 = store.sha256('hello')
  const h3 = store.sha256('hello!')
  assert.equal(h1, h2)
  assert.notEqual(h1, h3)
  assert.match(h1, /^[0-9a-f]{64}$/)
})

test('manifest 记录与读取', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.ensure()
  const entry = { content_hash: 'abc123', last_ingested: '2026-08-25T00:00:00.000Z', pages_produced: ['a', 'b'] }
  store.updateManifest('docs/x.md', entry)
  const back = store.manifestEntry('docs/x.md')
  assert.deepEqual(back, entry)
  assert.equal(store.manifestEntry('docs/never.md'), undefined)
})

test('listPages 返回全库页面清单', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.ensure()
  store.writePage({ id: 'a', title: 'A', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: 'b' })
  store.writePage({ id: 'b', title: 'B', category: 'entities', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: 'b' })
  const pages = store.listPages()
  assert.equal(pages.length, 2)
  assert.ok(pages.some((p) => p.id === 'a' && p.category === 'concepts'))
})

test('writePage 拒绝越权 id（路径穿越防护），readPage 对非法 id 返回 null', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.ensure()
  assert.throws(() => store.writePage({
    id: '../../evil', title: 'Evil', category: 'concepts', tags: [], source: 's',
    confidence: 'extracted', created: 'c', updated: 'u', body: 'b',
  }), /invalid page id/)
  // 非法 id 不得触碰文件系统
  assert.equal(store.readPage('../../evil', 'concepts'), null)
  assert.ok(!existsSync(join(dir, '.wiki', 'concepts', 'evil.md')))
  assert.ok(!existsSync(join(dir, 'evil.md')))
})

test('readPage 解析 CRLF 行尾的文件（Windows / git autocrlf）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.ensure()
  const raw = [
    '---', 'id: crlf-page', 'title: CRLF 页', 'category: concepts', 'tags: []',
    'source: docs/notes.md', 'confidence: extracted', 'created: c', 'updated: u', '---',
    '', '## 正文', '第一行', '第二行', '',
  ].join('\r\n')
  writeFileSync(join(dir, '.wiki', 'concepts', 'crlf-page.md'), raw, 'utf8')
  const back = store.readPage('crlf-page', 'concepts')
  assert.ok(back)
  assert.equal(back.title, 'CRLF 页')
  assert.equal(back.source, 'docs/notes.md')
  assert.match(back.body, /第一行/)
  assert.match(back.body, /第二行/)
})
