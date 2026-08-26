// graph-engine.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from './lib/vault-store.js'
import { buildGraph, exportGraphHtml } from './lib/graph-engine.js'

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
  store.writePage({ id: 'auth', title: 'Auth 认证', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: NOW, updated: NOW, body: 'JWT 与 session。参考 [[rate-limiting]]、[[ghost-page]] 与 [[pricing]]。' })
  store.writePage({ id: 'rate-limiting', title: 'Rate Limiting', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: NOW, updated: NOW, body: '429 处理。参考 [[auth|认证]] 与 [[ghost-page#状态]]。' })
  store.writePage({ id: 'orders', title: '订单', category: 'projects', tags: [], source: 's', confidence: 'inferred', created: NOW, updated: NOW, body: '订单流程。' })
  store.writePage({ id: 'pricing', title: '定价', category: 'references', tags: [], source: 's', confidence: 'inferred', created: NOW, updated: NOW, body: '定价策略。' })
  const g = buildGraph(store)
  assert.equal(g.pageCount, 4)
  assert.equal(g.nodes.length, 4)
  // auth → rate-limiting（正常边）
  assert.ok(g.edges.some((e) => e.source === 'auth' && e.target === 'rate-limiting' && e.broken === false), 'auth→rate-limiting 应存在')
  // auth → ghost-page（断链）
  assert.ok(g.edges.some((e) => e.source === 'auth' && e.target === 'ghost-page' && e.broken === true), 'auth→ghost-page 应标记 broken')
  // rate-limiting → auth（别名/锚点语法剥离后仍识别）
  assert.ok(g.edges.some((e) => e.source === 'rate-limiting' && e.target === 'auth'), '别名/锚点语法应剥离')
  // orders 无出链也无入链 → 孤儿（严格语义：无出链且无入链；rate-limiting 被 auth 引用 → 非孤儿）
  assert.deepEqual(g.orphanIds, ['orders'])
  // pricing 仅有入链（auth → pricing）、无出链：严格语义下不是孤儿（有入链），
  // 宽松语义（无出链即孤儿）下会是孤儿 → 此断言区分两种语义
  assert.ok(!g.orphanIds.includes('pricing'), '仅有入链的页不是孤儿（严格语义）')
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

test('exportGraphHtml 产出可打开的 HTML 且转义用户内容', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.writePage({ id: 'x', title: '<script>alert(1)</script>', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: NOW, updated: NOW, body: '参考 [[y]]' })
  store.writePage({ id: 'y', title: '正常页', category: 'entities', tags: [], source: 's', confidence: 'extracted', created: NOW, updated: NOW, body: 'ok' })
  const g = buildGraph(store)
  const html = exportGraphHtml(g)
  // 基本结构
  assert.ok(html.includes('<svg'), '应含 SVG 画布')
  assert.ok(html.includes('</html>'), '完整 HTML')
  // 转义：用户 title 中的 <script> 不能原样出现（核心不变式）
  assert.ok(!html.includes('<script>alert(1)</script>'), '原始 <script> 用户内容必须被转义')
  // 实测 Node 的 JSON.stringify 不转义 < >（{"title":"<script>…"} 原样输出），
  // 实现里对序列化结果做了 < > & → \uXXXX 后处理（jsonForEmbed，防止 </script> 提前闭合内联脚本块）。
  // 因此内嵌数据应为 \u003cscript 形式（浏览器解析 \u003c 等价于 <，值不丢失），而非 &lt; 实体。
  assert.ok(html.includes('\\u003cscript'), '内嵌 JSON 应为 \\u003c 转义形式（防 </script> 注入）')
  // 页面可打开：内联脚本应可被 JS 引擎解析（语法级验证，不执行）
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/)
  assert.ok(scriptMatch, '应包含内联脚本')
  assert.doesNotThrow(() => new Function(scriptMatch[1]), '内联脚本应可解析（页面可打开）')
  // 节点数据内嵌（JSON 序列化）
  assert.ok(html.includes('"x"'), '节点 id 应出现在数据中')
})

test('exportGraphHtml 空图也产出有效 HTML', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const g = buildGraph(store)
  const html = exportGraphHtml(g)
  assert.ok(html.includes('<svg'))
  assert.ok(html.includes('</html>'))
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/)
  assert.ok(scriptMatch, '空图也应包含内联脚本')
  assert.doesNotThrow(() => new Function(scriptMatch[1]), '空图内联脚本应可解析')
})

test('exportGraphHtml 大 vault（>500 节点）附加图谱较大降级提示', () => {
  // 合成 GraphData：501 个节点，直接调用 exportGraphHtml（无需 VaultStore）
  const nodes = Array.from({ length: 501 }, (_, i) => ({ id: 'n' + i, title: 'N' + i, category: 'concepts', confidence: 'extracted' }))
  const g = { nodes, edges: [], orphanIds: [], pageCount: 501 }
  const html = exportGraphHtml(g)
  assert.ok(html.includes('图谱较大'), '>500 节点应提示图谱较大')
  assert.ok(html.includes('501 节点'), '节点计数应正确显示')
  // 反例：小图谱不应出现降级提示
  const small = exportGraphHtml({ nodes: [{ id: 'a', title: 'A', category: 'concepts', confidence: 'extracted' }], edges: [], orphanIds: [], pageCount: 1 })
  assert.ok(!small.includes('图谱较大'), '小图谱不应提示性能受限')
})
