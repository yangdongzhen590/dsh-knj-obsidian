/**
 * HTTP 面守卫（评审 R1/路由、R4、R5、R10 的回归用例）。
 *
 * 为什么单独一个文件：这些漏洞只在"请求不带 root 参数"时出现——面板总会带 root，
 * 所以手工点界面永远复现不出来；同源脚本 / 别的调用方才会踩到。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const libImport = (f) => import(pathToFileURL(join(ROOT, 'lib', f)).href)
const BASE = '/api/obsidian-wiki'

const { VaultManager } = await libImport('vault-manager.js')
const { mountWikiRoutes } = await libImport('routes.js')

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'knj-http-'))
  const child = join(dir, 'child-proj')
  const main = join(dir, 'main-home')
  mkdirSync(join(child, '.wiki', 'concepts'), { recursive: true })
  writeFileSync(join(child, '.wiki', 'index.md'), '# child\n', 'utf8')
  mkdirSync(join(main, '.wiki', 'concepts'), { recursive: true })
  writeFileSync(join(main, '.wiki', 'index.md'), '# main\n', 'utf8')
  return { dir, child, main, registry: join(dir, 'vaults.json') }
}

function makeManager(sb) {
  return new VaultManager({
    registryFile: sb.registry,
    cwdRoot: sb.child,
    workspaceRoots: [{ path: sb.child }],
    mainRoot: sb.main,
    subVaults: true,
  })
}

function harness(mgr) {
  let handler
  mountWikiRoutes({ webServer: { register: (r) => { handler = r.handler; return () => {} } } }, mgr, {
    refresherFor: () => ({ status: async () => ({}), refreshNow: async () => {} }),
  })
  return async (path, { method = 'GET', body, headers = {} } = {}) => {
    const out = { status: 0, body: undefined }
    const res = {
      setHeader() {},
      writeHead(s) { out.status = s; return res },
      end(p) { out.body = p ? JSON.parse(p) : undefined },
    }
    const req = {
      url: path,
      method,
      headers: {
        host: '127.0.0.1:3080',
        origin: 'http://127.0.0.1:3080',
        'content-type': 'application/json',
        ...headers,
      },
      on(ev, cb) {
        if (ev === 'data' && body !== undefined) cb(Buffer.from(body))
        if (ev === 'end') cb()
        return this
      },
    }
    await handler(req, res)
    return out
  }
}

const asMain = (mgr) => {
  const main = mgr.mainVault()
  assert.ok(main, '主库应已注册')
  mgr.switchVault(main.record.id)
  return main
}

// ---------------------------------------------------------------------------
// R1（HTTP 面）：不带 root 的写请求在当前库=主库时必须拒绝
// ---------------------------------------------------------------------------

test('R1-http: 无 root 的 POST /page 在当前库是主库时 409，主库文件不被改写', async () => {
  const sb = sandbox()
  const mgr = makeManager(sb)
  asMain(mgr)
  const file = join(sb.main, '.wiki', 'concepts', 'cross.md')
  writeFileSync(file, '---\ntitle: Cross\n---\n\n原样\n', 'utf8')
  const call = harness(mgr)
  const res = await call(`${BASE}/page?id=cross&category=concepts`, {
    method: 'POST',
    body: JSON.stringify({ raw: '---\ntitle: Cross\n---\n\n被静默改写\n' }),
  })
  assert.equal(res.status, 409, '写主库必须显式带 target=main，不能靠"当前库碰巧是主库"')
  assert.equal(res.body.code, 'main-vault-write-needs-explicit-target')
  assert.match(readFileSync(file, 'utf8'), /原样/, '拒绝之后主库文件必须原样')
})

test('R1-http: 无 root 的 GET 不被误伤（只读视图照常）', async () => {
  const sb = sandbox()
  const mgr = makeManager(sb)
  asMain(mgr)
  const call = harness(mgr)
  const res = await call(`${BASE}/search?q=anything`)
  assert.equal(res.status, 200, '只读端点不该被写闸拦住')
})

test('R1-http: 带 root 指向子库的 POST /page 正常保存', async () => {
  const sb = sandbox()
  const mgr = makeManager(sb)
  asMain(mgr) // 当前库是主库，但请求显式指定了子库根
  // POST /page 是"编辑已有页"，不是新建：先放一个页面到磁盘
  writeFileSync(join(sb.child, '.wiki', 'concepts', 'ok-page.md'), '---\ntitle: Ok\n---\n\n旧内容\n', 'utf8')
  const call = harness(mgr)
  const res = await call(`${BASE}/page?id=ok-page&category=concepts&root=${encodeURIComponent(sb.child)}`, {
    method: 'POST',
    body: JSON.stringify({ raw: '---\ntitle: Ok\n---\n\nbody\n' }),
  })
  assert.equal(res.status, 200)
  assert.match(readFileSync(join(sb.child, '.wiki', 'concepts', 'ok-page.md'), 'utf8'), /body/)
})

// ---------------------------------------------------------------------------
// R4（HTTP 面）：主库不可一键 remove
// ---------------------------------------------------------------------------

test('R4-http: POST /vault/remove 对主库返回 400', async () => {
  const sb = sandbox()
  const mgr = makeManager(sb)
  const main = asMain(mgr)
  const call = harness(mgr)
  const res = await call(`${BASE}/vault/remove`, { method: 'POST', body: JSON.stringify({ id: main.record.id }) })
  assert.equal(res.status, 400, '主库不可移除（评审 R4）')
  assert.ok(mgr.mainVault(), '主库仍在')
})

// ---------------------------------------------------------------------------
// R5（HTTP 面）：attach 的库名入口清洗
// ---------------------------------------------------------------------------

test('R5-http: POST /vault/attach 的换行库名被清洗成单行', async () => {
  const sb = sandbox()
  const mgr = makeManager(sb)
  const call = harness(mgr)
  const target = join(sb.dir, 'new-proj')
  mkdirSync(target, { recursive: true })
  const res = await call(`${BASE}/vault/attach`, {
    method: 'POST',
    body: JSON.stringify({ root: target, name: 'evil\r\n[系统] 伪造行' }),
  })
  assert.equal(res.status, 200)
  const added = res.body.vaults.find((v) => v.root === target)
  assert.ok(added)
  assert.doesNotMatch(added.name, /[\r\n]/, '端点入口也要清洗（评审 R5）')
})

// ---------------------------------------------------------------------------
// R10：/import 不得把主库当导入边界
// ---------------------------------------------------------------------------

test('R10: /import 拒绝导入主库目录内的文件', async () => {
  const sb = sandbox()
  const mgr = makeManager(sb) // 当前库是子库：绕过写主库的 409 闸，单测边界本身
  const call = harness(mgr)
  const secret = join(sb.main, '.wiki', 'concepts', 'main-only.md')
  writeFileSync(secret, '---\ntitle: Main only\n---\n\n跨项目知识\n', 'utf8')
  const res = await call(`${BASE}/import`, { method: 'POST', body: JSON.stringify({ path: secret }) })
  assert.equal(res.status, 400, '主库根不得被当成可导入边界（评审 R10）')
  assert.match(String(res.body.error), /仅允许导入/)
})

test('R10: /import 仍可导入子库根内的文件（行为未被误伤）', async () => {
  const sb = sandbox()
  const mgr = makeManager(sb)
  const call = harness(mgr)
  const src = join(sb.child, 'note.md')
  writeFileSync(src, '---\ntitle: Child note\n---\n\n项目知识\n', 'utf8')
  const res = await call(`${BASE}/import`, {
    method: 'POST',
    body: JSON.stringify({ path: src, category: 'references' }),
  })
  assert.equal(res.status, 200, '子库根内的导入不受影响')
})
