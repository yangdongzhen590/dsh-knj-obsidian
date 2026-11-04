// tools.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VaultStore } from './lib/vault-store.js'
import { mountTools } from './lib/tools.js'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

// 工具 body 不引用 exec；提供最小 stub 即可（ToolRunContext 契约由 registry 在真实环境注入）
const EXEC = { deferContext() {}, concludeTurn() {} }

// wiki_ingest 现在会安排一次语义索引的后台刷新（真实库冷启动约 1.5 分钟）。
// 测试里关掉自动刷新：既避免真后台定时器，也不去碰用户真实的 ~/.dsh/qmd。
process.env.KNJ_OBSIDIAN_AUTO_REFRESH = 'off'

// 未命中日志（<DSH_HOME>/knj-obsidian/query-misses.jsonl）隔离到临时 home：
// 否则本文件里 wiki_query 的零候选用例会写进用户真实状态，污染"库缺什么"的数据集。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-obsidian-tools-home-'))

// 成功路径返回值里有两类与本测试关注点无关的字段：
//   - checkpointId：动态时间戳 → 单独校验形态；
//   - tagAudit：全库标签现状（写页后主动回报），与本源增量语义正交 → 单独校验存在性。
// 其余「稳定字段」仍然严格比对，不用 partialDeepStrictEqual 放宽。
const CHECKPOINT_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/
function stableOf(res) {
  const { checkpointId, tagAudit, ...stable } = res
  assert.equal(typeof checkpointId, 'string', 'checkpointId 应为写前快照 id')
  assert.match(checkpointId, CHECKPOINT_ID_RE)
  assert.equal(typeof tagAudit, 'object', 'tagAudit 应随写页一同回报')
  return stable
}

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
  assert.deepEqual(names.sort(), ['wiki_capture', 'wiki_checkpoint', 'wiki_checkpoints', 'wiki_drill', 'wiki_export', 'wiki_ingest', 'wiki_init', 'wiki_lint', 'wiki_mine', 'wiki_normalize_tags', 'wiki_query', 'wiki_read', 'wiki_search_semantic'])
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
  assert.deepEqual(stableOf(res), { created: ['rate-limiting', 'billing'], updated: [], skipped: false, relatedCheck: [] })

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
  assert.deepEqual(stableOf(res), { created: [], updated: ['rate-limiting'], skipped: false, relatedCheck: [] })

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
  assert.deepEqual(stableOf(res), { created: ['concept-x-2'], updated: [], skipped: false, relatedCheck: [{ id: 'concept-x-2', title: 'X', category: 'concepts', related: [{ id: 'concept-x', title: 'X', category: 'concepts', matchedBy: 'title', linked: false, strong: true }] }] })
  const original = store.readPage('concept-x', 'concepts')
  assert.equal(original.body, 'A 源的内容', '不同来源不得静默覆盖旧源页面')
  assert.equal(original.source, 'agent:claude')
  const renamed = store.readPage('concept-x-2', 'concepts')
  assert.ok(renamed)
  assert.equal(renamed.body, 'B 源的内容')
  assert.equal(renamed.source, 'agent:codex')

  // 同源重导仍是覆盖更新语义（created 保留）
  const again = await def.execute({ source: 'agent:claude', pages: [{ id: 'concept-x', title: 'X', category: 'concepts', body: 'A 源的内容 v2' }] }, EXEC)
  assert.deepEqual(stableOf(again), { created: [], updated: ['concept-x'], skipped: false, relatedCheck: [] })
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
  assert.deepEqual(stableOf(res), { created: [], updated: ['concept-x-2'], skipped: false, relatedCheck: [] })
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

