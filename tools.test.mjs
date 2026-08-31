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
  assert.deepEqual(names.sort(), ['wiki_capture', 'wiki_export', 'wiki_ingest', 'wiki_lint', 'wiki_mine', 'wiki_query'])
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

// ---- wiki_mine 工具（枚举字典挖掘候选 + 对账报告） ----
import { mkdirSync, cpSync } from 'node:fs'

/** 构造「项目根 + .wiki」：把 fixture 的 java 文件拷进项目根，store 指向其 .wiki。 */
function makeMineVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-mine-'))
  // fixture 目录本身即项目根（含 OrderEnum/PaymentConstants/SimpleFlag 的 java）
  cpSync(join(fileURLToPath(new URL('.', import.meta.url)), 'test-fixtures', 'mining'), join(dir, 'src'), { recursive: true })
  const store = new VaultStore(dir)
  store.ensure()
  return { dir, store }
}

test('wiki_mine 注册并对账：全量 new（首次挖掘）', async (t) => {
  const { dir, store } = makeMineVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, { current: () => store })
  const def = registered.find((d) => d.name === 'wiki_mine')
  assert.ok(def, 'wiki_mine 应已注册')
  const res = await def.execute({ kind: 'enum', module: 'order' }, EXEC)
  assert.equal(res.enums.length, 1, 'order 模块应挖到 OrderStatus')
  assert.equal(res.new.length, 1, '首次挖掘全部 new')
  assert.equal(res.unchanged.length, 0)
  assert.equal(res.changed.length, 0)
})

test('wiki_mine 对账：同哈希→unchanged，改哈希→changed', async (t) => {
  const { dir, store } = makeMineVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, { current: () => store })
  const def = registered.find((d) => d.name === 'wiki_mine')
  const first = await def.execute({ kind: 'enum' }, EXEC)
  assert.ok(first.enums.length >= 3, '应挖到多个枚举/常量类')
  // 模拟入库：把 manifest 记录为同哈希
  for (const e of first.enums) {
    store.updateManifest(`mine:enum:${e.file}`, {
      content_hash: e.hash, last_ingested: new Date().toISOString(), pages_produced: [e.name.toLowerCase()],
    })
  }
  const again = await def.execute({ kind: 'enum' }, EXEC)
  assert.equal(again.new.length, 0, '同哈希不应再 new')
  assert.equal(again.unchanged.length, first.enums.length, '同哈希应为 unchanged')
  assert.equal(again.changed.length, 0)
  // 改哈希：把 manifest 记录改成错哈希
  for (const e of first.enums) {
    store.updateManifest(`mine:enum:${e.file}`, {
      content_hash: 'stale-hash', last_ingested: new Date().toISOString(), pages_produced: [e.name.toLowerCase()],
    })
  }
  const third = await def.execute({ kind: 'enum' }, EXEC)
  assert.equal(third.changed.length, first.enums.length, '哈希不一致应为 changed')
})

test('wiki_mine 对账：manifest 有记录但文件消失 → deleted', async (t) => {
  const { dir, store } = makeMineVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, { current: () => store })
  const def = registered.find((d) => d.name === 'wiki_mine')
  store.updateManifest('mine:enum:ghost/Removed.java', {
    content_hash: 'abc', last_ingested: new Date().toISOString(), pages_produced: ['removed'],
  })
  const res = await def.execute({ kind: 'enum' }, EXEC)
  assert.ok(res.deleted.some((d) => d.includes('ghost/Removed.java')), '应检测到已消失源文件')
})

test('wiki_mine 空结果不报错', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  mountTools(fakeCtx, { current: () => store })
  const def = registered.find((d) => d.name === 'wiki_mine')
  // makeVault 的临时目录无代码可扫
  const res = await def.execute({ kind: 'enum' }, EXEC)
  assert.deepEqual(res.enums, [])
  assert.deepEqual(res.new, [])
  assert.ok(res.note, '空结果应带 note')
})

test('wiki-mine skill 文件存在且 package.json 白名单包含', () => {
  const ROOT = fileURLToPath(new URL('.', import.meta.url))
  const skill = readFileSync(join(ROOT, 'wiki-mine/SKILL.md'), 'utf8')
  assert.match(skill, /wiki_mine/, 'SKILL.md 应指导调用 wiki_mine 工具')
  assert.match(skill, /wiki_ingest/, 'SKILL.md 应指导经 wiki_ingest 入库')
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.ok(pkg.files.includes('wiki-mine'), 'package.json files 应含 wiki-mine')
})

// ---- M2: wiki_mine kind=db 表对账 ----
function makeDbMineVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-minedb-'))
  cpSync(join(fileURLToPath(new URL('.', import.meta.url)), 'test-fixtures', 'mining-db'), join(dir, 'src'), { recursive: true })
  const store = new VaultStore(dir)
  store.ensure()
  return { dir, store }
}

test('wiki_mine kind=db 对账：全量 new（首次挖掘）', async (t) => {
  const { dir, store } = makeDbMineVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  mountTools({ tools: { register: (def) => registered.push(def) } }, { current: () => store })
  const def = registered.find((d) => d.name === 'wiki_mine')
  const res = await def.execute({ kind: 'db' }, EXEC)
  assert.ok(res.tables.length >= 2, '应挖到多张表（t_order + t_order_item）')
  assert.equal(res.dbNew.length, res.tables.length, '首次全 dbNew')
  assert.equal(res.dbUnchanged.length, 0)
  assert.equal(res.dbChanged.length, 0)
  assert.equal(res.dbDeleted.length, 0)
})

test('wiki_mine kind=db 对账：同哈希→unchanged，改哈希→changed', async (t) => {
  const { dir, store } = makeDbMineVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  mountTools({ tools: { register: (def) => registered.push(def) } }, { current: () => store })
  const def = registered.find((d) => d.name === 'wiki_mine')
  const first = await def.execute({ kind: 'db' }, EXEC)
  for (const tb of first.tables) {
    store.updateManifest(`mine:db:${tb.file}`, {
      content_hash: tb.hash, last_ingested: new Date().toISOString(), pages_produced: [tb.table.toLowerCase()],
    })
  }
  const again = await def.execute({ kind: 'db' }, EXEC)
  assert.equal(again.dbNew.length, 0, '同哈希不应再 dbNew')
  assert.equal(again.dbUnchanged.length, first.tables.length, '同哈希应为 dbUnchanged')
  // 改哈希
  for (const tb of first.tables) {
    store.updateManifest(`mine:db:${tb.file}`, {
      content_hash: 'stale-db', last_ingested: new Date().toISOString(), pages_produced: [tb.table.toLowerCase()],
    })
  }
  const third = await def.execute({ kind: 'db' }, EXEC)
  assert.equal(third.dbChanged.length, first.tables.length, '哈希不一致应为 dbChanged')
})
