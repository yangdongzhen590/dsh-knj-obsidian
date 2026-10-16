// semantic.test.mjs
// qmd 语义检索层：M1 探测与降级（red 阶段——lib/semantic.js 尚不存在）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from './lib/vault-store.js'
import { retrieve } from './lib/retriever.js'
import { probeQmd, retrieveWithSemantic } from './lib/semantic.js'

function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-semantic-'))
  const store = new VaultStore(dir)
  store.ensure()
  return { dir, store }
}

function seed(store) {
  const now = '2026-09-13T00:00:00.000Z'
  store.writePage({ id: 'rate-limiting', title: 'Rate Limiting 踩坑', category: 'concepts', tags: ['rate-limiting'], source: 's', confidence: 'extracted', created: now, updated: now, body: '429 处理要指数退避。' })
  store.writePage({ id: 'orders', title: '订单模块', category: 'projects', tags: ['orders'], source: 's', confidence: 'inferred', created: now, updated: now, body: '订单状态机：created → paid → shipped。' })
}

/** 假后端：模拟 qmd 的输出形态（路径 + 分数），不依赖真实二进制 */
function fakeBackend(hits) {
  return { name: 'fake', search: async () => hits }
}

function throwingBackend(message = 'boom') {
  return { name: 'fake', search: async () => { throw new Error(message) } }
}

test('probeQmd：二进制路径不存在时返回不可用并给出原因', async () => {
  const r = await probeQmd({ binaryPath: join(tmpdir(), 'definitely-not-a-real-qmd-binary-xyz') })
  assert.equal(r.available, false)
  assert.equal(typeof r.reason, 'string')
  assert.ok(r.reason.length > 0, '应给出可读原因')
})

