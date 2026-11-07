// cwd-seed-boundary.test.mjs — 启动目录（cwd）只作「向上找库」的边界，不再登记成知识库。
// 背景：2026-11 实测在家目录 / DSH 安装目录启动 dsh，会在下拉框里攒出一条 0 页、
// 未初始化的 source:'cwd' 记录（幽灵库），而它本该只是读路径的停止位。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { VaultManager } from './lib/vault-manager.js'

function setup(t, workspaceNames = []) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-cwdseed-'))
  const reg = join(dir, 'registry', 'vaults.json')
  const cwd = join(dir, 'cwd-project')
  mkdirSync(cwd, { recursive: true })
  const ws = workspaceNames.map((n) => ({ path: join(dir, n) }))
  for (const w of ws) mkdirSync(w.path, { recursive: true })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, reg, cwd, ws }
}

function writeRegistry(reg, vaults, currentVaultId) {
  mkdirSync(join(reg, '..'), { recursive: true })
  writeFileSync(reg, JSON.stringify({ version: 1, currentVaultId, vaults, removedRoots: [] }, null, 2), 'utf8')
}

function makeManager(opts) {
  return new VaultManager({ registryFile: opts.reg, cwdRoot: opts.cwd, workspaceRoots: opts.ws ?? [] })
}

test('seed：启动目录不再登记成库，当前库落到真实工作区库', (t) => {
  const s = setup(t, ['proj-a'])
  const m = makeManager(s)
  const vaults = m.listVaults()

  assert.equal(vaults.some((v) => resolve(v.root) === resolve(s.cwd)), false, 'cwd 根不应出现在库列表里')
  assert.ok(vaults.some((v) => resolve(v.root) === resolve(s.ws[0].path)), '工作区库应进列表')
  const cur = m.currentRecord()
  assert.ok(cur, '应仍有当前库')
  assert.equal(cur.root, s.ws[0].path, '当前库应落到真实 workspace 上')
})

test('seed：把无 .wiki 的遗留 cwd 记录清掉（并落盘）', (t) => {
  const s = setup(t, ['proj-a'])
  writeRegistry(s.reg, [
    { id: 'v-legacy-cwd', name: 'ghost', root: s.cwd, source: 'cwd' },
    { id: 'v-proj-a', name: 'proj-a', root: s.ws[0].path, source: 'workspace' },
  ], 'v-legacy-cwd')

  const m = makeManager(s)
  const vaults = m.listVaults()
  assert.equal(vaults.length, 1, '空壳 cwd 记录应被清掉')
  assert.equal(vaults[0].root, s.ws[0].path)
  assert.equal(m.currentRecord().root, s.ws[0].path, '当前库不能停在被清掉的记录上')

  const onDisk = JSON.parse(readFileSync(s.reg, 'utf8'))
  assert.equal(onDisk.vaults.some((v) => resolve(v.root) === resolve(s.cwd)), false, '清理结果应落盘')
})

test('seed：已初始化的 cwd 记录保留（那是用户真用过的库）', (t) => {
  const s = setup(t)
  mkdirSync(join(s.cwd, '.wiki'), { recursive: true })
  writeRegistry(s.reg, [{ id: 'v-real-cwd', name: 'cwd-project', root: s.cwd, source: 'cwd' }], 'v-real-cwd')

  const m = makeManager(s)
  assert.equal(m.listVaults().length, 1, '有 .wiki 的 cwd 记录不能被误删')
  assert.equal(m.currentRecord().root, s.cwd)
})

test('current()：一条库都没有时不隐式 scaffold —— 读路径不得写盘', (t) => {
  const s = setup(t)
  const m = makeManager(s)

  assert.equal(existsSync(join(s.cwd, '.wiki')), false, '夹具前提：还没有 .wiki')
  const store = m.current()
  assert.equal(store.wikiRoot, join(s.cwd, '.wiki'), '仍应返回一个可用 store（库根为启动目录）')
  assert.equal(existsSync(join(s.cwd, '.wiki')), false, 'current() 不应凭空建库')
})

test('cwd 仍是读路径边界：向上找库不得越过启动目录', (t) => {
  const s = setup(t)
  mkdirSync(join(s.dir, '.wiki', 'concepts'), { recursive: true })

  const m = makeManager(s)
  const sub = join(s.cwd, 'sub')
  mkdirSync(sub, { recursive: true })

  assert.equal(m.readonlyVaultForRoot(sub), undefined, '不得越过 cwd 去绑定外层那个库（越界 bug 的回归）')
})
