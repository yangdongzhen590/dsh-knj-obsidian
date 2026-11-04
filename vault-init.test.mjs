// vault-init.test.mjs — 工作区无知识库时的初始化能力（先红后绿）
// 覆盖：wiki_init 工具幂等建库、activate（自动跟随）不再静默建库、attach（显式挂接）仍建库、
// GET /vaults 暴露 initialized、以及客户端初始化入口契约。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { VaultStore } from './lib/vault-store.js'
import { VaultManager } from './lib/vault-manager.js'
import { mountTools } from './lib/tools.js'
import { mountWikiRoutes } from './lib/routes.js'

const EXEC = { deferContext() {}, concludeTurn() {} }

function makeStore(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-vault-init-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, store: new VaultStore(dir) }
}

function makeManager(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-vault-init-mgr-'))
  const reg = join(dir, 'registry', 'vaults.json')
  const cwd = join(dir, 'cwd')
  const wsDir = join(dir, 'workspace-x')
  mkdirSync(cwd, { recursive: true })
  mkdirSync(wsDir, { recursive: true })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const manager = new VaultManager({ registryFile: reg, cwdRoot: cwd, workspaceRoots: [] })
  return { dir, reg, cwd, wsDir, manager }
}

test('wiki_init 工具：未初始化库执行后建出 .wiki 脚手架并幂等', async (t) => {
  const { dir, store } = makeStore(t)
  assert.equal(existsSync(join(dir, '.wiki')), false, '前置：库尚未初始化')
  const registered = []
  mountTools({ tools: { register: (def) => registered.push(def) } }, store)
  const def = registered.find((d) => d.name === 'wiki_init')
  assert.ok(def, '应注册 wiki_init 工具')

  const first = await def.execute({}, EXEC)
  assert.equal(first.created, true)
  assert.equal(first.pageCount, 0)
  assert.equal(first.root, dir)
  assert.ok(existsSync(join(dir, '.wiki', 'index.md')))
  assert.ok(existsSync(join(dir, '.wiki', '.manifest.json')))
  for (const c of ['concepts', 'entities', 'references', 'synthesis', 'projects', 'dictionaries', 'tables']) {
    assert.ok(existsSync(join(dir, '.wiki', c)), `分类目录应存在：${c}`)
  }

  const second = await def.execute({}, EXEC)
  assert.equal(second.created, false, '重复初始化为幂等')
})

test('activate（自动跟随）：未注册目录只注册与切换，不静默建 .wiki', (t) => {
  const { wsDir, manager } = makeManager(t)

  const rec = manager.activateRoot(wsDir)

  assert.equal(rec.root, wsDir)
  assert.equal(manager.currentRecord().root, wsDir, '应切为当前库')
  assert.ok(manager.listVaults().some((v) => v.root === wsDir), '应登记进库列表')
  assert.equal(existsSync(join(wsDir, '.wiki')), false, 'activate 不得静默写盘建库')
  assert.equal(manager.listVaults().find((v) => v.root === wsDir).initialized, false)
})

test('attach（显式挂接）：仍创建 .wiki；列表 initialized 反映磁盘状态', (t) => {
  const { wsDir, manager } = makeManager(t)

  manager.attachRoot(wsDir, '显式库')

  assert.equal(existsSync(join(wsDir, '.wiki')), true, '显式挂接应建库')
  assert.equal(manager.listVaults().find((v) => v.root === wsDir).initialized, true)
})

test('GET /vaults 暴露 initialized（未初始化库标 false）', async (t) => {
  const { cwd, wsDir, manager } = makeManager(t)
  const handlers = new Map()
  const host = { webServer: { register: (route) => { handlers.set(`${route.kind}:${route.path}`, route); return () => handlers.delete(`${route.kind}:${route.path}`) } } }
  mountWikiRoutes(host, manager)
  const route = handlers.get('prefix:/api/obsidian-wiki')
  assert.ok(route)
  const url = new URL('http://localhost/api/obsidian-wiki/vaults')
  const request = { url: url.pathname, method: 'GET', headers: {} }
  let out = ''
  await route.handler(request, { setHeader: () => {}, writeHead: () => {}, end: (c) => { out += c ?? '' } })
  const body = JSON.parse(out)
  const entry = body.vaults.find((v) => v.root === wsDir) ?? body.vaults.find((v) => v.root === cwd)
  assert.ok(entry, '库列表应含临时库')
  assert.equal(typeof entry.initialized, 'boolean', 'vaults 条目应带 initialized')
  assert.equal(entry.initialized, false, 'cwd 库尚无 .wiki，应标未初始化')

  manager.attachRoot(wsDir, '显式库')
  out = ''
  await route.handler(request, { setHeader: () => {}, writeHead: () => {}, end: (c) => { out += c ?? '' } })
  assert.equal(JSON.parse(out).vaults.find((v) => v.root === wsDir).initialized, true)
})

test('客户端：初始化入口走新建会话并引用 wiki_init', () => {
  const client = join(import.meta.dirname, 'src', 'client')
  const headers = readFileSync(join(client, 'VaultHeader.tsx'), 'utf8')
  const launcher = readFileSync(join(client, 'KnowledgeDistillLauncher.tsx'), 'utf8')
  assert.match(headers, /初始化知识库/)
  assert.match(headers, /wiki_init/)
  assert.match(headers, /startAgentSession/, '初始化应新建会话交给 Agent')
  assert.match(headers, /已新建会话/, '提示语应说明新建了会话')
  assert.match(launcher, /初始化知识库/)
  assert.match(launcher, /wiki_init/)
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, 'package.json'), 'utf8'))
  assert.ok(pkg.files.includes('wiki-init'), 'package.json 白名单应随包分发 wiki-init skill')
})
