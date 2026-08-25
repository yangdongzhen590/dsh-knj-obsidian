// wiki-query-tool.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from './lib/vault-store.js'
import { mountTools } from './lib/tools.js'

function makeCtx() {
  const registered = []
  return {
    tools: { register: (def) => { registered.push(def) } },
    registered,
  }
}

function findTool(ctx, name) {
  return ctx.registered.find((d) => d.name === name)
}

test('wiki_query 工具已注册且参数/输出 schema 完整', () => {
  const ctx = makeCtx()
  const store = new VaultStore(mkdtempSync(join(tmpdir(), 'dsh-obsidian-qt-')))
  mountTools(ctx, store)
  const tool = findTool(ctx, 'wiki_query')
  assert.ok(tool, 'wiki_query 应注册')
  // defineTool 把 per-property required 编译成顶层 required 数组（dsh-tools@0.1.0-rc.8）
  assert.ok(tool.parameters.required.includes('query'), 'query 必填')
  assert.equal(tool.parameters.properties.mode.enum.join(','), 'auto,index-only')
  assert.ok(tool.output.schema.required.includes('strategy'), 'strategy 必填')
  assert.equal(tool.output.schema.additionalProperties, false)
})

test('wiki_query 执行返回候选并零写入', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-qt2-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new VaultStore(dir)
  store.ensure()
  const now = '2026-08-25T00:00:00.000Z'
  store.writePage({ id: 'rate-limiting', title: 'Rate Limiting', category: 'concepts', tags: ['api'], source: 's', confidence: 'extracted', created: now, updated: now, body: '429 指数退避。' })
  const ctx = makeCtx()
  mountTools(ctx, store)
  const tool = findTool(ctx, 'wiki_query')
  const before = snapshot(dir)
  const result = await tool.execute({ query: '指数退避', mode: 'auto' }, { signal: new AbortController().signal })
  const after = snapshot(dir)
  assert.ok(result.candidates.length >= 1)
  assert.equal(result.candidates[0].id, 'rate-limiting')
  assert.ok(result.strategy.length > 0)
  assert.deepEqual(after, before, 'wiki_query 不得写入任何文件')
})

function snapshot(root) {
  const out = {}
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, f.name)
      if (f.isDirectory()) walk(full)
      else out[full.replace(root, '')] = readFileSync(full, 'utf8')
    }
  }
  walk(root)
  return out
}
