// tools.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VaultStore } from './lib/vault-store.js'
import { mountTools } from './lib/tools.js'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

// 工具 body 不引用 exec；提供最小 stub 即可（ToolRunContext 契约由 registry 在真实环境注入）
const EXEC = { deferContext() {}, concludeTurn() {} }

function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-tools-'))
  const store = new VaultStore(dir)
  store.ensure()
  return { dir, store }
}

test('store 实例 + ensure 后 .wiki 可写（工具执行的存储基座）', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-tools-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new VaultStore(dir)
  store.ensure()
  assert.ok(existsSync(join(dir, '.wiki', '.manifest.json')))
  assert.ok(existsSync(join(dir, '.wiki', 'index.md')))
})

test('mountTools 注册 wiki_ingest + wiki_capture + wiki_lint + wiki_query 并返回 dispose', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  const dispose = mountTools(fakeCtx, store)
  const names = registered.map((d) => d.name)
  assert.deepEqual(names.sort(), ['wiki_capture', 'wiki_export', 'wiki_ingest', 'wiki_lint', 'wiki_query'])
  assert.equal(typeof dispose, 'function')
})

test('wiki_ingest 落盘页面并更新 manifest（created/updated 分流）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, store)
  const def = registered.find((d) => d.name === 'wiki_ingest')

  const source = 'docs/input.md'
  const pages = [
    { id: 'rate-limiting', title: 'Rate Limiting', category: 'concepts', tags: ['api'], confidence: 'extracted', body: '## 核心\n429 要指数退避。' },
    // confidence 缺省 → extracted
    { id: 'billing', title: 'Billing', category: 'entities', body: '账单流程。' },
  ]
  const res = await def.execute({ source, pages }, EXEC)
  assert.deepEqual(res, { created: ['rate-limiting', 'billing'], updated: [], skipped: false })

  // 页面与 frontmatter 落盘
  const raw = readFileSync(join(dir, '.wiki', 'concepts', 'rate-limiting.md'), 'utf8')
  assert.match(raw, /^---\n/)
  assert.match(raw, /confidence: extracted/)
  assert.match(raw, /source: docs\/input\.md/)
  assert.ok(existsSync(join(dir, '.wiki', 'entities', 'billing.md')))

  // manifest 记录 source → 内容哈希 + 产出页面
  const entry = store.manifestEntry(source)
  assert.ok(entry)
  assert.equal(entry.content_hash, store.sha256(source + JSON.stringify(pages)))
  assert.deepEqual(entry.pages_produced, ['rate-limiting', 'billing'])
})

test('wiki_ingest 重写同 id 页面：保留 created、更新 updated', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, store)
  const def = registered.find((d) => d.name === 'wiki_ingest')

  const source = 'docs/input.md'
  const first = { id: 'rate-limiting', title: 'Rate Limiting', category: 'concepts', body: '## 核心\n429 要指数退避。' }
  await def.execute({ source, pages: [first] }, EXEC)
  const createdAt = store.readPage('rate-limiting', 'concepts').created

  const second = { ...first, body: '## 核心\n429 要指数退避，且要有 jitter。' }
  const res = await def.execute({ source, pages: [second] }, EXEC)
  assert.deepEqual(res, { created: [], updated: ['rate-limiting'], skipped: false })

  const back = store.readPage('rate-limiting', 'concepts')
  assert.equal(back.created, createdAt) // created 保留
  assert.notEqual(back.updated, createdAt)
  assert.match(back.body, /jitter/)
})

test('wiki_ingest 校验必填参数（缺 source 报错）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, store)
  const def = registered.find((d) => d.name === 'wiki_ingest')
  await assert.rejects(def.execute({ pages: [] }, EXEC))
})

test('wiki_ingest 跨源同 id 不覆盖：自动 -2 后缀新建，原页内容保持旧源', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, store)
  const def = registered.find((d) => d.name === 'wiki_ingest')

  // 源 A 先写入 concept-x
  await def.execute({ source: 'agent:claude', pages: [{ id: 'concept-x', title: 'X', category: 'concepts', body: 'A 源的内容' }] }, EXEC)
  // 源 B（不同 source）再写同 id
  const res = await def.execute({ source: 'agent:codex', pages: [{ id: 'concept-x', title: 'X', category: 'concepts', body: 'B 源的内容' }] }, EXEC)

  // 新页落为 concept-x-2，原页保持 A 源内容
  assert.deepEqual(res, { created: ['concept-x-2'], updated: [], skipped: false })
  const original = store.readPage('concept-x', 'concepts')
  assert.equal(original.body, 'A 源的内容', '不同来源不得静默覆盖旧源页面')
  assert.equal(original.source, 'agent:claude')
  const renamed = store.readPage('concept-x-2', 'concepts')
  assert.ok(renamed)
  assert.equal(renamed.body, 'B 源的内容')
  assert.equal(renamed.source, 'agent:codex')

  // 同源重导仍是覆盖更新语义（created 保留）
  const again = await def.execute({ source: 'agent:claude', pages: [{ id: 'concept-x', title: 'X', category: 'concepts', body: 'A 源的内容 v2' }] }, EXEC)
  assert.deepEqual(again, { created: [], updated: ['concept-x'], skipped: false })
  assert.equal(store.readPage('concept-x', 'concepts').body, 'A 源的内容 v2')
})