test('wiki_search_semantic：无本地模型时如实返回未就绪（不联网、不假装命中、指向本地目录）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const home = mkdtempSync(join(tmpdir(), 'dsh-semantic-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))

  // 把 homedir() 指向空目录 → 模型必然缺失，分支确定
  const savedProfile = process.env.USERPROFILE
  const savedHome = process.env.HOME
  process.env.USERPROFILE = home
  process.env.HOME = home
  t.after(() => {
    if (savedProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedProfile
    if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome
  })

  const registered = []
  mountTools({ tools: { register: (d) => registered.push(d) } }, { current: () => store, currentRecord: () => ({ root: dir }) })
  const def = registered.find((d) => d.name === 'wiki_search_semantic')
  assert.ok(def, 'wiki_search_semantic 应已注册')

  const res = await def.execute({ query: '限流算法' }, EXEC)
  assert.equal(res.status, 'model-missing', '模型缺失必须如实回报，不得静默降级成“无命中”')
  assert.equal(res.count, 0)
  assert.deepEqual(res.results, [])
  assert.match(res.message, /\.dsh[\\/]qmd[\\/]models/, '应给出精确的本地模型目录')
  assert.match(res.message, /embeddinggemma-300M-Q8_0\.gguf/)
  assert.match(res.message, /不会自动下载/, '必须声明不会自动联网下载')
  assert.ok(existsSync(join(home, '.dsh', 'qmd', 'models')), '应在本地创建模型目录，而不是联网获取')
  assert.deepEqual(validateJsonSchemaValue(def.output.schema, res), [])
})

test('wiki_ingest 落盘后安排语义索引刷新（source 契约：schedule 调用存在且带来源标记）', () => {
  const ROOT = fileURLToPath(new URL('.', import.meta.url))
  const src = readFileSync(join(ROOT, 'src/tools.ts'), 'utf8')
  assert.match(src, /refresherFor\(root\)\.schedule\('wiki_ingest'\)/, '入库后应安排 debounce 刷新')
})

test('wiki_capture 落盘后同样安排语义索引刷新（原先漏了：capture 是当前主力写路径）', () => {
  const ROOT = fileURLToPath(new URL('.', import.meta.url))
  const src = readFileSync(join(ROOT, 'src/tools.ts'), 'utf8')
  assert.match(src, /refresherFor\(root\)\.schedule\('wiki_capture'\)/,
    'capture 直接 writePage，不补这一行就只有词面层能看到它（语义层搜不到）')
})

