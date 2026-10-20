// retriever.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from './lib/vault-store.js'
import { retrieve, linkedPages } from './lib/retriever.js'

function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-retriever-'))
  const store = new VaultStore(dir)
  store.ensure()
  return { dir, store }
}

function seed(store) {
  const now = '2026-08-25T00:00:00.000Z'
  store.writePage({ id: 'rate-limiting', title: 'Rate Limiting 踩坑', category: 'concepts', tags: ['rate-limiting', 'api'], source: 's', confidence: 'extracted', created: now, updated: now, body: '429 处理要指数退避。重试窗口要加抖动。' })
  store.writePage({ id: 'stale-closure', title: 'React Stale Closure', category: 'concepts', tags: ['react', 'hooks'], source: 's', confidence: 'extracted', created: now, updated: now, body: '闭包捕获旧值，useEffect 依赖数组要写全。' })
  store.writePage({ id: 'orders', title: '订单模块', category: 'projects', tags: ['orders', 'billing'], source: 's', confidence: 'inferred', created: now, updated: now, body: '订单状态机：created → paid → shipped。' })
}

test('空查询返回空结果', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  const r = retrieve(store, '   ')
  assert.equal(r.candidates.length, 0)
  assert.equal(r.strategy, 'empty-query')
})

test('L1 index-only 模式只读 index.md 命中行', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  // 在 index.md 里写入一个提及
  writeFileSync(join(dir, '.wiki', 'index.md'), '# Wiki Index\n\n## 概念页\n- [[rate-limiting]]\n', 'utf8')
  const r = retrieve(store, 'rate-limiting', { mode: 'index-only' })
  assert.equal(r.strategy, 'index-only')
  const hit = r.candidates.find((c) => c.id === 'rate-limiting')
  assert.ok(hit, 'index-only 应从 index.md 命中')
  assert.ok(hit.page.includes('rate-limiting'))
  assert.equal(hit.matchedBy, 'index', 'L1 命中应标记 matchedBy=index')
  assert.equal(hit.snippet, '- [[rate-limiting]]', 'snippet 应为 index.md 命中行原文')
})

test('L2 标题匹配返回带 confidence 的候选', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  const r = retrieve(store, 'rate limiting')
  assert.ok(r.candidates.some((c) => c.id === 'rate-limiting' && c.matchedBy === 'title'))
  assert.equal(r.candidates.find((c) => c.id === 'rate-limiting').confidence, 'extracted')
  assert.ok(r.totalPages >= 3)
})

test('L2 标签匹配（标题不含但标签含）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  const r = retrieve(store, 'billing')
  assert.ok(r.candidates.some((c) => c.id === 'orders' && c.matchedBy === 'tag'))
})

test('L3 正文匹配返回 snippet（截断 ≤200 字符）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  const r = retrieve(store, '指数退避')
  const hit = r.candidates.find((c) => c.id === 'rate-limiting')
  assert.ok(hit, '正文命中应返回 rate-limiting')
  assert.equal(hit.matchedBy, 'body')
  assert.ok(hit.snippet.length <= 200, 'snippet 应截断')
  assert.ok(hit.snippet.includes('指数退避'))
})

test('L3 长正文命中：snippet 居中于命中位置而非正文头部', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const now = '2026-08-25T00:00:00.000Z'
  // 命中词位于第 300 字符之后（超出旧 slice(0,200) 窗口，只有居中窗口能包含它）
  const body = '甲'.repeat(300) + '目标词' + '甲'.repeat(300)
  store.writePage({ id: 'longpage', title: '长文', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: now, updated: now, body })
  const r = retrieve(store, '目标词')
  const hit = r.candidates.find((c) => c.id === 'longpage')
  assert.ok(hit, '正文命中应返回 longpage')
  assert.equal(hit.matchedBy, 'body')
  assert.ok(hit.snippet.length <= 200, 'snippet 应截断 ≤200')
  assert.ok(hit.snippet.includes('目标词'), 'snippet 应包含命中词（居中窗口）')
  assert.notEqual(hit.snippet, body.slice(0, 200), '居中窗口不应等于正文头部 200 字符')
})

