// session-binding.test.mjs — P0 工具侧会话级库绑定（2026-10-21）
//
// 背景与契约（.wiki/concepts/会话级知识库绑定）：
//   1) exec 带 agent.session.header.cwd 且解析出库 → 读写都用会话库；
//   2) 有 cwd 却解析不出库 → 不回退全局库，抛带指引的错误；
//   3) 无 exec / 无会话头（测试替身、非 agent 调用）→ 旧全局行为。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountTools } from './lib/tools.js'
import { VaultStore } from './lib/vault-store.js'

process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK = 'off'
process.env.KNJ_OBSIDIAN_MISS_LOG = 'off'

function makeVault(root, pageId, title) {
  mkdirSync(join(root, '.wiki', 'concepts'), { recursive: true })
  writeFileSync(join(root, '.wiki', 'index.md'), '# Wiki Index\n', 'utf8')
  if (pageId) {
    writeFileSync(join(root, '.wiki', 'concepts', `${pageId}.md`), [
      '---',
      `id: ${pageId}`,
      `title: ${title}`,
      'category: concepts',
      'tags: [concept]',
      `summary: ${title}的一页`,
      'source: test',
      'confidence: extracted',
      'created: 2026-10-21T00:00:00.000Z',
      'updated: 2026-10-21T00:00:00.000Z',
      '---',
      '',
      `# ${title}`,
      '',
      '正文内容。',
    ].join('\n'), 'utf8')
  }
}

function makeProvider(sessionRoot, globalRoot) {
  const sessionStore = new VaultStore(sessionRoot)
  const globalStore = new VaultStore(globalRoot)
  return {
    provider: {
      current: () => globalStore,
      currentReadonly: () => globalStore,
      currentRecord: () => ({ id: 'v-global', name: 'global', root: globalRoot, source: 'cwd' }),
      listVaults: () => [
        { id: 'v-session', name: 'session', root: sessionRoot, source: 'workspace', pageCount: 1, initialized: true },
        { id: 'v-global', name: 'global', root: globalRoot, source: 'cwd', pageCount: 1, initialized: true },
      ],
      // 模拟 VaultManager.readonlyVaultForRoot 的关键语义：磁盘上没有 .wiki 就解析不出（返回 undefined）
      readonlyVaultForRoot: (root) => (root === sessionRoot && existsSync(join(sessionRoot, '.wiki'))
        ? { store: sessionStore, name: 'session' }
        : undefined),
      ensureVaultAt: (root) => { const s = new VaultStore(root); s.ensure(); return s },
    },
    sessionStore,
    globalStore,
  }
}

function makeCtx() {
  const registered = []
  return {
    registered,
    tools: { register: (def) => { registered.push(def); return () => {} } },
  }
}

function execWithCwd(cwd) {
  // 对齐宿主 ToolRunContext：真实 exec 携带 deferContext/concludeTurn 与 caller agent
  return { deferContext() {}, concludeTurn() {}, agent: { session: { header: { cwd, delegationDepth: 0 } } } }
}

