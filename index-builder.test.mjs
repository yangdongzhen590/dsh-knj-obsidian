// index-builder.test.mjs — 重建索引（先红后绿）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from './lib/vault-store.js'
import { rebuildIndex } from './lib/index-builder.js'

const NOW = '2026-08-26T00:00:00.000Z'

function makeVault(pages = []) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-idx-'))
  const store = new VaultStore(dir)
  store.ensure()
  for (const p of pages) store.writePage({ tags: [], source: 't', confidence: 'extracted', created: NOW, updated: NOW, ...p })
  return { dir, store }
}

test('多页重建：每页一行 [[id]] 标题 — 摘要，按分类分节', () => {
  const { dir, store } = makeVault([
    { id: 'orders', title: '订单', category: 'projects', body: '订单流程说明。' },
    { id: 'rate-limit', title: '限流', category: 'concepts', body: '# 限流\n\n429 指数退避策略。参考 [[orders]]。' },
  ])
  try {
    const report = rebuildIndex(store)
    assert.equal(report.pageCount, 2)
    const idx = readFileSync(join(dir, '.wiki', 'index.md'), 'utf8')
    assert.ok(idx.includes('- [[orders]] 订单 — 订单流程说明。'), 'projects 行: ' + idx)
    assert.ok(idx.includes('- [[rate-limit]] 限流 — 429 指数退避策略。'), 'concepts 行（摘要跳过标题行）')
    // 分类分节顺序
    assert.ok(idx.indexOf('## 概念页') < idx.indexOf('## 项目知识'), '分节按固定分类顺序')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('摘要截断 60 字；无正文页只有标题行', () => {
  const long = '甲'.repeat(100)
  const { dir, store } = makeVault([
    { id: 'long-one', title: '长页', category: 'references', body: long },
    { id: 'empty', title: '空页', category: 'synthesis', body: '' },
  ])
  try {
    rebuildIndex(store)
    const idx = readFileSync(join(dir, '.wiki', 'index.md'), 'utf8')
    const line = idx.split('\n').find((l) => l.includes('[[long-one]]'))
    assert.ok(line.includes('甲'.repeat(60)), '摘要截到 60 字')
    assert.ok(!line.includes('甲'.repeat(61)))
    const emptyLine = idx.split('\n').find((l) => l.includes('[[empty]]'))
    assert.ok(emptyLine.includes('[[empty]] 空页'), '空正文页仍有行')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('幂等：连续重建两次输出逐字节一致；空库产出仅分节模板', () => {
  const { dir, store } = makeVault([{ id: 'a', title: 'A', category: 'concepts', body: '内容' }])
  try {
    rebuildIndex(store)
    const first = readFileSync(join(dir, '.wiki', 'index.md'), 'utf8')
    rebuildIndex(store)
    const second = readFileSync(join(dir, '.wiki', 'index.md'), 'utf8')
    assert.equal(first, second)

    const dir2 = mkdtempSync(join(tmpdir(), 'dsh-obsidian-idx2-'))
    try {
      const s2 = new VaultStore(dir2)
      s2.ensure()
      const r = rebuildIndex(s2)
      assert.equal(r.pageCount, 0)
      const idx = readFileSync(join(dir2, '.wiki', 'index.md'), 'utf8')
      assert.ok(idx.includes('## 概念页') && !idx.includes('[[', 20), '空库无链接行')
    } finally { rmSync(dir2, { recursive: true, force: true }) }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