test('L2 命中足够时不升 L3（strategy 为 title+tag）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  const r = retrieve(store, 'rate limiting')
  assert.equal(r.strategy, 'title+tag', '标题命中后不应再查正文')
})

test('maxCandidates 限制候选数', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  const r = retrieve(store, 'a', { maxCandidates: 1 })
  assert.ok(r.candidates.length <= 1)
})

test('L4 图谱遍历：query 无直接命中时返回相关节点的邻居', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const now = '2026-08-25T00:00:00.000Z'
  store.writePage({ id: 'auth', title: 'Auth 认证', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: now, updated: now, body: 'JWT 与 session 对比。参考 [[rate-limiting]] 与 [[orders]]。' })
  store.writePage({ id: 'rate-limiting', title: 'Rate Limiting', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: now, updated: now, body: '429 处理。参考 [[auth]]。' })
  store.writePage({ id: 'orders', title: '订单', category: 'projects', tags: [], source: 's', confidence: 'inferred', created: now, updated: now, body: '订单流程。参考 [[rate-limiting]]。' })
  const r = retrieve(store, 'JWT')
  // query "JWT" 只在 auth 正文出现 → L3 命中 auth；它的邻居 rate-limiting 也应作为关联候选
  const ids = r.candidates.map((c) => c.id)
  assert.ok(ids.includes('auth'), '正文命中 auth')
  assert.ok(ids.includes('rate-limiting'), 'auth 的一跳邻居应出现')
  assert.ok(r.candidates.some((c) => c.id === 'rate-limiting' && c.matchedBy === 'graph'))
})

test('L4 图谱去重：两个正文命中共享同一邻居时该邻居只出现一次', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const now = '2026-08-25T00:00:00.000Z'
  store.writePage({ id: 'alpha', title: 'Alpha', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: now, updated: now, body: '共享目标词出现。参考 [[common]]。' })
  store.writePage({ id: 'beta', title: 'Beta', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: now, updated: now, body: '共享目标词也出现。参考 [[common]]。' })
  store.writePage({ id: 'common', title: 'Common', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: now, updated: now, body: '普通页面。' })
  const r = retrieve(store, '目标词')
  // 两个正文命中（alpha/beta）都出链 [[common]]，去重后 common 只能出现一次
  const graph = r.candidates.filter((c) => c.matchedBy === 'graph')
  assert.ok(graph.length >= 1, '应有图谱候选')
  assert.equal(graph.filter((c) => c.id === 'common').length, 1, '共享邻居只出现一次')
})

test('linkedPages 返回页面出链 target 列表', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const now = '2026-08-25T00:00:00.000Z'
  store.writePage({ id: 'a', title: 'A', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: now, updated: now, body: '参考 [[b]] 与 [[c|别名]] 和 [[d#锚点]]' })
  store.writePage({ id: 'b', title: 'B', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: now, updated: now, body: 'ok' })
  store.writePage({ id: 'c', title: 'C', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: now, updated: now, body: 'ok' })
  store.writePage({ id: 'd', title: 'D', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: now, updated: now, body: 'ok' })
  const links = linkedPages(store, 'a', 'concepts')
  assert.deepEqual(links.sort(), ['b', 'c', 'd'])
})

// ---------------------------------------------------------------------------
// 2026-09-20 检索闭环修复：多词查询拆词命中 + 候选透传 source
// 实测背景：整串子串匹配下，「knj-workflow 流程实例 运行 变量」这类多词查询
// 在 12 个会话里被反复重试且全部返回「wiki 无匹配」——查询是自然的词组式写法，
// 恰好是整串匹配命中率最低的写法。
// ---------------------------------------------------------------------------

