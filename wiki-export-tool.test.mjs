// wiki-export-tool.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from './lib/vault-store.js'
import { mountTools } from './lib/tools.js'

function makeCtx() {
  const registered = []
  return { tools: { register: (def) => { registered.push(def) } }, registered }
}

function findTool(ctx, name) {
  return ctx.registered.find((d) => d.name === name)
}

const NOW = '2026-08-26T00:00:00.000Z'

test('wiki_export 工具注册且 schema 完整', () => {
  const ctx = makeCtx()
  const store = new VaultStore(mkdtempSync(join(tmpdir(), 'dsh-obsidian-wx-')))
  mountTools(ctx, store)
  const tool = findTool(ctx, 'wiki_export')
  assert.ok(tool, 'wiki_export 应注册')
  // defineTool 会把 parameters 编译为 {type:'object', properties:{...}}，required 归一为对象级数组
  assert.equal(tool.parameters.properties.format.enum.join(','), 'html,json')
  assert.equal(tool.output.schema.additionalProperties, false)
  assert.equal(tool.output.schema.required.includes('file'), true)
})

test('wiki_export html 模式写入 wiki-export/graph.html', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-wx2-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new VaultStore(dir)
  store.ensure()
  store.writePage({ id: 'a', title: 'A', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: NOW, updated: NOW, body: '参考 [[b]]' })
  store.writePage({ id: 'b', title: 'B', category: 'entities', tags: [], source: 's', confidence: 'extracted', created: NOW, updated: NOW, body: 'ok' })
  const ctx = makeCtx()
  mountTools(ctx, store)
  const tool = findTool(ctx, 'wiki_export')
  const result = await tool.execute({ format: 'html' }, { signal: new AbortController().signal })
  assert.ok(result.file.endsWith('wiki-export/graph.html'), `file 应为 wiki-export/graph.html，实际 ${result.file}`)
  assert.equal(result.nodeCount, 2)
  assert.equal(result.edgeCount, 1)
  const html = readFileSync(join(dir, '.wiki', 'wiki-export', 'graph.html'), 'utf8')
  assert.ok(html.includes('<svg'))
})

test('wiki_export json 模式写入 graph.json', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-wx3-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new VaultStore(dir)
  store.ensure()
  store.writePage({ id: 'a', title: 'A', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: NOW, updated: NOW, body: 'ok' })
  const ctx = makeCtx()
  mountTools(ctx, store)
  const tool = findTool(ctx, 'wiki_export')
  const result = await tool.execute({ format: 'json' }, { signal: new AbortController().signal })
  assert.ok(result.file.endsWith('wiki-export/graph.json'))
  const json = JSON.parse(readFileSync(join(dir, '.wiki', 'wiki-export', 'graph.json'), 'utf8'))
  assert.equal(json.nodes.length, 1)
  assert.equal(json.edges.length, 0)
})
