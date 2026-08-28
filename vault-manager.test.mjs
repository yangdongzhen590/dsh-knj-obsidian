// vault-manager.test.mjs — v7 多 vault 注册表测试（先红后绿）。
// 覆盖：种子（cwd + 工作区）、切换、按目录激活、新建/挂接、移除（仅 attached、不动磁盘）、
// 注册表损坏重建、持久化重启保持。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultManager } from './lib/vault-manager.js'

function setup(t, workspaceNames = []) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-vmgr-'))
  const reg = join(dir, 'registry', 'vaults.json')
  const cwd = join(dir, 'cwd-project')
  mkdirSync(cwd, { recursive: true })
  const ws = workspaceNames.map((n) => ({ path: join(dir, n) }))
  for (const w of ws) mkdirSync(w.path, { recursive: true })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, reg, cwd, ws }
}

function makeManager(opts) {
  return new VaultManager({
    registryFile: opts.reg,
    cwdRoot: opts.cwd,
    workspaceRoots: opts.ws ?? [],
  })
}

test('seed：cwd 与工作区库自动进列表，当前默认 cwd 库', (t) => {
  const s = setup(t, ['proj-a', 'proj-b'])
  const m = makeManager(s)
  const vaults = m.listVaults()
  assert.equal(vaults.length, 3)
  const cur = m.currentRecord()
  assert.equal(cur.root, s.cwd)
  assert.ok(vaults.some((v) => v.root === join(s.dir, 'proj-a') && v.source === 'workspace'))
  assert.ok(vaults.some((v) => v.root === join(s.dir, 'proj-b') && v.source === 'workspace'))
  assert.ok(vaults.some((v) => v.root === s.cwd && v.source === 'cwd'))
})

test('seed：目录已消失的工作区不展示（无幽灵库）', (t) => {
  const s = setup(t)
  const ghost = { path: join(s.dir, 'gone') } // 目录不存在
  const m = makeManager({ ...s, ws: [ghost] })
  assert.equal(m.listVaults().length, 1)
  assert.equal(m.listVaults()[0].root, s.cwd)
})

test('切换库后 current() 落到目标库，页面读的是新库', (t) => {
  const s = setup(t, ['proj-a'])
  const m = makeManager(s)
  const target = m.listVaults().find((v) => v.source === 'workspace')
  const rec = m.switchVault(target.id)
  assert.equal(rec.id, target.id)
  assert.equal(m.currentRecord().root, target.root)
  // current() 返回的 store 以目标库为根
  assert.equal(m.current().wikiRoot, join(target.root, '.wiki'))
})

test('activateRoot：已注册目录只切换；未注册目录自动挂接并脚手架 .wiki', (t) => {
  const s = setup(t, ['proj-a'])
  const m = makeManager(s)
  const rec = m.activateRoot(join(s.dir, 'proj-a'))
  assert.equal(rec.source, 'workspace')
  assert.equal(m.currentRecord().id, rec.id)
  // 未注册的新目录：自动挂接（source=attached）+ .wiki 脚手架
  const fresh = join(s.dir, 'brand-new')
  const rec2 = m.activateRoot(fresh)
  assert.equal(rec2.source, 'attached')
  assert.ok(existsSync(join(fresh, '.wiki', 'index.md')), '应脚手架 index.md')
  assert.equal(m.currentRecord().id, rec2.id)
})

test('attachRoot：目录不存在自动创建；同根幂等返回同一 id', (t) => {
  const s = setup(t)
  const m = makeManager(s)
  const a = join(s.dir, 'attach-a')
  const r1 = m.attachRoot(a, '我的知识库')
  assert.equal(r1.name, '我的知识库')
  assert.ok(existsSync(a), '目录应被创建')
  assert.ok(existsSync(join(a, '.wiki', 'index.md')))
  const r2 = m.attachRoot(a, '改名')
  assert.equal(r2.id, r1.id, '同根应幂等')
  assert.equal(r2.name, '改名')
  assert.equal(m.listVaults().filter((v) => v.root === a).length, 1)
})

test('removeVault：仅 attached 可移除；工作区/cwd 库拒绝；磁盘文件保留', (t) => {
  const s = setup(t, ['proj-a'])
  const m = makeManager(s)
  const wsVault = m.listVaults().find((v) => v.source === 'workspace')
  assert.equal(m.removeVault(wsVault.id), false, 'workspace 库不可移除')
  const attached = m.attachRoot(join(s.dir, 'remove-me'))
  m.switchVault(attached.id)
  assert.equal(m.removeVault(attached.id), true)
  assert.ok(existsSync(join(s.dir, 'remove-me', '.wiki')), '移除注册不删磁盘')
  assert.notEqual(m.currentRecord().id, attached.id, '移除当前库后应落到其余库')
})

test('注册表损坏：从空重建不崩，cwd 种子仍在', (t) => {
  const s = setup(t)
  mkdirSync(join(s.reg, '..'), { recursive: true })
  writeFileSync(s.reg, '{ broken json', 'utf8')
  const m = makeManager(s)
  assert.equal(m.listVaults().length, 1)
  assert.equal(m.listVaults()[0].root, s.cwd)
})

test('持久化：重建 manager 后列表与当前库保持', (t) => {
  const s = setup(t, ['proj-a'])
  const m1 = makeManager(s)
  const attached = m1.attachRoot(join(s.dir, 'persist-me'))
  m1.switchVault(attached.id)
  const m2 = makeManager(s)
  assert.equal(m2.currentRecord().id, attached.id, 'current 应持久化')
  assert.ok(m2.listVaults().some((v) => v.root === join(s.dir, 'persist-me') && v.source === 'attached'))
  assert.ok(m2.listVaults().some((v) => v.root === join(s.dir, 'proj-a') && v.source === 'workspace'))
})

test('listVaults 附带 pageCount（只读，不写盘）', (t) => {
  const s = setup(t)
  const m = makeManager(s)
  m.current().ensure() // 先脚手架 cwd 库，确保 manifest 存在
  const before = readFileSync(join(s.cwd, '.wiki', '.manifest.json'), 'utf8')
  const entry = m.listVaults()[0]
  assert.equal(typeof entry.pageCount, 'number')
  assert.equal(entry.pageCount, 0)
  const after = readFileSync(join(s.cwd, '.wiki', '.manifest.json'), 'utf8')
  assert.equal(before, after, 'listVaults 不应改动磁盘')
})
