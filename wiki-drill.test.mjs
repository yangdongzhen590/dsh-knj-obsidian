// wiki-drill.test.mjs
// wiki_drill / wiki_read 的行为契约（设计：docs/2026-09-27-wiki-drill-design.md）
//
// 纪律：本文件先于实现存在（red-green）。测试从 ./lib/*.js 导入 —— 改 src 后必须先构建。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from './lib/vault-store.js'
import { drillQuery, drillPage, drillEnabled, readPageDetail } from './lib/drill.js'
import { mountTools } from './lib/tools.js'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

// 未命中日志隔离到临时 home（否则工具层用例会把「查不到」写进用户真实状态目录，
// 污染 miss 日志那份「库缺什么」的数据集）——与 tools.test.mjs 同款做法。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-obsidian-drill-home-'))
// 关掉索引自动刷新：不启动真后台定时器，也不碰用户真实的 ~/.dsh/qmd。
process.env.KNJ_OBSIDIAN_AUTO_REFRESH = 'off'

const NOW = '2026-09-27T00:00:00.000Z'

function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-drill-'))
  const store = new VaultStore(dir)
  store.ensure()
  return { dir, store }
}

function page(store, id, extra = {}) {
  store.writePage({
    id,
    title: extra.title ?? id,
    category: extra.category ?? 'concepts',
    tags: extra.tags ?? [],
    source: 'test',
    confidence: extra.confidence ?? 'extracted',
    tier: extra.tier,
    created: NOW,
    updated: NOW,
    body: extra.body ?? `正文：${id}`,
  })
}

/** 假语义后端：只返回给定路径，绝不联网（与 semantic.test.mjs 同款做法） */
function fakeBackend(paths) {
  return { name: 'fake', async search() { return paths.map((p) => ({ path: p })) } }
}

/** 快照 vault 全量文件的 mtime + 内容，用于零写入断言 */
function snapshot(dir) {
  const out = new Map()
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out.set(p, `${statSync(p).mtimeMs}:${readFileSync(p, 'utf8').length}`)
    }
  }
  walk(join(dir, '.wiki'))
  return out
}

// ---------- 模式 A：query 入口 ----------

test('模式 A：语义种子 + 词面命中按名次融合，双通道命中者排前', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  page(store, 'both', { title: 'rate limiting 双通道', body: 'rate limiting 与退避' })
  page(store, 'semantic-only', { title: '只在语义层出现' })
  page(store, 'unrelated', { title: '无关页' })

  const res = await drillQuery(store, 'rate limiting', {
    semantic: fakeBackend([join(store.wikiRoot, 'concepts', 'semantic-only.md'), join(store.wikiRoot, 'concepts', 'both.md')]),
    semanticStatus: 'ready',
  })

  assert.equal(res.mode, 'query')
  const ids = res.seeds.map((s) => s.id)
  assert.ok(ids.includes('both'), '双通道命中页应在种子里')
  assert.ok(ids.includes('semantic-only'), '仅语义命中页应在种子里（这是 QMD 先行的意义）')
  assert.ok(!ids.includes('unrelated'), '无关页不得进入种子')

  const both = res.seeds.find((s) => s.id === 'both')
  const semOnly = res.seeds.find((s) => s.id === 'semantic-only')
  assert.ok(both.sources.includes('semantic'), 'both 应标注来自语义通道')
  assert.equal(semOnly.matchedBy, 'semantic', '仅语义命中者的 matchedBy 应为 semantic')
  assert.ok(res.seeds.indexOf(both) < res.seeds.indexOf(semOnly), '双通道命中的页应排在单通道之前（RRF 累加）')
  assert.ok(res.strategy.includes('semantic'), `strategy 应标注语义通道，实际 ${res.strategy}`)
})

// ---------------------------------------------------------------------------
// 2026-10-17：不变量 R1 —— 融合名次不得被度/tier 翻转（度只做平局裁决）。
//
// 原实现的种子分是 `rrf × (1 + 度加权) × tier权重`：乘数摆动 ~13% 而 RRF 带宽只有 ~9%，
// 连接度必然压过相关性。真实库实测（10 条改写式查询）：纯 RRF 排序 Top1 3/10，
// 乘上度/tier 后掉到 2/10——最刺眼的一例里 RRF 已把期望页排在第 1，被换成度数最高的枢纽页。
// 机制与证据：.wiki/concepts/语义融合会顶掉正确的词面-top1.md
// ---------------------------------------------------------------------------

