// graph-engine.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from './lib/vault-store.js'
import { buildGraph } from './lib/graph-engine.js'

function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-graph-'))
  const store = new VaultStore(dir)
  store.ensure()
  return { dir, store }
}

const NOW = '2026-08-26T00:00:00.000Z'

test('buildGraph 产出节点与边（含断链标记）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.writePage({ id: 'auth', title: 'Auth 认证', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: NOW, updated: NOW, body: 'JWT 与 session。参考 [[rate-limiting]] 与 [[ghost-page]]。' })
  store.writePage({ id: 'rate-limiting', title: 'Rate Limiting', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: NOW, updated: NOW, body: '429 处理。参考 [[auth|认证]] 与 [[ghost-page#状态]]。' })
  store.writePage({ id: 'orders', title: '订单', category: 'projects', tags: [], source: 's', confidence: 'inferred', created: NOW, updated: NOW, body: '订单流程。' })
  const g = buildGraph(store)
  assert.equal(g.pageCount, 3)
  assert.equal(g.nodes.length, 3)
  // auth → rate-limiting（正常边）
  assert.ok(g.edges.some((e) => e.source === 'auth' && e.target === 'rate-limiting' && e.broken === false), 'auth→rate-limiting 应存在')
  // auth → ghost-page（断链）
  assert.ok(g.edges.some((e) => e.source === 'auth' && e.target === 'ghost-page' && e.broken === true), 'auth→ghost-page 应标记 broken')
  // rate-limiting → auth（别名/锚点语法剥离后仍识别）
  assert.ok(g.edges.some((e) => e.source === 'rate-limiting' && e.target === 'auth'), '别名/锚点语法应剥离')
  // orders 无出链也无入链 → 孤儿（严格语义：无出链且无入链；rate-limiting 被 auth 引用 → 非孤儿）
  assert.deepEqual(g.orphanIds, ['orders'])
  // 节点元数据
  const authNode = g.nodes.find((n) => n.id === 'auth')
  assert.equal(authNode.title, 'Auth 认证')
  assert.equal(authNode.category, 'concepts')
  assert.equal(authNode.confidence, 'extracted')
})

test('空 vault 返回空图', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const g = buildGraph(store)
  assert.equal(g.nodes.length, 0)
  assert.equal(g.edges.length, 0)
  assert.equal(g.pageCount, 0)
})