test('多词查询拆词命中：整串子串不成立时仍能召回（占比加权）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const now = '2026-08-25T00:00:00.000Z'
  const body = 'dsh-scheduler 的 cron 表达式按 UTC 解释；定时任务在当地时间早上九点没触发，用户以为坏了。'
  store.writePage({ id: 'cron-utc', title: '定时任务时区被强制成 UTC', category: 'concepts', tags: ['cron', 'pitfall'], source: 'agent:session-2026-08-27', confidence: 'extracted', created: now, updated: now, body })

  const query = '定时任务 没触发'
  // 前提自检：整串子串语义下这个查询不可能命中（标题/标签/正文都不含该连续串）——
  // 保证下面的召回确实来自「拆词」，而不是碰巧的整串命中。
  assert.ok(!body.toLowerCase().includes(query), '正文不含整串查询')
  assert.ok(!'定时任务时区被强制成 UTC'.toLowerCase().includes(query), '标题不含整串查询')

  const r = retrieve(store, query)
  const hit = r.candidates.find((c) => c.id === 'cron-utc')
  assert.ok(hit, '含部分查询词的页面必须被召回')
  // 2026-09-20：CJK 串按 2 字滑窗拆 bigram 后，本查询的词表是
  //   定时任务 → 定时/时任/任务 ； 没触发 → 没触/触发
  // 标题「定时任务时区被强制成 UTC」命中 定时/时任/任务 = 3/5 → 基础分 6 × 0.6 = 3.6
  // （度 0、tier 默认 supporting 1.0）。占比含义没变，只是分母改由 bigram 组成。
  assert.equal(hit.matchedBy, 'title')
  // 浮点：3/5 不是精确二进制小数，实测 3.5999999999999996 —— 用容差断言
  assert.ok(Math.abs(hit.score - 3.6) < 1e-9, `多词命中按命中词占比加权（实际 ${hit.score}）`)
})

test('多词查询：命中全部词时拿到完整基础分（单 token 与多 token 同一套公式）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const now = '2026-08-25T00:00:00.000Z'
  store.writePage({ id: 'all-words', title: '时区 定时任务', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: now, updated: now, body: '正文无关。' })

  // 词序与标题不同 → 不是「标题全等」，因此走 title 档（6）而非 exactTitle 档（10）：
  // 这样才真的在测「全词命中 → 占比 1 → 完整基础分」。
  const r = retrieve(store, '定时任务 时区')
  const hit = r.candidates.find((c) => c.id === 'all-words')
  assert.ok(hit)
  assert.equal(hit.score, 6, '两个词都命中标题 → 6 × 1.0（词序不同，故不吃 exactTitle 的 10）')
  assert.equal(r.strategy, 'title+tag', '全部词命中前置层 → 护栏照常触发')
})

test('单 token 查询行为逐字节不变（拆词不得改变既有契约）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  // 标题命中：'rate' 落在标题「Rate Limiting 踩坑」里 → base 6（非精确：标题≠查询）
  const byTitle = retrieve(store, 'rate')
  assert.equal(byTitle.strategy, 'title+tag', '前置层命中即停的护栏契约不变')
  const t1 = byTitle.candidates.find((c) => c.id === 'rate-limiting')
  assert.equal(t1.matchedBy, 'title')
  assert.equal(t1.score, 6, '标题 6 × tier(supporting 1.0) + 度 0，与改动前一致')

  // 标签命中：'rate-limiting' 是标签（标题里是空格写法）→ base 4，护栏同样触发
  const byTag = retrieve(store, 'rate-limiting')
  assert.equal(byTag.strategy, 'title+tag')
  const t2 = byTag.candidates.find((c) => c.id === 'rate-limiting')
  assert.equal(t2.matchedBy, 'tag')
  assert.equal(t2.score, 4, '标签 4 × tier(supporting 1.0) + 度 0，与改动前一致')
})