test('回归：种子排序不得被度/tier 翻转（RRF 名次优先，枢纽页不得霸榜）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  // 语义通道自己的名次：rank1 = peripheral 且零链接；rank2 = core 且 6 条入链（度高）
  page(store, 'sem-rank-first', { title: '语义第一名', tier: 'peripheral' })
  page(store, 'hub-page', { title: '枢纽页', tier: 'core' })
  for (const i of [1, 2, 3, 4, 5, 6]) page(store, `linker-${i}`, { title: `引用页${i}`, body: '链到 [[hub-page]]。' })

  // 查询刻意与全库无字面重合 ⇒ 词面通道为空，种子的名次完全由语义通道给出
  const res = await drillQuery(store, 'zzz qqq 与库内无字面交集的句子', {
    semantic: {
      name: 'fake',
      async search() {
        return [
          { id: 'sem-rank-first', category: 'concepts' },
          { id: 'hub-page', category: 'concepts' },
        ]
      },
    },
    semanticStatus: 'ready',
    limit: 5,
  })

  const ids = res.seeds.map((s) => s.id)
  assert.ok(ids.includes('sem-rank-first') && ids.includes('hub-page'), '两个语义命中都要在种子里')
  assert.equal(res.seeds[0].id, 'sem-rank-first',
    '语义通道排第 1 的页必须是第 1 个种子——哪怕它 peripheral、零链接、而第 2 名是 core 高度数的枢纽页')
  assert.equal(res.seeds[1].id, 'hub-page', '枢纽页按语义名次排第 2，不得越到第 1')
})

test('模式 A：种子只附带一跳邻居，绝不带两跳', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  page(store, 'seed-page', { title: '种子页 drilltarget', body: 'drilltarget 正文，链到 [[hop-one]]' })
  page(store, 'hop-one', { title: '一跳邻居', body: '链到 [[hop-two]]' })
  page(store, 'hop-two', { title: '两跳页', body: '更远' })

  const res = await drillQuery(store, 'drilltarget', { semantic: null })
  const seed = res.seeds.find((s) => s.id === 'seed-page')
  assert.ok(seed, '种子页应被词面命中')
  const neighborIds = seed.neighbors.map((n) => n.id)
  assert.ok(neighborIds.includes('hop-one'), '一跳邻居必须在')
  assert.ok(!neighborIds.includes('hop-two'), '两跳页绝不得出现（图实测：两跳≈全库 40-60%）')
  for (const n of seed.neighbors) assert.equal(n.via, 'seed-page', '邻居必须标注来源种子')
})

test('模式 A：邻居带方向 out/in 与既有 matchedBy 家族区分', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  page(store, 'hub', { title: 'hubtarget', body: '链出到 [[downstream]]' })
  page(store, 'downstream', { title: '下游' })
  page(store, 'upstream', { title: '上游', body: '链到 [[hub]]' })

  const res = await drillQuery(store, 'hubtarget', { semantic: null })
  const hub = res.seeds.find((s) => s.id === 'hub')
  const down = hub.neighbors.find((n) => n.id === 'downstream')
  const up = hub.neighbors.find((n) => n.id === 'upstream')
  assert.equal(down.direction, 'out')
  assert.equal(up.direction, 'in')
  assert.equal(down.matchedBy, 'graph-neighbor', '邻居用独立取值，不与既有 graph 混淆')
  assert.equal(down.tier !== undefined, true)
  assert.equal(typeof down.degree, 'number')
})

test('模式 A：索引陈旧时结果照给并如实标注，绝不静默', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  page(store, 'wordhit', { title: 'staletarget 页', body: '正文' })

  const res = await drillQuery(store, 'staletarget', {
    semantic: fakeBackend([]),
    semanticStatus: 'index-stale',
  })
  assert.ok(res.seeds.some((s) => s.id === 'wordhit'), 'stale 时词面结果照给')
  assert.equal(res.semantic.status, 'index-stale')
  assert.ok(/旧索引/.test(res.message ?? ''), `message 必须说明基于旧索引，实际：${res.message}`)
})

test('模式 A：语义不可用时退化为纯词面并标注，不抛错不联网', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  page(store, 'onlyword', { title: 'degradetarget', body: '正文' })

  const res = await drillQuery(store, 'degradetarget', { semantic: null })
  assert.ok(res.seeds.some((s) => s.id === 'onlyword'))
  assert.ok(!res.strategy.includes('semantic'), `无语义后端时 strategy 不得声称语义，实际 ${res.strategy}`)
  assert.ok(res.semantic, 'semantic 字段须如实回报不可用')
})

