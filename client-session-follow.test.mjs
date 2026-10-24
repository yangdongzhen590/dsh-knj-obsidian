/**
 * 面板跟随工作区：接线契约（源文本断言，与仓库既有客户端测试同风格）。
 *
 * 为什么钉这些字符串：0.2 的快照没有 `sessions.list.current` 与
 * `workspaces.recentWorkspaceId`，旧跟随逻辑因此永远拿到 undefined（表现为
 * 「切换工作区后仍是旧库」）。新契约是：seat 注入 sessionId + useSessions，
 * WikiSidebar 用 session-root 纯函数算出 root，再按 root 请求数据。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const CLIENT = join(ROOT, 'src/client')
const read = (f) => readFileSync(join(CLIENT, f), 'utf8')
/** 断言只看代码，不看注释（注释里会解释缺陷历史，提到旧字段名是合理的）。 */
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

test('VaultHeader 不再依赖 0.2 不存在的快照字段', () => {
  const text = code('VaultHeader.tsx')
  assert.ok(!text.includes('recentWorkspaceId'), 'workspaces 快照没有 recentWorkspaceId，不能作为跟随目标')
  assert.ok(!/getSnapshot\(\)\s*\??\.\s*current/.test(text), 'sessions 快照没有 current 字段')
  assert.ok(!text.includes('activatedRootRef'), '旧的 2s 轮询激活逻辑应已移除')
})

test('VaultHeader 由 root 驱动（不做全局 activate 跟随）', () => {
  const text = read('VaultHeader.tsx')
  assert.ok(/root\??:\s*string/.test(text), 'VaultHeader 应接收 root?: string')
  // effectiveRoot = 本面板覆盖 ?? 会话工作区根；库列表按它取（服务端回填 followedRoot/uninitialized）
  assert.ok(text.includes('overrideRoot ?? root'), 'root 应是跟随基线，覆盖只作用于本面板')
  assert.ok(text.includes('fetchVaults(effectiveRoot)'), '库列表应按 effectiveRoot 取')
})

test('WikiSidebar 用 session-root 纯函数算 root 并下传', () => {
  const text = read('WikiSidebar.tsx')
  assert.ok(text.includes('resolveSessionRoot('), '应使用 src/client/session-root.ts 的解析函数')
  assert.ok(text.includes('sessionId'), '应接收 seat 注入的 sessionId')
  assert.ok(text.includes('root={root}') || text.includes('root,'), '各视图应收到 root')
})

test('index.ts 从 pane-tab seat 取 sessionId/useSessions 并传给面板', () => {
  const text = read('index.ts')
  assert.ok(text.includes('useSessions'), '0.2 seat 提供 useSessions store hook')
  assert.ok(text.includes('sessionId'), '0.2 seat 提供 sessionId（按会话渲染）')
})

test('库下拉 value 必须能匹配到 option（否则浏览器回落显示第一个库 iobs_pro）', () => {
  const text = code('VaultHeader.tsx')
  assert.ok(text.includes('vaults.some((v) => v.id === current'), 'select 的 value 必须校验 current.id 存在于 vaults')
  assert.ok(text.includes('selectValue'), 'select 应使用校验后的值')
  assert.ok(!text.includes("value={current?.id ?? '__follow__'}"), '未校验的 current.id 会让 select 回落到第一个 option')
})

test('api.ts 所有数据请求支持 root 作用域', () => {
  const text = read('api.ts')
  assert.ok(text.includes('function withRoot('), '统一拼 root 查询参数')
  for (const fn of ['fetchPages', 'fetchLint', 'fetchSearch', 'fetchVaults', 'fetchPage', 'fetchCheckpoints', 'fetchSemanticStatus']) {
    assert.ok(new RegExp(`${fn}\\([^)]*root`).test(text) || text.includes(`${fn}(root`), `${fn} 应接受 root`)
  }
})
