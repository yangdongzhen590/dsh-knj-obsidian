/**
 * 主库 + N 子库（2026-10-25）。
 *
 * 契约：本机唯一主库（默认 ~/.dsh/.wiki，跨项目通用知识）；各工作区 .wiki 为子库。
 * - registry 新字段向后兼容：旧 vaults.json 载入后全部按子库处理
 * - 主库注册不抢占全局当前库、不自动建 .wiki
 * - 检索扩展：子库候选不足 3 条时才查主库，主库命中有独立标记
 * - 开关 KNJ_OBSIDIAN_SUBVAULTS=off 时不注册主库、不扩展
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const libImport = (f) => import(pathToFileURL(join(ROOT, 'lib', f)).href)

const subvault = await libImport('subvault.js')
const { VaultManager } = await libImport('vault-manager.js')
const { mountWikiRoutes } = await libImport('routes.js')
const { mountTools } = await libImport('tools.js')

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'knj-subvault-'))
  const child = join(dir, 'child-proj')
  const main = join(dir, 'main-home')
  mkdirSync(join(child, '.wiki'), { recursive: true })
  mkdirSync(main, { recursive: true }) // 主库目录存在但 .wiki 尚未初始化
  const registry = join(dir, 'vaults.json')
  return { dir, child, main, registry }
}

function makeManager(sb, extra = {}) {
  return new VaultManager({
    registryFile: sb.registry,
    cwdRoot: sb.child,
    workspaceRoots: [{ path: sb.child }],
    mainRoot: sb.main,
    subVaults: true,
    ...extra,
  })
}

test('subVaultsEnabled: 默认开启，off/OFF 关闭', () => {
  assert.equal(subvault.subVaultsEnabled({}), true)
  assert.equal(subvault.subVaultsEnabled({ KNJ_OBSIDIAN_SUBVAULTS: 'off' }), false)
  assert.equal(subvault.subVaultsEnabled({ KNJ_OBSIDIAN_SUBVAULTS: ' OFF ' }), false)
  assert.equal(subvault.subVaultsEnabled({ KNJ_OBSIDIAN_SUBVAULTS: 'on' }), true)
})

test('defaultMainRoot: 默认 ~/.dsh，可被 KNJ_OBSIDIAN_MAIN_VAULT_DIR 覆盖', () => {
  assert.equal(subvault.defaultMainRoot({}), join(homedir(), '.dsh'))
  assert.equal(subvault.defaultMainRoot({ KNJ_OBSIDIAN_MAIN_VAULT_DIR: 'D:\\knj-main' }), 'D:\\knj-main')
})

test('mergeMainCandidates: 整体按分数降序（同分子库在前）、主库命中带 vault=main、按 id 去重', () => {
  const child = {
    candidates: [
      { id: 'a', category: 'concepts', title: 'A', score: 9, source: 'x' },
      { id: 'b', category: 'concepts', title: 'B', score: 8, source: 'y' },
    ],
    strategy: 'word',
    totalPages: 2,
  }
  const main = {
    candidates: [
      { id: 'b', category: 'concepts', title: 'B', score: 7, source: 'y' },
      { id: 'm1', category: 'synthesis', title: 'M1', score: 6, source: 'z' },
    ],
    strategy: 'word',
    totalPages: 9,
  }
  const merged = subvault.mergeMainCandidates(child, main, 10)
  assert.deepEqual(merged.candidates.map((c) => c.id), ['a', 'b', 'm1'])
  assert.equal(merged.candidates[2].vault, 'main')
  assert.equal(merged.candidates[0].vault, undefined)
  assert.equal(merged.expanded, true)
  // 主库高相关命中必须排在子库语义噪声之前；同分时仍子库在前（稳定排序）
  const noisyChild = {
    candidates: [{ id: 'junk', matchedBy: 'semantic', score: 0.3 }],
    strategy: 'word', totalPages: 1,
  }
  const strongMain = {
    candidates: [{ id: 'main-hit', matchedBy: 'title', score: 4.8, source: 'x' }],
    strategy: 'word', totalPages: 3,
  }
  assert.deepEqual(
    subvault.mergeMainCandidates(noisyChild, strongMain, 10).candidates.map((c) => c.id),
    ['main-hit', 'junk'],
  )
  const tieChild = { candidates: [{ id: 'c-tie', matchedBy: 'title', score: 2 }], strategy: 'word', totalPages: 1 }
  const tieMain = { candidates: [{ id: 'm-tie', matchedBy: 'title', score: 2 }], strategy: 'word', totalPages: 1 }
  assert.deepEqual(
    subvault.mergeMainCandidates(tieChild, tieMain, 10).candidates.map((c) => c.id),
    ['c-tie', 'm-tie'],
  )
  // 上限：只剩 1 个空位
  const capped = subvault.mergeMainCandidates(child, main, 2)
  assert.deepEqual(capped.candidates.map((c) => c.id), ['a', 'b'])
  assert.equal(capped.expanded, false)
})

test('旧 registry（无 role/mainVaultId）载入：既有库全部按子库处理', () => {
  const sb = sandbox()
  writeFileSync(sb.registry, JSON.stringify({
    version: 1,
    currentVaultId: 'v-x',
    vaults: [
      { id: 'v-x', name: 'child-proj', root: sb.child, source: 'workspace' },
    ],
  }), 'utf8')
  const mgr = makeManager(sb)
  // 旧条目没有 role → 按子库处理（只有新注册的主库是 main）
  const legacy = mgr.listVaults().find((v) => v.root === sb.child)
  assert.ok(legacy, '旧条目的库仍应出现在列表里')
  assert.notEqual(legacy.role, 'main', '旧条目不得被升级成主库')
  assert.equal(mgr.listVaults().filter((v) => v.role === 'main').length, 1)
  assert.equal(mgr.currentRecord()?.root, sb.child, '旧 currentVaultId 仍有效，不被主库顶替')
})

test('主库注册：role=main、不抢占当前库、不自动建 .wiki、持久化 mainVaultId', () => {
  const sb = sandbox()
  const mgr = makeManager(sb)
  const main = mgr.mainVault()
  assert.ok(main, '主库应已注册')
  assert.equal(main.name, '主知识库')
  assert.equal(main.initialized, false, '注册 ≠ 建库')
  assert.equal(existsSync(join(sb.main, '.wiki')), false, '不得自动创建主库 .wiki')
  assert.equal(mgr.currentRecord()?.root, sb.child, '主库不得抢占全局当前库')
  assert.equal(mgr.listVaults().find((v) => v.role === 'main')?.root, sb.main)

  const saved = JSON.parse(readFileSync(sb.registry, 'utf8'))
  assert.equal(saved.mainVaultId, main.record.id)
  assert.equal(saved.vaults.find((v) => v.id === main.record.id).role, 'main')

  // 重新载入仍是主库
  const mgr2 = makeManager(sb)
  assert.equal(mgr2.mainVault()?.record.id, main.record.id)
})

test('setMainVault: 新主库上位，旧主库降级为 child', () => {
  const sb = sandbox()
  const mgr = makeManager(sb)
  const childRec = mgr.recordForRoot(sb.child)
  assert.ok(childRec)
  mgr.setMainVault(childRec.id)
  assert.equal(mgr.mainVault()?.record.root, sb.child)
  assert.equal(mgr.listVaults().filter((v) => v.role === 'main').length, 1)
  assert.equal(mgr.listVaults().find((v) => v.root === sb.main)?.role, 'child')
})

test('扩展阈值只数实召回：semantic 兜底噪声不算「子库够了」', () => {
  // 2026-10-25 实测：稀疏子库里语义兜底会返回 5 条 0.0x 分噪声，
  // 若按原始候选数判「够了」，最该扩主库的场景反而不扩。
  const sem = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, matchedBy: 'semantic', score: 0.1 }))
  const solid = (n) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, matchedBy: 'title', score: 5 }))
  assert.equal(subvault.shouldExpandToMain([...sem(5)]), true, '全是语义噪声 → 应扩主库')
  assert.equal(subvault.shouldExpandToMain([...solid(3)]), false, '3 条实召回 → 不扩')
  assert.equal(subvault.shouldExpandToMain([...solid(2), ...sem(4)]), true, '实召回不足 3 → 扩')
  assert.equal(subvault.shouldExpandToMain([...solid(2), ...sem(1)], 2), false, '阈值可配置：2 条实召回已达自定义阈值')
})

test('开关 off：不注册主库、mainVault 为空、registry 不出现 role=main', () => {
  const sb = sandbox()
  const mgr = makeManager(sb, { subVaults: false })
  assert.equal(mgr.mainVault(), undefined)
  const saved = JSON.parse(readFileSync(sb.registry, 'utf8'))
  assert.equal(saved.mainVaultId, null)
  assert.ok(saved.vaults.every((v) => v.role !== 'main'))
})

test('GET /vaults?root=<子库> 回填 main，current 仍是子库', async () => {  const sb = sandbox()
  const mgr = makeManager(sb)
  let handler
  mountWikiRoutes({ webServer: { register: (r) => { handler = r.handler; return () => {} } } }, mgr, {
    refresherFor: () => ({ status: async () => ({}), refreshNow: async () => {} }),
  })
  const call = async (url) => {
    const out = { status: 0, body: undefined }
    const res = { setHeader() {}, writeHead(s) { out.status = s; return res }, end(p) { out.body = p ? JSON.parse(p) : undefined } }
    await handler({ url, method: 'GET', headers: {}, on() {} }, res)
    return out
  }
  const res = await call('/api/obsidian-wiki/vaults?root=' + encodeURIComponent(sb.child))
  assert.equal(res.status, 200)
  assert.equal(res.body.current?.root, sb.child, 'current 必须是子库，不能被子库顶替成主库')
  assert.equal(res.body.main?.root, sb.main)
  assert.equal(res.body.main?.name, '主知识库')
  assert.equal(res.body.main?.initialized, false)
  assert.equal(res.body.main?.role, 'main')
})

test('wiki_ingest 写入路由：默认子库；target=main 写主库；主库未初始化报错且不建库', async () => {
  const sb = sandbox()
  const mgr = makeManager(sb)
  const registered = []
  mountTools({ tools: { register: (d) => registered.push(d) } }, mgr)
  const ingest = registered.find((d) => d.name === 'wiki_ingest')
  assert.ok(ingest, 'wiki_ingest 应已注册')
  // 无会话 cwd 的 exec：落到当前库（本沙箱里 current == cwd 子库）
  const EXEC = { deferContext() {}, concludeTurn() {} }

  const r1 = await ingest.execute({
    source: 'agent:test-child',
    pages: [{ id: 'p1', title: 'P1', category: 'concepts', body: 'child body' }],
  }, EXEC)
  assert.equal(r1.vaultRole, 'child', '默认写子库')
  assert.equal(r1.vaultRoot, sb.child)
  assert.ok(existsSync(join(sb.child, '.wiki', 'concepts', 'p1.md')))

  // 主库未初始化：必须明确报错，且绝不自动建 .wiki
  await assert.rejects(
    () => ingest.execute({
      source: 'agent:test-main',
      target: 'main',
      pages: [{ id: 'p2', title: 'P2', category: 'concepts', body: 'main body' }],
    }, EXEC),
    /主库还没有初始化/,
  )
  assert.equal(existsSync(join(sb.main, '.wiki')), false, '写主库失败不得自动建库')

  // 初始化主库（模拟 wiki_init）后可显式写主库
  mkdirSync(join(sb.main, '.wiki', 'concepts'), { recursive: true })
  const r2 = await ingest.execute({
    source: 'agent:test-main-ok',
    target: 'main',
    pages: [{ id: 'm1', title: 'M1', category: 'concepts', body: 'main body' }],
  }, EXEC)
  assert.equal(r2.vaultRole, 'main')
  assert.equal(r2.vaultRoot, sb.main)
  assert.ok(existsSync(join(sb.main, '.wiki', 'concepts', 'm1.md')), 'target=main 应写进主库')
  assert.equal(existsSync(join(sb.child, '.wiki', 'concepts', 'm1.md')), false, '不得同时写子库')
})