test('有会话 cwd 时 wiki_query/wiki_read 用会话库，不碰全局库', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'knj-bind-'))
  try {
    const sessionRoot = join(dir, 'proj-a')
    const globalRoot = join(dir, 'proj-b')
    makeVault(sessionRoot, 'session-only-page', '会话库专有页')
    makeVault(globalRoot, 'global-only-page', '全局库专有页')
    const { provider } = makeProvider(sessionRoot, globalRoot)
    const ctx = makeCtx()
    mountTools(ctx, provider)
    const query = ctx.registered.find((d) => d.name === 'wiki_query')
    const read = ctx.registered.find((d) => d.name === 'wiki_read')

    const res = await query.execute({ query: '会话库专有页' }, execWithCwd(sessionRoot))
    assert.ok(res.candidates.some((c) => c.id === 'session-only-page'), '应命中会话库的页')
    assert.ok(!res.candidates.some((c) => c.id === 'global-only-page'), '不得答全局库的页')

    const rd = await read.execute({ id: 'session-only-page' }, execWithCwd(sessionRoot))
    assert.equal(rd.found, true, 'wiki_read 应在会话库找到页面')

    const miss = await read.execute({ id: 'global-only-page' }, execWithCwd(sessionRoot))
    assert.equal(miss.found, false, '会话库里没有的页（即使在全局库有）必须答不存在——这正是修复的串台')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('有 cwd 但解析不出库 → 不回退全局库，抛带指引的错误', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'knj-bind-'))
  try {
    const sessionRoot = join(dir, 'proj-a') // 注意：不建 .wiki
    const globalRoot = join(dir, 'proj-b')
    makeVault(globalRoot, 'global-only-page', '全局库专有页')
    const { provider } = makeProvider(sessionRoot, globalRoot)
    const ctx = makeCtx()
    mountTools(ctx, provider)
    const query = ctx.registered.find((d) => d.name === 'wiki_query')
    const ingest = ctx.registered.find((d) => d.name === 'wiki_ingest')

    await assert.rejects(() => query.execute({ query: '任何词' }, execWithCwd(sessionRoot)), /没有知识库.*wiki_init/s)
    await assert.rejects(() => ingest.execute({ source: 'x', pages: [{ id: 'p', title: 'p', category: 'concepts', body: 'b' }] }, execWithCwd(sessionRoot)), /没有知识库/s)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('无 exec（测试替身/非 agent 调用）→ 旧全局行为，既有用例语义不变', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'knj-bind-'))
  try {
    const sessionRoot = join(dir, 'proj-a')
    const globalRoot = join(dir, 'proj-b')
    makeVault(sessionRoot, 'session-only-page', '会话库专有页')
    makeVault(globalRoot, 'global-only-page', '全局库专有页')
    const { provider } = makeProvider(sessionRoot, globalRoot)
    const ctx = makeCtx()
    mountTools(ctx, provider)
    const query = ctx.registered.find((d) => d.name === 'wiki_query')

    const res = await query.execute({ query: '全局库专有页' }, undefined)
    assert.ok(res.candidates.some((c) => c.id === 'global-only-page'), '无会话上下文应保持全局库行为')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('wiki_init 在会话工作区建库：作用在会话根（不是全局当前库），且不误报 created', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'knj-bind-'))
  try {
    const sessionRoot = join(dir, 'proj-a') // 无 .wiki
    const globalRoot = join(dir, 'proj-b')
    makeVault(globalRoot, 'global-only-page', '全局库专有页')
    const { provider } = makeProvider(sessionRoot, globalRoot)
    const ctx = makeCtx()
    mountTools(ctx, provider)
    const init = ctx.registered.find((d) => d.name === 'wiki_init')

    const res = await init.execute({}, execWithCwd(sessionRoot))
    assert.equal(res.root, sessionRoot, 'init 应作用在会话工作区根')
    assert.equal(res.created, true, '首次建库 created=true')
    // 幂等重跑
    const again = await init.execute({}, execWithCwd(sessionRoot))
    assert.equal(again.created, false, '重跑 created=false')
    assert.equal(again.root, sessionRoot)
    // 已有库的会话：init 幂等作用于会话库
    makeVault(sessionRoot, undefined)
    const third = await init.execute({}, execWithCwd(sessionRoot))
    assert.equal(third.root, sessionRoot)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('P1：wiki_query 候选与 render 都带 frontmatter 摘要', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'knj-bind-'))
  try {
    const sessionRoot = join(dir, 'proj-a')
    const globalRoot = join(dir, 'proj-b')
    makeVault(sessionRoot, 'session-only-page', '会话库专有页')
    makeVault(globalRoot, 'x', 'x')
    const { provider } = makeProvider(sessionRoot, globalRoot)
    const ctx = makeCtx()
    mountTools(ctx, provider)
    const query = ctx.registered.find((d) => d.name === 'wiki_query')

    const res = await query.execute({ query: '会话库专有页' }, execWithCwd(sessionRoot))
    const top = res.candidates.find((c) => c.id === 'session-only-page')
    assert.ok(top.summary?.includes('会话库专有页'), '候选应透传 summary 字段')
    const rendered = query.output.render({ query: '会话库专有页' }, res).map((b) => b.text).join('\n')
    assert.match(rendered, /session-only-page\(/, 'render 保留 id(分数)')
    assert.match(rendered, /— 会话库专有页的一页/, 'render 应带摘要')  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