test('打包契约：@tobilu/qmd 是可选依赖（内网仓库缺它时插件仍能装上并降级）', () => {
  const ROOT = fileURLToPath(new URL('.', import.meta.url))
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  // 2026-09-20 迁移：optionalDependencies → optional peerDependency。
  // 依据：已发布 v2026.9.152 产物的 package.json 即为该形态（peerDependencies + peerDependenciesMeta.optional），
  // README 亦如此记载。取舍是「不自动安装」——DSH profile 默认 autoInstallPeers=false，
  // 而 optionalDependencies 会被 pnpm 真的装（连带 node-llama-cpp 的 14 个平台包，内网拉不到）。
  assert.equal(pkg.peerDependencies?.['@tobilu/qmd'], '^2.8.3', '语义检索库必须声明为 peerDependency')
  assert.equal(pkg.peerDependenciesMeta?.['@tobilu/qmd']?.optional, true, '必须标 optional：缺库时插件仍能装上')
  assert.equal(pkg.dependencies?.['@tobilu/qmd'], undefined, '不得同时声明为硬依赖（内网缺库会导致整个插件装不上）')
  assert.equal(pkg.optionalDependencies?.['@tobilu/qmd'], undefined, '不得回退到 optionalDependencies（那会被自动安装，回到内网拉爆的老问题）')
  for (const hard of ['dompurify', 'marked']) {
    assert.ok(pkg.dependencies?.[hard], `${hard} 应为硬依赖`)
  }
  // 有它才装、没有就如实降级：库缺失分支必须仍然存在
  const src = readFileSync(join(ROOT, 'src/semantic-index.ts'), 'utf8')
  assert.match(src, /library-missing/, '库缺失时须保留可诊断的降级分支')
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

// ---------------------------------------------------------------------------
// 2026-09-20：wiki_query 接上语义兜底。
// 背景：语义融合管道早已建成（semantic-index.ts 的运行时 + semantic.ts 的 retrieveWithSemantic），
// 但 retrieveWithSemantic 全源码 0 调用方；wiki_query 只调纯词面 retrieve()，语义层要由 agent
// 手动另调 wiki_search_semantic 并自行合并——实测 2.5 周 415 个会话里它只被调用过 1 次。
// 本组用例锁住三件事：兜底接线、阈值（词面够多就不调）、不可用时的静默降级。
// ---------------------------------------------------------------------------

/** 假语义运行时：让接线行为可断言，且不触碰真实 ~/.dsh/qmd 与 300M 模型。 */
function fakeSemanticRuntime(overrides = {}) {
  return {
    status: 'ready',
    modelPath: 'fake-model.gguf',
    modelPresent: true,
    index: { documents: 3, pendingEmbedding: 0, hasVectorIndex: true },
    store: {
      searchVector: async () => [{ displayPath: 'concepts/rate-limiting.md' }],
      searchLex: async () => [],
      getStatus: () => ({ totalDocuments: 3, needsEmbedding: 0, hasVectorIndex: true }),
      update: async () => ({}),
      embed: async () => ({}),
      close: () => {},
    },
    ...overrides,
  }
}

function mountWithSemantic(store, dir, factory) {
  const registered = []
  mountTools(
    { tools: { register: (def) => registered.push(def) } },
    { current: () => store, currentRecord: () => ({ root: dir }) },
    { semanticRuntimeFactory: factory },
  )
  return registered.find((d) => d.name === 'wiki_query')
}

test('wiki_query：词面候选 < 2 时自动带语义兜底（接线断言，注入假 runtime）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.writePage({ id: 'rate-limiting', title: 'Rate Limiting 踩坑', category: 'concepts', tags: [], source: 'agent:session-x', confidence: 'extracted', created: 'c', updated: 'u', body: '429 要指数退避。' })

  const calls = []
  const def = mountWithSemantic(store, dir, async (vaultRoot) => { calls.push(vaultRoot); return fakeSemanticRuntime() })

  const res = await def.execute({ query: '词组式查询 但词面不存在' }, EXEC)
  assert.equal(calls.length, 1, '词面几乎无果时必须调用一次语义运行时')
  assert.equal(calls[0], dir, '运行时按当前库构造')
  const hit = res.candidates.find((c) => c.id === 'rate-limiting')
  assert.ok(hit, '语义命中必须出现在候选里')
  assert.equal(hit.matchedBy, 'semantic')
  assert.match(res.strategy, /semantic/)
  assert.deepEqual(validateJsonSchemaValue(def.output.schema, res), [])
})

test('wiki_query：词面候选足够时不得调用语义层（省算力），且候选透传 source', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.writePage({ id: 'rate-limiting', title: 'Rate Limiting 踩坑', category: 'concepts', tags: ['rate-limiting', 'api'], source: 'agent:session-x', confidence: 'extracted', created: 'c', updated: 'u', body: '429 要指数退避。' })
  store.writePage({ id: 'stale-closure', title: 'React Stale Closure', category: 'concepts', tags: ['rate-limiting'], source: 'agent:session-y', confidence: 'extracted', created: 'c', updated: 'u', body: '闭包捕获旧值。' })

  let called = 0
  const def = mountWithSemantic(store, dir, async () => { called += 1; return fakeSemanticRuntime() })

  const res = await def.execute({ query: 'rate-limiting' }, EXEC)
  assert.ok(res.candidates.length >= 2, '前置层/标签层应给出 >= 2 条候选')
  assert.equal(called, 0, '词面候选足够时不得触碰语义运行时')
  assert.ok(!res.strategy.includes('semantic'))
  for (const c of res.candidates) {
    assert.equal(typeof c.source, 'string')
    assert.ok(c.source.length > 0, '每条候选都必须带 source')
  }
  assert.deepEqual(validateJsonSchemaValue(def.output.schema, res), [])
})

test('wiki_query：语义运行时不可用/抛错时静默降级为纯词面（不抛错、不假装命中）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.writePage({ id: 'rate-limiting', title: 'Rate Limiting 踩坑', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: '429 要指数退避。' })

  const notReady = mountWithSemantic(store, dir, async () => fakeSemanticRuntime({ status: 'index-empty', modelPresent: false, store: null }))
  const res1 = await notReady.execute({ query: '词面不存在 的查询' }, EXEC)
  assert.deepEqual(res1.candidates, [], '模型缺失时不得凭空造候选')
  assert.ok(!res1.strategy.includes('semantic'))

  const throwing = mountWithSemantic(store, dir, async () => { throw new Error('qmd 加载失败') })
  const res2 = await throwing.execute({ query: '词面不存在 的查询' }, EXEC)
  assert.deepEqual(res2.candidates, [], '语义层抛错必须被吞掉，不得让 wiki_query 报错')
  assert.ok(!res2.strategy.includes('semantic'))
})