test('模式 A：seed 数按 limit 截断并标注', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (let i = 0; i < 8; i += 1) page(store, `p${i}`, { title: `limittarget ${i}`, body: 'limittarget' })

  const res = await drillQuery(store, 'limittarget', { semantic: null, limit: 3 })
  assert.equal(res.seeds.length, 3)
  assert.equal(res.truncated?.seeds, true, '截断必须标注')
})

// ---------- 模式 B：page 入口 ----------

test('模式 B：以页 id 取出入链，断链标注 broken', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  page(store, 'center', { title: '中心', body: '链到 [[leaf]] 与 [[ghost-not-exist]]' })
  page(store, 'leaf', { title: '叶子' })
  page(store, 'caller', { title: '调用方', body: '链到 [[center]]' })

  const res = drillPage(store, 'center')
  assert.equal(res.mode, 'page')
  const seed = res.seeds[0]
  assert.equal(seed.id, 'center')
  const out = seed.neighbors.filter((n) => n.direction === 'out').map((n) => n.id)
  const inc = seed.neighbors.filter((n) => n.direction === 'in').map((n) => n.id)
  assert.ok(out.includes('leaf'))
  assert.ok(inc.includes('caller'))
  const ghost = seed.neighbors.find((n) => n.id === 'ghost-not-exist')
  assert.ok(ghost, '断链邻居也要列出（双链体检价值）')
  assert.equal(ghost.broken, true)
})

test('模式 B：未知 id 返回结构化空结果与可执行提示，不做模糊匹配', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  page(store, 'real-page', { title: '真实页' })

  const res = drillPage(store, 'no-such-page')
  assert.equal(res.seeds.length, 0)
  assert.ok(/不存在|先找/.test(res.message ?? ''), `须给可执行提示，实际：${res.message}`)
})

test('模式 B：孤立页明确说明无库内双链', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  page(store, 'orphan', { title: '孤儿页', body: '没有任何链接' })

  const res = drillPage(store, 'orphan')
  assert.equal(res.seeds[0].neighbors.length, 0)
  assert.ok(/无库内双链|孤儿/.test(res.message ?? ''), `须说明孤立，实际：${res.message}`)
})

// ---------- 零写入与成本 ----------

test('检索路径零写入：模式 A/B 调用前后 vault 内容与 mtime 零变化', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  page(store, 'a1', { title: 'zerowrite', body: '链到 [[a2]]' })
  page(store, 'a2', { title: 'a2' })

  const before = snapshot(dir)
  await drillQuery(store, 'zerowrite', { semantic: fakeBackend([join(store.wikiRoot, 'concepts', 'a2.md')]) })
  drillPage(store, 'a1')
  readPageDetail(store, 'a1')
  const after = snapshot(dir)

  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), '不得新增/删除文件')
  for (const [k, v] of before) assert.equal(after.get(k), v, `${k} 不得被改写`)
})

test('成本护栏：一次模式 B 调用的 readPage 次数有界（防全库全量解析回退）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (let i = 0; i < 12; i += 1) page(store, `n${i}`, { title: `n${i}`, body: i % 3 === 0 ? `链到 [[n${(i + 1) % 12}]]` : '正文' })

  const original = store.readPage.bind(store)
  let calls = 0
  store.readPage = (id, category) => { calls += 1; return original(id, category) }
  drillPage(store, 'n0')
  store.readPage = original

  assert.ok(calls <= 12 * 3, `readPage 调用次数应不超过页数×3，实际 ${calls}`)
})

// ---------- 开关 ----------

test('KNJ_OBSIDIAN_DRILL=off 可关闭新链路', () => {
  assert.equal(drillEnabled({}), true, '默认开启')
  assert.equal(drillEnabled({ KNJ_OBSIDIAN_DRILL: 'off' }), false)
  assert.equal(drillEnabled({ KNJ_OBSIDIAN_DRILL: 'OFF' }), false, '大小写不敏感')
  assert.equal(drillEnabled({ KNJ_OBSIDIAN_DRILL: 'on' }), true)
})

// ---------- wiki_read ----------

test('wiki_read：整页正文 + frontmatter 摘要 + 出/入链清单', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  page(store, 'target', { title: '目标页', body: '正文第一行。\n链到 [[friend]] 与 [[missing-page]]', tags: ['x'], tier: 'core' })
  page(store, 'friend', { title: '友页' })
  page(store, 'referrer', { title: '引用者', body: '见 [[target]]' })

  const d = readPageDetail(store, 'target')
  assert.equal(d.id, 'target')
  assert.equal(d.title, '目标页')
  assert.ok(d.body.includes('正文第一行'))
  assert.ok(d.outLinks.includes('friend'))
  assert.ok(d.outLinks.includes('missing-page'), '出链清单含断链目标（供调用方判断）')
  assert.deepEqual(d.brokenLinks, ['missing-page'])
  assert.ok(d.inLinks.includes('referrer'), '入链清单必须给出')
  assert.equal(d.tier, 'core')
})

