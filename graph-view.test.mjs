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

test('WikiSidebar 含图谱入口与经 openNote 打开笔记（openTab 由 index.ts 注入，见下一条用例）', () => {
  const ws = join(ROOT, 'src/client/WikiSidebar.tsx')
  assert.ok(existsSync(ws), 'src/client/WikiSidebar.tsx 应存在')
  const text = readFileSync(ws, 'utf8')
  assert.match(text, /图谱/)
  assert.match(text, /openNote/)
})

test('index.ts 把「知识库」+「笔记」都注册进 0.2 原生右侧栏', () => {
  const idx = join(ROOT, 'src/client/index.ts')
  assert.ok(existsSync(idx), 'src/client/index.ts 应存在')
  const text = readFileSync(idx, 'utf8')
  // 两个 tab 类型：id/kind 同值，内容面板挂在 keyed seat `sidebar.right.pane.tab`（key = id）。
  assert.match(text, /dsh-knj-obsidian:wiki/)
  assert.match(text, /dsh-knj-obsidian:note/)
  assert.match(text, /sidebar\.right\.pane\.tab/)
  // 笔记由点击打开：openNote → sidebarRight.openTab(kind, { params }) 带 id|category；
  // 页签标题走 `sidebar.right.pane.tab.title` seat 从 navigation.params 读回。
  assert.match(text, /\.openTab\(NOTE_TAB, \{ params:/)
  assert.match(text, /sidebar\.right\.pane\.tab\.title/)
  assert.match(text, /openNote/)
})

test('GraphView 用户内容一律经 esc() 转义——含 <script> 的标题不会裸拼进 innerHTML', () => {
  const gv = join(ROOT, 'src/client/GraphView.tsx')
  const text = readFileSync(gv, 'utf8')
  assert.match(text, /function esc\(/, '应定义 esc() 转义函数')
  // 用户可控字段（id/category/title）进入标记的每个槽位都必须经由 esc()
  assert.match(text, /data-id="\$\{esc\(n\.id\)\}"/, 'data-id 属性须经 esc()')
  assert.match(text, /data-category="\$\{esc\(n\.category\)\}"/, 'data-category 属性须经 esc()')
  assert.match(text, /data-title="\$\{esc\(n\.title\)\}"/, 'data-title 属性须经 esc()')
  // 标签文案可被 placeLabels 截断（label），未截断时回落 title；两者都必须 esc()
  assert.match(text, /const label = n\.label \?\? n\.title/, '标签取 n.label 并回落 n.title')
  assert.match(text, />\$\{esc\(label\)\}<\/text>/, 'text 节点内容须经 esc()')
  assert.match(text, /<title>\$\{esc\(n\.title\)\}<\/title>/, '悬停完整标题须经 esc()')
  // 未经 esc() 的裸插值即注入面（坐标 x/y 为纯数字，不受此限）
  assert.doesNotMatch(text, /\$\{n\.(id|title|category)\}/, 'id/title/category 不得裸插值')
  assert.doesNotMatch(text, /\$\{n\.(id|title|category)\?/, '同上（含可选链形态）')
})

test('GraphView 布局收敛后铺开并选边标签（面板空间利用三步中的 ①②）', () => {
  const gv = join(ROOT, 'src/client/GraphView.tsx')
  const text = readFileSync(gv, 'utf8')
  assert.match(text, /spreadToFill\(nodes, W, H\)/, '布局结束后应调用 spreadToFill 铺满面板')
  assert.match(text, /placeLabels\(nodes, W, H, measureLabel\)/, '铺开后应选边/截断标签')
  // 两步必须在「最后一帧」执行（写在 raf 续帧那行之后，即 else 收敛分支里），
  // 否则力场会把铺开的结果又拉回去；铺开+选边之后必须重绘一次。
  const firstRaf = text.indexOf('raf = requestAnimationFrame(tick)')
  const settle = text.indexOf('spreadToFill(nodes, W, H)')
  const labels = text.indexOf('placeLabels(nodes, W, H, measureLabel)')
  const repaint = text.indexOf('paint()', labels)
  assert.ok(firstRaf > 0 && settle > firstRaf, '铺开须写在收敛分支（raf 续帧那行之后）')
  assert.ok(labels > settle, '先铺开坐标、再定标签侧别')
  assert.ok(repaint > labels, '选边/截断后须重绘以生效')
  // 侧别决定 text-anchor：左侧标签向右对齐，右侧标签向左对齐（否则文字会压回圆上）
  assert.match(text, /text-anchor="\$\{side === 'left' \? 'end' : 'start'\}"/, 'text-anchor 须按标签侧别选择')
})