// 这条守住一个实测踩到的坑：语义兜底一旦在单测里生效，就会加载真实 300M 模型
// （wiki-query-tool.test.mjs 里那条「全新 vault 零写入」由 <1s 变成 26.8s，并把测试报告流冲坏、
// 导致同文件两条用例不被计入）。开关必须能在不改代码的前提下关掉兜底。
test('语义兜底开关 KNJ_OBSIDIAN_SEMANTIC_FALLBACK=off 时不得触碰语义运行时', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.writePage({ id: 'rate-limiting', title: 'Rate Limiting 踩坑', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: '429 要指数退避。' })

  const saved = process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK
  process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK = 'off'
  t.after(() => {
    if (saved === undefined) delete process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK
    else process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK = saved
  })

  let called = 0
  const def = mountWithSemantic(store, dir, async () => { called += 1; return fakeSemanticRuntime() })
  const res = await def.execute({ query: '词面不存在 的查询' }, EXEC)
  assert.equal(called, 0, '开关为 off 时必须完全跳过语义运行时（不得加载模型）')
  assert.deepEqual(res.candidates, [])
  assert.ok(!res.strategy.includes('semantic'))
})

// ---------------------------------------------------------------------------
// 2026-10-17：**不要再放宽兜底门**（这条守住一次被实测否掉的「改进」）。
//
// 曾经试过再加一道门：「Top1 低于标签层基础分（4）时也启用语义兜底」，理由是「有结果 ≠ 结果对」。
// 在 10 条改写式查询上实测（全部走真实工具层）：
//   纯词面          Top1 命中 6/10，平均 5ms
//   词面+语义兜底    Top1 命中 4/10，平均 1791ms   ← 2 个退步、0 个改进
// 机制是结构性的：MATCH_SCORE.semantic(3) 无条件高于 body(1)/summary(2)/graph(0.5)，
// 而「Top1 < 4」恰好等价于「Top1 来自 body/summary/graph」——新门一开，语义候选必然压过
// 那个正确的弱 Top1。更糟的是 retrieve() 丢掉了语义通道自身的排序（扁平 base=3），
// 度加权与 tier 权重会把语义通道里排最后的 hub 页顶成 Top1（实测：语义通道排第 5 的页成了融合后 Top1）。
// 所以兜底只在「词面几乎无果」时发生，这条用例把该行为钉住。
// ---------------------------------------------------------------------------

test('wiki_query：候选 ≥ 2 时不得启用语义兜底 —— 即使 Top1 是弱命中（实测放宽会掉精度）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  // 两页都只在**正文**里含这些词（标题/标签都不含）⇒ 命中落在 body 层，分数 < 4，即「弱 Top1」
  const body = 'alpha beta gamma 只是正文里的占位词，标题与标签都没有它。'
  store.writePage({ id: 'prose-a', title: '页面甲', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body })
  store.writePage({ id: 'prose-b', title: '页面乙', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body })

  let called = 0
  const def = mountWithSemantic(store, dir, async () => { called += 1; return fakeSemanticRuntime() })

  const res = await def.execute({ query: 'alpha beta gamma delta epsilon' }, EXEC)

  assert.ok(res.candidates.length >= 2, `前置：词面候选必须 ≥ 2。实际 ${res.candidates.length}`)
  assert.ok(res.candidates[0].score < 4, `前置：Top1 必须是弱命中（< 4）。实际 ${res.candidates[0].score}`)
  assert.equal(called, 0, '候选够多就不该碰语义层——哪怕 Top1 分低（放宽这道门实测会让 Top1 精度 6/10 → 4/10）')
  assert.ok(!res.strategy.includes('semantic'))
})

test('wiki_search_semantic：复用按库缓存的运行时，不每次重建（旧实现每次重载 300M 模型 ≈ 7–10 秒）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.writePage({ id: 'rate-limiting', title: '限流页', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: '429 要指数退避。' })

  let created = 0
  let closed = 0
  const registered = []
  mountTools(
    { tools: { register: (def) => registered.push(def) } },
    { current: () => store, currentRecord: () => ({ root: dir }) },
    {
      semanticRuntimeFactory: async () => {
        created += 1
        const rt = fakeSemanticRuntime()
        return { ...rt, store: { ...rt.store, close: () => { closed += 1 } } }
      },
    },
  )
  const def = registered.find((d) => d.name === 'wiki_search_semantic')

  const r1 = await def.execute({ query: '第一次', limit: 5 }, EXEC)
  const r2 = await def.execute({ query: '第二次', limit: 5 }, EXEC)
  assert.equal(r1.status, 'ready')
  assert.equal(r2.status, 'ready')
  assert.ok(r1.count >= 1 && r2.count >= 1, '两次调用都要给出结果')
  assert.equal(created, 1, '第二次调用必须复用缓存运行时——自建就等于重载 300M 嵌入模型（实测 7–10 秒/次）')
  assert.equal(closed, 0, '缓存运行时不得被关掉：wiki_drill 与触发层共用同一个实例')

  // 开关关的是「兜底」，不是用户显式要求的语义检索（与 wiki_drill 的开关口径一致）
  const saved = process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK
  process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK = 'off'
  t.after(() => {
    if (saved === undefined) delete process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK
    else process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK = saved
  })
  const r3 = await def.execute({ query: '第三次', limit: 5 }, EXEC)
  assert.equal(r3.status, 'ready', 'KNJ_OBSIDIAN_SEMANTIC_FALLBACK=off 只关兜底，不得关掉显式语义检索')
  assert.equal(created, 1, '关掉兜底后仍复用缓存')
})