test('候选透传 source：合成答案可追溯到原始出处', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const now = '2026-08-25T00:00:00.000Z'
  store.writePage({ id: 'trace-me', title: '可追溯页', category: 'references', tags: [], source: 'agent:session-2026-09-19-abc', confidence: 'extracted', created: now, updated: now, body: '唯一术语 zzzmarker 出现在这里。' })

  const hit = retrieve(store, 'zzzmarker').candidates.find((c) => c.id === 'trace-me')
  assert.ok(hit, '正文命中应有候选')
  assert.equal(hit.source, 'agent:session-2026-09-19-abc', '候选必须带 source（原始出处链不得断在第一环）')
})

// ---------------------------------------------------------------------------
// 2026-09-20 第二轮：中文无空格问句。
// 实测背景：分词只按空白/标点切分，对**没有空格的中文句子等于没拆**——
// 「知识库怎么触发检索」「怎么避免定时器在错误的时钟下工作」在词面层都是 0 命中，
// 而这两种写法恰恰是用户提任务时的天然写法（任务级提醒要拿它做匹配，必须先补上）。
// 修法：CJK 连续串按 2 字滑窗拆 bigram（确定性、零依赖）。只增加召回，
// 2 字中文（=1 个 bigram，与整串等价）与英文/含空格查询的行为不变。
// ---------------------------------------------------------------------------

test('中文无空格问句：bigram 拆词后可召回（此前词面层必然 0 命中）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const now = '2026-08-25T00:00:00.000Z'
  store.writePage({ id: 'wiki-trigger', title: '知识库检索触发层', category: 'projects', tags: ['dsh'], source: 'agent:s', confidence: 'extracted', created: now, updated: now, body: '任务级提醒与索引优先策略。' })

  const query = '知识库怎么触发检索'
  // 前提自检：整串既不在标题里、也不在正文里 → 命中只能来自拆词
  assert.ok(!'知识库检索触发层'.includes(query), '标题不含整串查询')
  assert.ok(!'任务级提醒与索引优先策略。'.includes(query), '正文不含整串查询')

  const hit = retrieve(store, query).candidates.find((c) => c.id === 'wiki-trigger')
  assert.ok(hit, '中文问句必须能召回相关页（bigram 拆词）')
  assert.ok(hit.score > 0)
})

test('中文 bigram 不改变短查询与英文查询的既有行为', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const now = '2026-08-25T00:00:00.000Z'
  store.writePage({ id: 'rate-limiting', title: 'Rate Limiting 踩坑', category: 'concepts', tags: ['rate-limiting', '限流'], source: 's', confidence: 'extracted', created: now, updated: now, body: '429 处理要指数退避。' })

  // 2 字中文 = 1 个 bigram，与整串等价 → 标签档 base 4，护栏照常触发
  const two = retrieve(store, '限流')
  const h1 = two.candidates.find((c) => c.id === 'rate-limiting')
  assert.equal(h1.matchedBy, 'tag')
  assert.equal(h1.score, 4, '2 字中文查询与改动前一致')
  assert.equal(two.strategy, 'title+tag')

  // 英文单 token 不受影响
  const ascii = retrieve(store, 'rate')
  const h2 = ascii.candidates.find((c) => c.id === 'rate-limiting')
  assert.equal(h2.matchedBy, 'title')
  assert.equal(h2.score, 6)
})

// ---------------------------------------------------------------------------
// 兼容口径（2026-09-21 对抗审查后补）：原条款写成「327 例必须继续全绿、不得改变既有分数」，
// 与「中文问句必须能召回」自相矛盾（后者必然改变 ≥3 字中文的分数与排序）。
// 因此把承诺改成可检验的形式——**未截断层面命中集只增不减**：
//   参照实现 = 改动前的词面规则（整串大小写不敏感 includes，扫 title/tags/summary/body）。
//   不变量   = 参照实现命中的每一页，都必须仍在新实现的候选里（bigram 只增加召回）。
// ⚠️ 截断层不保证：默认 maxCandidates 小时，成员资格会随排序变化而变化。真实库实测
//    「知识库怎么触发检索」的 top-3 从 {dsh-knj-plugins, dsh-plugin-dev-pitfalls,
//    wiki-retrieval-trigger-layer} 变成 {wiki-retrieval-trigger-layer, dsh-knj-plugins,
//    dsh-session-persistence}——成员确实换了一个，但那是**截断**造成的，不是召回丢失。
//    这条口径必须写在断言旁边，否则下一个人会把它当成回归。
// ---------------------------------------------------------------------------

