/**
 * wiki_init 的落点契约（P1-2，2026-11-05 评审）。
 *
 * 为什么钉这条：`readonlyVaultForRoot` 明确**排除主库根**（vault-manager.ts:309，
 * 主库根不是「工作区的库」），而 `wiki_init` 的落点用 `listVaults()`（**含主库**）
 * 算最深已注册祖先 —— 两个口径相反。于是会话 cwd 在 `~/.dsh` 之下（且没有更近的
 * 已注册工作区）时，init 把库落在主库根、回执说「已存在（幂等）N 页」，
 * 而此后每一次读取都报「本工作区没有知识库」= 死循环。
 *
 * 另有一条同一族的边界漏洞：`knownRoots()` 把主库根**排除在边界之外**，于是
 * 主库根还没有 `.wiki` 时，向上查找会越过它、命中更外层的遗留库（本机真实存在
 * `C:\Users\MrYang\.wiki`）。
 *
 * 契约（不绑定具体修法）：init 要么抛错说明不能落，要么落在一个**同一 cwd 随后
 * 能解析到**的位置。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { VaultManager } from './lib/vault-manager.js'
import { mountTools } from './lib/tools.js'

// wiki_init 的同族工具会碰语义索引/未命中日志：隔离到临时 home，不碰用户真实状态。
process.env.KNJ_OBSIDIAN_AUTO_REFRESH = 'off'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'knj-init-home-'))

function setup(t, { initMain = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'knj-init-target-'))
  const mainRoot = join(dir, 'mainroot')
  const projRoot = join(dir, 'proj')
  mkdirSync(mainRoot, { recursive: true })
  mkdirSync(projRoot, { recursive: true })
  // 模拟「主库已初始化」：真实机器上 ~/.dsh/.wiki 是存在的，边界行为取决于这个事实。
  if (initMain) mkdirSync(join(mainRoot, '.wiki', 'concepts'), { recursive: true })
  const manager = new VaultManager({
    registryFile: join(dir, 'vaults.json'),
    cwdRoot: projRoot,
    workspaceRoots: [],
    mainRoot,
    subVaults: true,
  })
  manager.ensureVaultAt(projRoot) // proj 是已初始化的子库（对照组）
  const tools = []
  mountTools({ tools: { register: (def) => tools.push(def) } }, manager)
  const init = tools.find((def) => def.name === 'wiki_init')
  assert.ok(init, 'mountTools 应注册 wiki_init')
  const run = async (cwd) => {
    try {
      return { out: await init.execute({}, { agent: { session: { header: { cwd } } } }) }
    } catch (err) {
      return { err }
    }
  }
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, mainRoot, projRoot, manager, run, tools }
}

test('cwd 在主库根之下：init 不得落在主库根（否则回执说已存在、读取永远说没有）', async (t) => {
  const s = setup(t)
  const cwd = join(s.mainRoot, 'skills', 'alpha')
  mkdirSync(cwd, { recursive: true })
  const { out, err } = await s.run(cwd)
  if (err) {
    assert.match(String(err.message), /主库/, '拒绝时必须说明是主库根的问题，不能只说"没有库"')
    return
  }
  assert.notEqual(resolve(out.root), resolve(s.mainRoot), '不得把工作区库初始化到主库根')
  const hit = s.manager.readonlyVaultForRoot(cwd)
  assert.ok(
    hit,
    `wiki_init 返回了${out.created ? '「已初始化」' : '「已存在」'}（落点 ${out.root}），但同一 cwd 解析不到库：落点与读取口径相反`,
  )
  assert.equal(resolve(hit.store.wikiRoot, '..'), resolve(out.root), 'init 落点必须等于读路径解析出的库根')
})

test('cwd 就是主库根：同样不得静默落在主库根', async (t) => {
  const s = setup(t)
  const { out, err } = await s.run(s.mainRoot)
  if (err) {
    assert.match(String(err.message), /主库/, '拒绝时必须说明是主库根的问题')
    return
  }
  assert.notEqual(resolve(out.root), resolve(s.mainRoot), '主库根不是工作区库，init 不得落在它上面')
  assert.ok(s.manager.readonlyVaultForRoot(s.mainRoot), '若 init 声称成功，同一 cwd 必须能解析到库')
})

test('主库根没有 .wiki 时也必须挡住向上查找（不得绑到更外层的遗留库）', (t) => {
  const s = setup(t, { initMain: false })
  // 外层有一个遗留库（本机真实形态：C:\Users\<user>\.wiki）
  mkdirSync(join(s.dir, '.wiki', 'concepts'), { recursive: true })
  const cwd = join(s.mainRoot, 'skills', 'beta')
  mkdirSync(cwd, { recursive: true })
  assert.equal(
    s.manager.readonlyVaultForRoot(cwd),
    undefined,
    '主库根不是工作区库，但它必须是查找边界：否则会静默绑到更外层的遗留库',
  )
  assert.equal(s.manager.readonlyVaultForRoot(s.mainRoot), undefined, '主库根本身也不得作为工作区库被解析')
})

test('主库根已初始化、外层还有已注册工作区的库：不得越过主库根去绑外层', async (t) => {
  // 本机真实形状：`~` 是已注册工作区的库（含历史遗留 ~/.wiki），主库是 `~/.dsh/.wiki`，
  // 会话 cwd 在 `~/.dsh/skills/*`。读路径遇到主库根就停（返回 undefined），
  // 所以 init 也不能越过它落到 `~`，否则「回执说已存在 8 页、查询永远说没有库」。
  const dir = mkdtempSync(join(tmpdir(), 'knj-init-outer-'))
  const home = join(dir, 'home')
  const mainRoot = join(home, '.dsh')
  const cwd = join(mainRoot, 'skills', 'gamma')
  mkdirSync(join(mainRoot, '.wiki', 'concepts'), { recursive: true })
  mkdirSync(join(home, '.wiki', 'concepts'), { recursive: true })
  mkdirSync(join(mainRoot, 'profiles', 'web'), { recursive: true })
  mkdirSync(cwd, { recursive: true })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const manager = new VaultManager({
    registryFile: join(dir, 'vaults.json'),
    cwdRoot: join(mainRoot, 'profiles', 'web'),
    workspaceRoots: () => [{ path: home }],
    mainRoot,
    subVaults: true,
  })
  assert.equal(manager.readonlyVaultForRoot(cwd), undefined, '前提：读路径在主库根处停住，本工作区没有库')

  const tools = []
  mountTools({ tools: { register: (def) => tools.push(def) } }, manager)
  const init = tools.find((def) => def.name === 'wiki_init')
  let out
  try {
    out = await init.execute({}, { agent: { session: { header: { cwd } } } })
  } catch (err) {
    assert.match(String(err.message), /主库/, '拒绝时必须说明是主库根的问题')
    return
  }
  assert.notEqual(resolve(out.root), resolve(home), '不得越过主库根绑到家目录那个库')
  assert.equal(resolve(out.root), resolve(cwd), '应落在 cwd 自己（唯一能被同一 cwd 读到的位置）')
  const hit = manager.readonlyVaultForRoot(cwd)
  assert.ok(hit, 'init 声称成功后，同一 cwd 必须能解析到库')
  assert.equal(resolve(hit.store.wikiRoot, '..'), resolve(cwd))
})

test('已注册工作区的子目录：仍落在工作区根，且立即可读（回归保护）', async (t) => {
  const s = setup(t)
  const cwd = join(s.projRoot, 'src')
  mkdirSync(cwd, { recursive: true })
  const { out, err } = await s.run(cwd)
  assert.ok(!err, `子目录场景不应失败：${err?.message ?? ''}`)
  assert.equal(resolve(out.root), resolve(s.projRoot), '会话 cwd 是工作区子目录时，库应建在工作区根')
  assert.ok(existsSync(join(s.projRoot, '.wiki')))
  const hit = s.manager.readonlyVaultForRoot(cwd)
  assert.ok(hit, '工作区子目录应能向上解析到工作区库')
  assert.equal(resolve(hit.store.wikiRoot, '..'), resolve(s.projRoot))
})
