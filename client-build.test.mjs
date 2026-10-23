// client-build.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath（而非 URL.pathname + join）：Windows 上 pathname 形如 /D:/…，
// join 后产生 \\D:\…，fs 会解析成不存在的 D:\D:\…（见 smoke.test.mjs 同款约定）
const ROOT = fileURLToPath(new URL('.', import.meta.url))

/**
 * 0.2 已移除的客户端 API 符号：产物里只要残留就意味着宿主上什么都不会出现。
 *
 * 为什么必须查**产物**而不只是源码（2026-10-24 实测）：`2026.10.211` 那种发布包的源码
 * 可能已经改对，但 `client/client.js` 仍是旧构建——只 grep 源码的断言全绿，装到 0.2 宿主
 * 却一个页签都没有。断言必须落在真正被加载的那个文件上。
 */
const LEGACY_CLIENT_SYMBOLS = ['registerTab', 'betterSidebar']

function assertNoLegacyClientApi(text, label) {
  for (const symbol of LEGACY_CLIENT_SYMBOLS) {
    assert.ok(
      !text.includes(symbol),
      `${label} 仍含 0.2 已移除的符号 "${symbol}"（better-sidebar 的旧 API）：请 npm run build:client 重建产物`,
    )
  }
}


test('client 构建产物存在且为 ModuleLoader 工厂', () => {
  const client = join(ROOT, 'client/client.js')
  assert.ok(existsSync(client), 'client/client.js 应存在（先 npm run build:client）')
  const text = readFileSync(client, 'utf8')
  assert.ok(text.includes('__ModuleLoader__'), '应含 ModuleLoader 工厂')
})

test('package.json 声明 client 入口与构建脚本', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.dsh.client.platform, 'web')
  // 0.2 迁移后不再依赖 dsh-better-sidebar：客户端的宿主依赖改为在 src/client/index.ts
  // 里用 `export const inject` 按**服务名**声明（slots / sidebarRightTabs 由
  // @deepseek-ai/dsh-client-ui-sidebar-right 提供）。包级 inject 保持空数组，
  // 避免出现指向已卸载插件的悬空引用。
  assert.ok(!pkg.dsh.client.inject.includes('betterSidebar'), '不应再引用已卸载的 betterSidebar 服务')
  const src = readFileSync(join(ROOT, 'src/client/index.ts'), 'utf8')
  assert.match(src, /export const inject = \['slots', 'sidebarRightTabs', 'sidebarRight'\]/, '硬依赖须按服务名声明')
  assert.equal(pkg.exports['./client'].default, './client/client.js')
  assert.ok(pkg.scripts['build:client'])
})

test('原生右侧栏契约：类型注册 + keyed 内容面板（不再使用 registerTab/component）', () => {
  // 0.2 的 ui-sidebar-right 分两段：静态面走 sidebarRightTabs.register（id/kind/title/guide），
  // 内容走 keyed seat `sidebar.right.pane.tab`（key = 类型定义的 id）。
  // better-sidebar 的 registerTab({component}) 已不存在，误用不会报错、只会什么都不显示。
  const src = readFileSync(join(ROOT, 'src/client/index.ts'), 'utf8')
  assert.match(src, /ctx\.sidebarRightTabs/, '须使用原生右侧栏类型注册表')
  assert.match(src, /\.register\(\{/, '须注册 tab 类型定义')
  assert.match(src, /slots\.inject\('sidebar\.right\.pane\.tab'/, '须在 keyed seat 上注册内容面板')
  assert.doesNotMatch(src, /registerTab/, '不应再使用 better-sidebar 的 registerTab')
  const bundle = readFileSync(join(ROOT, 'client/client.js'), 'utf8')
  assert.match(bundle, /sidebar\.right\.pane\.tab/, '构建产物必须携带原生 seat 名')
})

test('产物级护栏：client/client.js 不得残留 registerTab / betterSidebar', () => {
  const client = join(ROOT, 'client/client.js')
  assert.ok(existsSync(client), 'client/client.js 应存在（先 npm run build:client）')
  assertNoLegacyClientApi(readFileSync(client, 'utf8'), 'client/client.js')
})

test('护栏自检：含旧符号的伪造产物必须被判红（防止护栏本身假绿）', () => {
  // 这两条是"护栏能拦住 2026.10.211"的最小复现：同样的断言喂旧产物必须抛。
  assert.throws(() => assertNoLegacyClientApi('function registerTab(id, def) {}', 'fake'), /registerTab/)
  assert.throws(() => assertNoLegacyClientApi('const inject = ["betterSidebar"]', 'fake'), /betterSidebar/)
})