/** 参照实现：改动前的词面层规则（整串子串命中）。 */
function oldFrontLayerIds(store, query) {
  const q = query.toLowerCase()
  const ids = []
  for (const listed of store.listPages()) {
    const page = store.readPage(listed.id, listed.category)
    if (!page) continue
    const hay = [page.title ?? '', (page.tags ?? []).join(' '), page.summary ?? '', page.body ?? '']
      .join('\n').toLowerCase()
    if (hay.includes(q)) ids.push(page.id)
  }
  return ids
}

test('中文 bigram 只增加召回：≥3 字中文查询的**未截断命中集**只增不减', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const now = '2026-08-25T00:00:00.000Z'
  // ① 含整串的页（改动前就该命中）② 只含 bigram 组合、不含整串的页（改动后新增召回）③ 无关页
  store.writePage({ id: 'cron-tz', title: 'Cron 时区被强制成 UTC', category: 'references', tags: ['dsh', 'cron'], source: 's', confidence: 'extracted', created: now, updated: now, body: '定时任务没触发时区设置：dsh-scheduler 的 cron 表达式按 UTC 解释。' })
  store.writePage({ id: 'wiki-trigger', title: '知识库检索触发层', category: 'projects', tags: ['dsh'], source: 's', confidence: 'extracted', created: now, updated: now, body: '任务级提醒与索引优先策略。' })
  store.writePage({ id: 'image-size', title: '图片尺寸处理', category: 'concepts', tags: [], source: 's', confidence: 'extracted', created: now, updated: now, body: '800x600 缩放。' })

  for (const query of ['定时任务没触发时区设置', '知识库怎么触发检索', 'Cron 时区']) {
    const oldIds = oldFrontLayerIds(store, query)
    const newIds = retrieve(store, query, { maxCandidates: 100 }).candidates.map((c) => c.id)
    assert.ok(oldIds.length > 0 || query === '知识库怎么触发检索', `参照实现应对「${query}」有命中（否则这条断言是空转）`)
    for (const id of oldIds) {
      assert.ok(newIds.includes(id), `「${query}」改动前命中的 ${id} 不得丢失（分词只增召回）`)
    }
    // 截断层：截断结果必须是未截断结果的子集（成员可换，但不得凭空出现）
    const top3 = retrieve(store, query, { maxCandidates: 3 }).candidates.map((c) => c.id)
    for (const id of top3) assert.ok(newIds.includes(id), '截断结果必须是未截断结果的子集')
  }

  // 召回确实变宽（证明上一段不是恒真）：整串规则漏掉的那页，新实现能召回
  const q = '知识库怎么触发检索'
  assert.ok(!oldFrontLayerIds(store, q).includes('wiki-trigger'), '前提：参照实现漏掉该页（标题里没有「怎么」）')
  const newIds = retrieve(store, q, { maxCandidates: 100 }).candidates.map((c) => c.id)
  assert.ok(newIds.includes('wiki-trigger'), '新实现必须召回参照实现漏掉的那页——这才是「只增」的实证')
  assert.ok(!newIds.includes('image-size'), '无关页仍然不得被召回（只增召回 ≠ 什么都召回）')
})

// ---------------------------------------------------------------------------
// 问法层（页内 ```queries 块）：能力页的标题与真实提问没有共同 bigram，
// 词面层只能靠这一档把改写式查询救回来。以下断言钉住「权重位置 / 命中归属 /
// 护栏口径 / strategy 披露」四件事——缺少任何一条，这一层就会静默退化。
// ---------------------------------------------------------------------------

