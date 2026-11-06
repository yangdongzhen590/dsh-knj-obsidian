// workspace-root-init.test.mjs — P0：init 落点不得被「cwd 种子」祖先劫持
//
// 真机症状：进程 cwd（例如 C:\Users\MrYang）被无条件登记成 source:'cwd' 的库记录；
// 在它下面的任意新目录里点初始化，workspaceRootFor 会取最深祖先 → 在 home 建 .wiki。
// 契约：候选只认 source:'workspace'|'attached'；没有候选时落 cwd 自身
// （与“读路径口径”一致：读路径在外层已注册根没有 .wiki 时就停住，init 也应停在同一层）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountTools } from './lib/tools.js'
import { VaultStore } from './lib/vault-store.js'

process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK = 'off'
process.env.KNJ_OBSIDIAN_MISS_LOG = 'off'

function execWithCwd(cwd) {
  return { deferContext() {}, concludeTurn() {}, agent: { session: { header: { cwd, delegationDepth: 0 } } } }
}

function makeCtx() {
  const registered = []
  return { registered, tools: { register: (def) => { registered.push(def); return () => {} } } }
}

/** 只读解析按要求返回 undefined（模拟读路径在外层已注册根停住：该根没有 .wiki）。 */
function makeProvider(records, readonlyHit) {
  const ensured = []
  const provider = {
    current: () => new VaultStore(process.cwd()),
    currentReadonly: () => new VaultStore(process.cwd()),
    currentRecord: () => ({ id: 'v-current', name: 'current', root: process.cwd(), source: 'cwd' }),
    listVaults: () => records,
    readonlyVaultForRoot: () => readonlyHit,
    ensureVaultAt: (root) => {
      ensured.push(root)
      const store = new VaultStore(root)
      store.ensure()
      return store
    },
  }
  return { provider, ensured }
}

async function initAt(cwd, records, readonlyHit) {
  const { provider, ensured } = makeProvider(records, readonlyHit)
  const ctx = makeCtx()
  mountTools(ctx, provider)
  const init = ctx.registered.find((d) => d.name === 'wiki_init')
  return { res: await init.execute({}, execWithCwd(cwd)), ensured }
}

test('P0：cwd 种子祖先不得劫持 init 落点（落 cwd 自身，不在 home 建库）', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'knj-wsroot-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const home = join(dir, 'home') // 进程 cwd：被无条件登记，但没有 .wiki
  const fresh = join(home, 'fresh-project')
  mkdirSync(fresh, { recursive: true })

  const { provider, ensured } = makeProvider(
    [{ id: 'v-home', name: 'home', root: home, source: 'cwd', pageCount: 0, initialized: false }],
    undefined,
  )
  const ctx = makeCtx()
  mountTools(ctx, provider)
  const init = ctx.registered.find((d) => d.name === 'wiki_init')

  const res = await init.execute({}, execWithCwd(fresh))
  assert.equal(res.root, fresh, 'init 必须落在新工作目录，而不是被 cwd 种子祖先劫持')
  assert.deepEqual(ensured, [fresh], 'ensureVaultAt 只应收到 cwd 自身')
  assert.equal(existsSync(join(fresh, '.wiki')), true, '新目录应建库')
  assert.equal(existsSync(join(home, '.wiki')), false, 'home（cwd 种子）不得被建库')
})

test('P0：真实 workspace 祖先仍生效（init 落在最深 workspace 根）', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'knj-wsroot-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const home = join(dir, 'home')
  const workspace = join(home, 'proj-a')
  const deep = join(workspace, 'src', 'deep')
  mkdirSync(deep, { recursive: true })

  const { provider, ensured } = makeProvider(
    [
      { id: 'v-home', name: 'home', root: home, source: 'cwd', pageCount: 0, initialized: false },
      { id: 'v-proj', name: 'proj-a', root: workspace, source: 'workspace', pageCount: 0, initialized: false },
    ],
    undefined,
  )
  const ctx = makeCtx()
  mountTools(ctx, provider)
  const init = ctx.registered.find((d) => d.name === 'wiki_init')

  const res = await init.execute({}, execWithCwd(deep))
  assert.equal(res.root, workspace, 'workspace 祖先仍是合法的 init 落点')
  assert.deepEqual(ensured, [workspace])
  assert.equal(existsSync(join(workspace, '.wiki')), true)
  assert.equal(existsSync(join(home, '.wiki')), false, 'cwd 种子祖先依旧不得被建库')
})

test('P0：没有任何注册根时 init 落 cwd 自身', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'knj-wsroot-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const cwd = join(dir, 'lonely')
  mkdirSync(cwd, { recursive: true })
  const { res, ensured } = await initAt(cwd, [], undefined)
  assert.equal(res.root, cwd)
  assert.deepEqual(ensured, [cwd])
})

test('P0：已初始化时早退幂等——走 readonly 库，不调用 ensureVaultAt 重建', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'knj-wsroot-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const cwd = join(dir, 'proj-a')
  mkdirSync(cwd, { recursive: true })
  const existing = new VaultStore(cwd)
  existing.ensure()

  const { provider } = makeProvider(
    [{ id: 'v-proj', name: 'proj-a', root: cwd, source: 'workspace', pageCount: 0, initialized: true }],
    { store: existing, name: 'proj-a' },
  )
  const ctx = makeCtx()
  mountTools(ctx, provider)
  const init = ctx.registered.find((d) => d.name === 'wiki_init')

  const res = await init.execute({}, execWithCwd(cwd))
  assert.equal(res.root, cwd)
  assert.equal(res.created, false, '已存在库必须报 created=false')
  assert.equal(res.pageCount, 0)
})