test('wiki_ingest 跨源避让后：新源重导更新自己的 -N 页（不得无限膨胀成 -3/-4）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, store)
  const def = registered.find((d) => d.name === 'wiki_ingest')

  await def.execute({ source: 'agent:claude', pages: [{ id: 'concept-x', title: 'X', category: 'concepts', body: 'A 源 v1' }] }, EXEC)
  await def.execute({ source: 'agent:codex', pages: [{ id: 'concept-x', title: 'X', category: 'concepts', body: 'B 源 v1' }] }, EXEC)
  assert.ok(store.readPage('concept-x-2', 'concepts'), 'B 源首次应避让到 concept-x-2')

  // B 源再次重导同 id 更新：必须更新 concept-x-2，而不是再避让出 concept-x-3
  const res = await def.execute({ source: 'agent:codex', pages: [{ id: 'concept-x', title: 'X', category: 'concepts', body: 'B 源 v2' }] }, EXEC)
  assert.deepEqual(res, { created: [], updated: ['concept-x-2'], skipped: false })
  assert.equal(store.readPage('concept-x-2', 'concepts').body, 'B 源 v2', '新源重导必须更新自己的 -N 页')
  assert.equal(store.readPage('concept-x', 'concepts').body, 'A 源 v1', '原源页面仍不受影响')
  assert.equal(store.readPage('concept-x-3', 'concepts'), null, '不得无限膨胀出 concept-x-3')
})

test('wiki_capture 沉淀单页（默认 references/，confidence=inferred，id 保留 CJK 字符）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, store)
  const def = registered.find((d) => d.name === 'wiki_capture')

  const r = await def.execute({ title: ' 关于 429 的总结 ', body: '知识内容：指数退避。' }, EXEC)
  assert.equal(r.page, 'references/关于-429-的总结.md')
  const raw = readFileSync(join(dir, '.wiki', 'references', '关于-429-的总结.md'), 'utf8')
  assert.match(raw, /confidence: inferred/)
  assert.match(raw, /source: agent:capture/)
  assert.match(raw, /指数退避/)
})

test('wiki_lint 注册并返回 LintReport，输出通过 schema 校验', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, store)
  const def = registered.find((d) => d.name === 'wiki_lint')
  assert.ok(def)

  store.writePage({ id: 'a', title: 'A', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: '参考 [[ghost-page]] 与 [[b]]' })
  store.writePage({ id: 'b', title: 'B', category: 'entities', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: 'ok' })

  const report = await def.execute({}, EXEC)
  assert.deepEqual(report.brokenLinks, [{ from: 'a', target: 'ghost-page' }])
  assert.deepEqual(report.orphans.sort(), ['a', 'b']) // 双向链接未织好前都算孤儿
  assert.deepEqual(report.missingFrontmatter, [])
  assert.equal(report.pageCount, 2)

  // 输出契约：全部属性声明且 additionalProperties:false，LintReport 结构可被 registry 校验
  const violations = validateJsonSchemaValue(def.output.schema, report)
  assert.deepEqual(violations, [])
})

test('wiki_ingest/wiki_capture 工具 category 枚举含 dictionaries/tables', () => {
  const ROOT = fileURLToPath(new URL('.', import.meta.url))
  const src = readFileSync(join(ROOT, 'src/tools.ts'), 'utf8')
  const enumRe = /enum: \['concepts', 'entities', 'references', 'synthesis', 'projects'(, 'dictionaries', 'tables')?\]/g
  const matches = [...src.matchAll(enumRe)]
  assert.equal(matches.length, 2, 'wiki_ingest 与 wiki_capture 两处 category enum 都应含新分类')
  for (const m of matches) {
    assert.ok(m[1], `enum 应含新分类：${m[0]}`)
  }
})