test('问法层：正文外的 ```queries 命中标记为 queries，且权重高于 body、低于 title', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const now = '2026-08-25T00:00:00.000Z'
  // A：标题与正文都没有「垫底」，只有 queries 块里有 → 只能由问法层召回
  store.writePage({
    id: 'capability-retrieval', title: '知识检索', category: 'projects', tags: ['retrieval'],
    source: 's', confidence: 'inferred', created: now, updated: now,
    body: '## 1. 概念定义\n\n分层检索主链。\n\n```queries\n语义分为什么垫底\n```\n',
  })
  // B：同样的词只出现在正文里 → body 档
  store.writePage({
    id: 'pitfall-semantic', title: '语义层排序教训', category: 'concepts', tags: [],
    source: 's', confidence: 'extracted', created: now, updated: now,
    body: '语义分为什么垫底：名次递减且整层低于 graph 层。',
  })
  const r = retrieve(store, '语义分为什么垫底')
  const a = r.candidates.find((c) => c.id === 'capability-retrieval')
  const b = r.candidates.find((c) => c.id === 'pitfall-semantic')
  assert.ok(a, '问法命中必须召回该页')
  assert.equal(a.matchedBy, 'queries', '命中归属应为 queries（不是 title/tag/body）')
  assert.ok(b, '正文命中页仍在结果内')
  assert.ok(a.score > b.score, `问法档(${a.score}) 应高于正文档(${b.score})`)
  // 权重位置：queries(5) 严格夹在 title(6) 与 tag(4) 之间
  const titleHit = retrieve(store, '知识检索').candidates.find((c) => c.id === 'capability-retrieval')
  assert.equal(titleHit.matchedBy, 'title')
  assert.ok(titleHit.score > a.score, '标题命中必须压过问法命中')
})

test('问法层：strategy 如实披露 queries（不得谎报成 title+tag）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const now = '2026-08-25T00:00:00.000Z'
  // 标题「侧边面板」与下面两个查询**零共享 bigram**，否则标题层先命中、问法层走不到
  // （第一版测试就踩了这个坑：标题写「边栏 UI」，查询里的「边栏」让 titleRatio>0 先短路）。
  store.writePage({
    id: 'capability-x', title: '侧边面板', category: 'projects', tags: [],
    source: 's', confidence: 'inferred', created: now, updated: now,
    body: '面板挂了哪些槽位。\n\n```queries\n边栏加一个按钮怎么做\n```\n',
  })
  // ① 未触发护栏（只命中部分词：「钮怎」不在声明里）→ 走分层主链，parts 里必须有 queries
  const partial = retrieve(store, '按钮怎么做')
  assert.ok(partial.candidates.some((c) => c.matchedBy === 'queries'), `部分命中应归问法层，实际 ${JSON.stringify(partial.candidates.map((c) => [c.id, c.matchedBy]))}`)
  assert.ok(partial.strategy.includes('queries'), `strategy 应含 queries，实际 ${partial.strategy}`)
  // ② 触发护栏（全词命中问法）→ 早退分支也必须披露 queries
  const full = retrieve(store, '边栏加一个按钮怎么做')
  assert.ok(full.candidates.some((c) => c.matchedBy === 'queries'), `全词命中应归问法层，实际 ${JSON.stringify(full.candidates.map((c) => [c.id, c.matchedBy]))}`)
  assert.ok(full.strategy.includes('queries'), `护栏分支 strategy 也应含 queries，实际 ${full.strategy}`)
})

test('问法层兜底：没有 queries 块时 strategy 保持 title+tag（不凭空多出标签）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  const r = retrieve(store, 'billing')
  assert.equal(r.strategy, 'title+tag', `无问法命中时不得改口径，实际 ${r.strategy}`)
  assert.ok(r.candidates.every((c) => c.matchedBy !== 'queries'))
})
