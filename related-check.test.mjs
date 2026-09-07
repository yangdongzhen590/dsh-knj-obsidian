// v9 relatedHits：写页后检索库内相关已有页（linked/strong/exclude）单测。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from './lib/vault-store.js'
import { relatedHits } from './lib/related-check.js'

function freshVault() {
  const dir = mkdtempSync(join(tmpdir(), 'knj-rel-'))
  const store = new VaultStore(dir)
  store.ensure()
  return { store, dir }
}

const now = '2026-09-05T00:00:00.000Z'
function page(id, title, category, body) {
  return { id, title, category, tags: [], source: 'agent:test', confidence: 'extracted', created: now, updated: now, body }
}

test('relatedHits 报告同名/近似已有页为 strong，未链为 linked=false', () => {
  const { store, dir } = freshVault()
  try {
    store.writePage(page('order-status', '订单状态', 'entities', '订单生命周期内的状态集合。'))
    // 1) 完全同名（title 命中且归一相等）→ strong=true、linked=false
    const hit1 = relatedHits(store, new Set(), {
      id: 'order-status-v2', title: '订单状态', category: 'entities', body: '重复沉淀的新页。',
    })
    assert.ok(hit1.length >= 1)
    const strong = hit1.find((h) => h.id === 'order-status')
    assert.ok(strong, '应命中已有同名页')
    assert.equal(strong.strong, true, '同名应标 strong')
    assert.equal(strong.linked, false, '未链应标 linked=false')
    // 2) 标题含已有页子串（title 命中）且正文已含 [[order-status]] → linked=true、strong=false
    const hit2 = relatedHits(store, new Set(), {
      id: 'order-flow', title: '订单状态流转', category: 'concepts', body: '见 [[order-status]]。',
    })
    const linkedHit = hit2.find((h) => h.id === 'order-status')
    assert.ok(linkedHit, '标题子串应命中')
    assert.equal(linkedHit.linked, true, '含 [[order-status]] 应 linked=true')
    assert.equal(linkedHit.strong, false, '标题不同不应 strong')
    // 3) exclude 掉 id 后不再命中
    const hit3 = relatedHits(store, new Set(['order-status']), {
      id: 'x', title: '订单状态', category: 'entities', body: 'b',
    })
    assert.equal(hit3.some((h) => h.id === 'order-status'), false, 'exclude 生效')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('relatedHits 自身页/空标题不报错且返回空', () => {
  const { store, dir } = freshVault()
  try {
    store.writePage(page('self', '自身概念', 'concepts', '正文'))
    const selfHit = relatedHits(store, new Set(), { id: 'self', title: '自身概念', category: 'concepts', body: '正文' })
    assert.equal(selfHit.some((h) => h.id === 'self'), false, '排除自身')
    assert.deepEqual(relatedHits(store, new Set(), { id: 'a', title: '  ', category: 'concepts', body: '' }), [], '空标题返回空')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
