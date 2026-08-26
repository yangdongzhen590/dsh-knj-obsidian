// graph-view.test.mjs
// Task 5 存在性测试：GraphView（力导向图谱）、WikiSidebar 图谱入口 + openTab、
// index.ts 注册工作台标签 type（dsh-knj-obsidian:note，读 tab.path 的 id|category）。
// 按 brief 实现说明补第 4 条：esc() 注入防护源契约（含 <script> 的标题不得裸拼进 innerHTML）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath（而非 brief 的 URL.pathname + join）：Windows 上 pathname 形如 /D:/…，
// join 后产生 \\D:\…，fs 会解析成不存在的 D:\D:\…（见 client-build.test.mjs 同款约定）
const ROOT = fileURLToPath(new URL('.', import.meta.url))

test('GraphView.tsx 存在且含力导向/图谱渲染逻辑', () => {
  const gv = join(ROOT, 'src/client/GraphView.tsx')
  assert.ok(existsSync(gv), 'src/client/GraphView.tsx 应存在')
  const text = readFileSync(gv, 'utf8')
  assert.match(text, /api\/obsidian-wiki\/graph/)
  assert.match(text, /svg|<svg/i)
})

test('WikiSidebar 含图谱入口与 openTab 打开笔记', () => {
  const ws = join(ROOT, 'src/client/WikiSidebar.tsx')
  assert.ok(existsSync(ws), 'src/client/WikiSidebar.tsx 应存在')
  const text = readFileSync(ws, 'utf8')
  assert.match(text, /图谱/)
  assert.match(text, /openTab/)
})

test('index.ts 注册工作台标签 type', () => {
  const idx = join(ROOT, 'src/client/index.ts')
  assert.ok(existsSync(idx), 'src/client/index.ts 应存在')
  const text = readFileSync(idx, 'utf8')
  assert.match(text, /dsh-knj-obsidian:note/)
  assert.match(text, /registerTab/)
})

test('GraphView 用户内容一律经 esc() 转义——含 <script> 的标题不会裸拼进 innerHTML', () => {
  const gv = join(ROOT, 'src/client/GraphView.tsx')
  const text = readFileSync(gv, 'utf8')
  assert.match(text, /function esc\(/, '应定义 esc() 转义函数')
  // 用户可控字段（id/category/title）进入标记的每个槽位都必须经由 esc()
  assert.match(text, /data-id="\$\{esc\(n\.id\)\}"/, 'data-id 属性须经 esc()')
  assert.match(text, /data-category="\$\{esc\(n\.category\)\}"/, 'data-category 属性须经 esc()')
  assert.match(text, /data-title="\$\{esc\(n\.title\)\}"/, 'data-title 属性须经 esc()')
  assert.match(text, />\$\{esc\(n\.title\)\}<\/text>/, 'text 节点内容须经 esc()')
  // 未经 esc() 的裸插值即注入面（坐标 x/y 为纯数字，不受此限）
  assert.doesNotMatch(text, /\$\{n\.(id|title|category)\}/, 'id/title/category 不得裸插值')
  assert.doesNotMatch(text, /\$\{n\.(id|title|category)\?/, '同上（含可选链形态）')
})