test('wiki_read：未知 id 返回 null，不抛错', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.equal(readPageDetail(store, 'nope'), null)
})

// ---------- 文档面 ----------

test('wiki-query SKILL.md 引导含 wiki_drill 与 wiki_read', () => {
  const skill = readFileSync(join(import.meta.dirname, 'wiki-query', 'SKILL.md'), 'utf8')
  assert.ok(skill.includes('wiki_drill'), 'SKILL.md 必须提到 wiki_drill（否则模型不知道该用）')
  assert.ok(skill.includes('wiki_read'), 'SKILL.md 必须提到 wiki_read')
})

// ---------- 工具层：注册与开关 ----------
//
// 为什么单列一组：lib 层全绿**不代表工具可用**——模块写好了却没注册进 ctx.tools 时，
// 上面 15 例照样全过，而模型根本看不到这两个工具。这组用例是那条陷阱的防线。

function mount(fakeStore) {
  const registered = []
  const fakeCtx = { tools: { register: (def) => registered.push(def) } }
  const dispose = mountTools(fakeCtx, fakeStore)
  return { registered, dispose, byName: (n) => registered.find((d) => d.name === n) }
}

test('mountTools 注册 wiki_drill 与 wiki_read，output schema 完整且不放宽', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { registered, dispose, byName } = mount(store)

  const names = registered.map((d) => d.name)
  assert.ok(names.includes('wiki_drill'), 'wiki_drill 必须注册进工具表')
  assert.ok(names.includes('wiki_read'), 'wiki_read 必须注册进工具表')

  for (const n of ['wiki_drill', 'wiki_read']) {
    const def = byName(n)
    assert.equal(def.output.schema.type, 'object')
    assert.equal(def.output.schema.additionalProperties, false, `${n} 的 schema 不得放宽 additionalProperties`)
    assert.equal(typeof def.output.render, 'function')
    assert.ok(def.description.length > 20, `${n} 需要能触发使用的 description`)
  }
  // wiki_drill 的种子结构必须把「邻居」显式建模（否则模型会把邻居当命中）
  const seed = byName('wiki_drill').output.schema.properties.seeds.items
  assert.ok(seed.properties.neighbors, 'seeds[].neighbors 必须出现在 schema 里')
  assert.equal(seed.properties.neighbors.items.properties.matchedBy.type, 'string')
  assert.equal(typeof dispose, 'function')
})

test('wiki_drill 工具：KNJ_OBSIDIAN_DRILL=off 时返回关闭文案，不做任何检索', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  page(store, 'p1', { title: '关闭开关目标页' })
  const { byName } = mount(store)

  process.env.KNJ_OBSIDIAN_DRILL = 'off'
  t.after(() => { delete process.env.KNJ_OBSIDIAN_DRILL })
  const res = await byName('wiki_drill').execute({ query: '关闭开关目标页' })

  assert.equal(res.strategy, 'disabled')
  assert.equal(res.seeds.length, 0)
  assert.match(res.message, /KNJ_OBSIDIAN_DRILL=off/)
})

test('wiki_drill 工具：语义关闭时退化为纯词面并在 message 里说清', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  page(store, 'wordonly', { title: 'tooldrilltarget 页', body: '链到 [[friend]]' })
  page(store, 'friend', { title: '友页' })
  const { byName } = mount(store)

  // KNJ_OBSIDIAN_SEMANTIC_FALLBACK=off ⇒ 不加载 300M 模型，语义通道如实标注为 disabled
  process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK = 'off'
  t.after(() => { delete process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK })

  const res = await byName('wiki_drill').execute({ query: 'tooldrilltarget' })
  assert.ok(res.seeds.some((s) => s.id === 'wordonly'), '词面种子必须还在')
  assert.equal(res.semantic.status, 'disabled')
  assert.ok(!res.strategy.includes('semantic'), `不得声称走过语义：${res.strategy}`)
  assert.match(res.message ?? '', /语义/)
  assert.ok(res.seeds.find((s) => s.id === 'wordonly').neighbors.some((n) => n.id === 'friend'), '一跳邻居照给')
})

test('wiki_drill 工具：两参都不给时给出可执行提示，不报错', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { byName } = mount(store)
  const res = await byName('wiki_drill').execute({})
  assert.equal(res.seeds.length, 0)
  assert.match(res.message, /query|page/)
})