test('语义关闭（semantic 未提供）时，结果与纯 retrieve 逐字段一致', async () => {
  const { dir, store } = makeVault()
  try {
    seed(store)
    const plain = retrieve(store, 'rate limiting')
    const withLayer = await retrieveWithSemantic(store, 'rate limiting', {})
    assert.deepEqual(withLayer, plain, '语义关闭时必须与现状逐字节一致')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('后端抛错时不抛出，结果降级为纯 L1–L4 且 strategy 标注不可用', async () => {
  const { dir, store } = makeVault()
  try {
    seed(store)
    const plain = retrieve(store, 'rate limiting')
    const r = await retrieveWithSemantic(store, 'rate limiting', { semantic: throwingBackend() })
    assert.deepEqual(r.candidates, plain.candidates, '降级后候选应与纯 retrieve 一致')
    assert.equal(r.strategy, plain.strategy, 'strategy 主体应保持原分层语义')
    assert.ok(r.semanticUnavailable, '应如实标注语义不可用')
    assert.match(r.semanticUnavailable.reason, /boom/, '原因应来自后端错误')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('后端的 _system/ 与 wiki-export/ 命中一律丢弃（不参与知识检索）', async () => {
  const { dir, store } = makeVault()
  try {
    seed(store)
    const r = await retrieveWithSemantic(store, '会话', {
      semantic: fakeBackend([
        { path: join(store.wikiRoot, '_system', 'dsh-sessions', 'sessions', 'x.md'), score: 0.9 },
        { path: join(store.wikiRoot, 'wiki-export', 'graph.json'), score: 0.8 },
        { path: join(store.wikiRoot, 'concepts', 'rate-limiting.md'), score: 0.7 },
      ]),
    })
    const ids = r.candidates.map((c) => c.id)
    assert.ok(!ids.some((id) => String(id).includes('x')), '_system 命中不得出现')
    assert.ok(!r.candidates.some((c) => c.page.includes('_system')), '_system 命中不得出现')
    assert.ok(!r.candidates.some((c) => c.page.includes('wiki-export')), 'wiki-export 命中不得出现')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('后端返回 vault 之外的路径一律丢弃', async () => {
  const { dir, store } = makeVault()
  try {
    seed(store)
    const r = await retrieveWithSemantic(store, '外部', {
      semantic: fakeBackend([
        { path: join(tmpdir(), 'outside-vault', 'concepts', 'evil.md'), score: 0.99 },
      ]),
    })
    assert.ok(!r.candidates.some((c) => String(c.id).includes('evil')), 'vault 外命中不得出现')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('语义层可用时命中标记 matchedBy=semantic，且不破坏既有候选', async () => {
  const { dir, store } = makeVault()
  try {
    seed(store)
    const plain = retrieve(store, 'rate limiting')
    const r = await retrieveWithSemantic(store, 'rate limiting', {
      semantic: fakeBackend([
        { path: join(store.wikiRoot, 'projects', 'orders.md'), score: 0.8, snippet: '订单状态机' },
      ]),
    })
    assert.ok(r.candidates.some((c) => c.id === 'orders' && c.matchedBy === 'semantic'), '语义命中应带 matchedBy=semantic')
    for (const c of plain.candidates) {
      assert.ok(r.candidates.some((x) => x.id === c.id), `既有候选 ${c.id} 不应因语义层消失`)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// 验收①：召回质量对照用例 —— 同义查询在纯关键词路径下必须搜不到，开启语义后必须命中
test('验收①：关键词零命中时，语义召回补上（对照断言）', async () => {
  const { dir, store } = makeVault()
  try {
    seed(store) // rate-limiting 页标题「Rate Limiting 踩坑」、正文「429 处理要指数退避。」
    const q = '接口被限流怎么办' // 与页面无任何字面交集
    const plain = retrieve(store, q)
    assert.equal(plain.candidates.length, 0, '前提：该查询在纯关键词路径下零命中')
    const r = await retrieveWithSemantic(store, q, {
      semantic: fakeBackend([{ path: join(store.wikiRoot, 'concepts', 'rate-limiting.md'), score: 0.91 }]),
    })
    assert.ok(
      r.candidates.some((c) => c.id === 'rate-limiting' && c.matchedBy === 'semantic'),
      '语义层应召回语义等价但字面无关的查询',
    )
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------------------
// 2026-10-17：语义融合的分值策略 —— **语义只补召回，不参与词面之上的排序**。
//
// 背景：原先语义命中一律拿扁平 base `MATCH_SCORE.semantic = 3`，于是
//   ① 语义通道自己的名次被丢掉；② 之后的度加权（最高 +2）与 tier 权重（×1.3）
//   用「连接度」覆盖了「语义相关性」。实测后果是 wiki_query 可能比纯词面**更差**
//   （10 条改写式查询 Top1 精度 6/10 → 4/10），最刺眼的一例是语义通道排**最后**的 hub 页
//   被融合顶成了 Top1。下面两条把新策略钉住。
// ---------------------------------------------------------------------------

test('语义候选按通道名次递减给分且整层垫底：core 高度数的 hub 页不得顶掉词面命中', async () => {
  const { dir, store } = makeVault()
  try {
    const now = '2026-10-17T00:00:00.000Z'
    const w = (id, title, extra = {}) => store.writePage({
      id, title, category: extra.category ?? 'concepts', tags: extra.tags ?? [], tier: extra.tier,
      source: 's', confidence: 'extracted', created: now, updated: now, body: extra.body ?? '正文与查询无关。',
    })
    // 词面弱命中：标题/标签都不含查询词，只有正文含 ⇒ body 层；再取 peripheral tier（最弱一档）= 0.7
    w('weak-prose', '无关页甲', { tier: 'peripheral', body: 'alpha beta gamma 都在正文里。' })
    // hub：core tier + 高入链度。语义通道把它排在**最后**一名。
    w('hub-page', '枢纽页', { tier: 'core' })
    for (const i of [1, 2, 3, 4, 5, 6]) w(`linker-${i}`, `引用页${i}`, { body: '链到 [[hub-page]]。' })
    w('sem-first', '语义第一名')
    w('sem-second', '语义第二名')

    const p = (id) => join(store.wikiRoot, 'concepts', `${id}.md`)
    const r = await retrieveWithSemantic(store, 'alpha beta gamma', {
      semantic: fakeBackend([
        { path: p('sem-first'), score: 0.9 },
        { path: p('sem-second'), score: 0.8 },
        { path: p('hub-page'), score: 0.1 }, // 语义通道自己把它排最后
      ]),
    })

    const byId = new Map(r.candidates.map((c) => [c.id, c]))
    const word = byId.get('weak-prose')
    const s1 = byId.get('sem-first')
    const s2 = byId.get('sem-second')
    const hub = byId.get('hub-page')
    assert.ok(word && s1 && s2 && hub, '词面命中与三个语义命中都要在')

    assert.equal(r.candidates[0].id, 'weak-prose', `词面命中必须仍是 Top1，实际 ${r.candidates[0].id}`)
    assert.ok(s1.score > s2.score, `语义候选必须按通道名次递减：${s1.score} vs ${s2.score}`)
    assert.ok(s2.score > hub.score, `hub 页在语义通道里排最后，融合后也必须排最后：${s2.score} vs ${hub.score}`)
    for (const s of [s1, s2, hub]) {
      assert.ok(s.score < word.score, `语义分 ${s.score} 必须低于词面最低档 ${word.score}，否则会顶掉词面命中`)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('词面零命中时语义候选照常给出（垫底策略不得废掉兜底本身）', async () => {
  const { dir, store } = makeVault()
  try {
    const now = '2026-10-17T00:00:00.000Z'
    store.writePage({ id: 'sem-only', title: '只有语义能召回的页', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: now, updated: now, body: '正文与查询无字面交集。' })

    const q = 'zzz 完全不存在的词'
    assert.equal(retrieve(store, q).candidates.length, 0, '前提：纯词面零命中')

    const r = await retrieveWithSemantic(store, q, {
      semantic: fakeBackend([{ path: join(store.wikiRoot, 'concepts', 'sem-only.md'), score: 0.9 }]),
    })
    assert.equal(r.candidates[0]?.id, 'sem-only', '无语义层就零结果，语义层必须补上')
    assert.equal(r.candidates[0]?.matchedBy, 'semantic')
    assert.ok(r.strategy.includes('semantic'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// 验收②：语义层开启但后端返回空 → 不引入 semanticUnavailable（空结果不是故障）
test('后端返回空数组时按正常无命中处理，不误报故障', async () => {  const { dir, store } = makeVault()
  try {
    seed(store)
    const plain = retrieve(store, '接口被限流怎么办')
    const r = await retrieveWithSemantic(store, '接口被限流怎么办', { semantic: fakeBackend([]) })
    assert.deepEqual(r, plain, '空命中应与纯 retrieve 一致')
    assert.equal(r.semanticUnavailable, undefined, '空结果不得标记为语义不可用')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