// ---------------------------------------------------------------------------
// 2026-09-20：检索未命中日志的**接线**验证。
// 上面 miss-log.test.mjs 只测了 recordQueryMiss 本身；本组测的是 wiki_query 真的会调它，
// 且不会因此往 vault 里写东西（"检索只读"是公开契约）。
// ---------------------------------------------------------------------------

test('wiki_query 零候选时记一条未命中（诊断埋点）；有候选不记；且不写进 vault', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const home = mkdtempSync(join(tmpdir(), 'dsh-misslog-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const savedHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (savedHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = savedHome
  })

  store.writePage({ id: 'rate-limiting', title: 'Rate Limiting 踩坑', category: 'concepts', tags: ['api'], source: 's', confidence: 'extracted', created: 'c', updated: 'u', body: '429 要指数退避。' })
  // 注入不可用的语义运行时：避免单测里加载真实 300M 模型（它现在是语义兜底路径的默认工厂）
  const def = mountWithSemantic(store, dir, async () => fakeSemanticRuntime({ status: 'index-empty', modelPresent: false, store: null }))

  const vaultBefore = JSON.stringify([...store.listPagesReadonly()].map((p) => p.id))
  const missRes = await def.execute({ query: '完全无关的查询 zzzqqq' }, EXEC)
  assert.deepEqual(missRes.candidates, [])

  const logFile = join(home, 'knj-obsidian', 'query-misses.jsonl')
  assert.ok(existsSync(logFile), '零候选必须留下一条未命中记录（否则无法回答"库缺什么"）')
  const entries = readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].query, '完全无关的查询 zzzqqq')
  assert.equal(entries[0].workspace, basename(dir), '按工作区区分，才能对比"哪个工作区缺货"')
  assert.equal(entries[0].mode, 'auto')
  assert.equal(entries[0].semanticTried, true, '记录了"试过语义兜底还是没有"')

  // 有候选 → 不记
  const hitRes = await def.execute({ query: 'rate-limiting' }, EXEC)
  assert.ok(hitRes.candidates.length > 0)
  assert.equal(readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length, 1, '有候选不得记')

  // 不写进 vault（检索只读契约）
  assert.equal(JSON.stringify([...store.listPagesReadonly()].map((p) => p.id)), vaultBefore)
  assert.deepEqual(validateJsonSchemaValue(def.output.schema, hitRes), [])
})

test('wiki_query：KNJ_OBSIDIAN_MISS_LOG=off 时不记未命中', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const home = mkdtempSync(join(tmpdir(), 'dsh-misslog-off-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const saved = { home: process.env.DSH_HOME, off: process.env.KNJ_OBSIDIAN_MISS_LOG }
  process.env.DSH_HOME = home
  process.env.KNJ_OBSIDIAN_MISS_LOG = 'off'
  t.after(() => {
    if (saved.home === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = saved.home
    if (saved.off === undefined) delete process.env.KNJ_OBSIDIAN_MISS_LOG; else process.env.KNJ_OBSIDIAN_MISS_LOG = saved.off
  })

  const def = mountWithSemantic(store, dir, async () => fakeSemanticRuntime({ status: 'index-empty', modelPresent: false, store: null }))
  await def.execute({ query: '完全无关的查询 zzzqqq' }, EXEC)
  assert.equal(existsSync(join(home, 'knj-obsidian', 'query-misses.jsonl')), false, '开关关闭时不得写日志')
})