test('wiki_read 工具：命中返回 found=true 且带正文；未知 id 返回 found=false', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  page(store, 'readable', { title: '可读页', body: '整页正文在这里。\n链到 [[nowhere]]' })
  const { byName } = mount(store)

  const ok = await byName('wiki_read').execute({ id: 'readable' })
  assert.equal(ok.found, true)
  assert.ok(ok.body.includes('整页正文在这里'))
  assert.deepEqual(ok.brokenLinks, ['nowhere'])

  const miss = await byName('wiki_read').execute({ id: 'ghost' })
  assert.equal(miss.found, false)
  assert.match(miss.message, /ghost/)
})

test('工具层输出通过宿主 schema 校验（validateJsonSchemaValue）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  page(store, 'schemaok', { title: 'schematarget', body: '链到 [[other]]' })
  page(store, 'other', { title: 'other' })
  const { byName } = mount(store)

  process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK = 'off'
  t.after(() => { delete process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK })

  const drill = byName('wiki_drill')
  validateJsonSchemaValue(drill.output.schema, await drill.execute({ query: 'schematarget' }), 'wiki_drill')
  const pageRead = byName('wiki_read')
  validateJsonSchemaValue(pageRead.output.schema, await pageRead.execute({ id: 'schemaok' }), 'wiki_read')
  validateJsonSchemaValue(pageRead.output.schema, await pageRead.execute({ id: 'nope' }), 'wiki_read')
})

// ---------- 回归：undefined 是非法 JSON 值 ----------
//
// 为什么单列：宿主工具网关（@deepseek-ai/dsh-util-values 的 isJsonValue）把 undefined
// 判为非法 JSON 值，**整条工具输出被拒**，模型只看到 "value is not lossless JSON"。
// 症状极隐蔽——lib 层断言 message 文案的用例全绿，schema 校验也过（undefined ≠ 类型错误），
// 只有真跑工具网关才炸。防线：输出里出现 undefined 就必须当场失败。

/** 深度找 undefined 值（对象自有键 / 数组元素），并给出路径便于定位 */
function findUndefined(value, path = '$') {
  if (value === undefined) return path
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findUndefined(value[i], `${path}[${i}]`)
      if (hit) return hit
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      const hit = findUndefined(value[k], `${path}.${k}`)
      if (hit) return hit
    }
  }
  return null
}

test('回归：模式 B 有双链的页不得输出 message: undefined（网关会整条拒绝）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  // lonely：既无出链也无入链 ⇒ 走「有话说」分支（message 是真字符串）
  // linked：有双链 ⇒ 走「无话说」分支，正是线上翻车路径（原先这里塞了 undefined）
  page(store, 'lonely', { title: '孤立页' })
  page(store, 'linked', { title: '有链页', body: '链到 [[friend]]' })
  page(store, 'friend', { title: '友页' })
  const { byName } = mount(store)

  process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK = 'off'
  t.after(() => { delete process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK })
  const drill = byName('wiki_drill')

  // 有话可说的分支（孤立页）：message 必须真的在，且是字符串
  const orphan = await drill.execute({ page: 'lonely' })
  assert.equal(orphan.strategy, 'graph-neighbor:both')
  assert.equal(orphan.seeds[0].neighbors.length, 0)
  assert.equal(typeof orphan.message, 'string')
  assert.match(orphan.message, /无库内双链|孤儿/)
  assert.equal(findUndefined(orphan), null, `输出含 undefined：${findUndefined(orphan)}`)

  // 无话可说的分支（有双链的页）：字段必须「不存在」，绝不是值为 undefined。
  // 这正是线上翻车的那条路径：有双链 → 三元走 else 分支 → undefined 混进输出。
  const normal = await drill.execute({ page: 'linked' })
  assert.ok(normal.seeds[0].neighbors.some((n) => n.id === 'friend'), '有双链页必须带出一跳邻居')
  assert.equal('message' in normal, false, 'message 字段不得存在（值为 undefined 会被网关拒绝）')
  assert.equal(findUndefined(normal), null, `输出含 undefined：${findUndefined(normal)}`)

  // 全路径无 undefined：每个输出都要能无损过 JSON 往返（网关的同款判定）
  for (const out of [orphan, normal, await drill.execute({ page: 'ghost-id' }), await drill.execute({})]) {
    assert.equal(findUndefined(out), null, `输出含 undefined：${findUndefined(out)}`)
    assert.deepEqual(JSON.parse(JSON.stringify(out)), out, '必须能无损 JSON 往返')
  }
})

