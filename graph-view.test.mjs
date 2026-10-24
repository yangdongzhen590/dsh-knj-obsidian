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
  // 2026-10-24：图谱取数改走 api.ts 的 fetchGraph(root)（会话级作用域），路径常量在 api.ts
  assert.match(text, /fetchGraph/)
  assert.match(readFileSync(join(ROOT, 'src/client/api.ts'), 'utf8'), /\$\{BASE\}\/graph/)
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

test('v12 嵌入态图谱吃满侧栏高度：不再自测高度减 86，svg 由 CSS 撑满', () => {
  const gv = readFileSync(join(ROOT, 'src/client/GraphView.tsx'), 'utf8')
  // 根因（2026-10-25 实测）：嵌入态把「自己测得的高度」再减 86 写回给自己 → 测量反馈环，
  // 画布被钉在地板（~320/200px），侧栏再高也留一大片空白。
  assert.doesNotMatch(gv, /-\s*86/, '嵌入态不得再把测得高度减 86（自测反馈环）')
  assert.match(gv, /h: Math\.max\(200, el\.clientHeight/, '画布高度须直接取实测 clientHeight（200px 兜底）')
  assert.match(gv, /flex: '1 1 auto'/, '嵌入态根节点须在 flex 链里长高')
  assert.doesNotMatch(gv, /height: size\.h/, 'svg 不得再用 state 高度（等价于画布高，反馈环复现）')
  // 数据到达前 wrapRef 为 null：测量 effect 必须随 graph 重跑，否则永远量不到画布。
  assert.match(gv, /\}, \[graph, fullscreen, active, seq\]\)/, '测量 effect 须依赖 graph')
})

test('v12 侧栏图谱视图不滚动、内容区占满（knj-graph-host）', () => {
  const ws = readFileSync(join(ROOT, 'src/client/WikiSidebar.tsx'), 'utf8')
  assert.match(ws, /view === 'graph' \? 'knj-grow knj-graph-host'/, '图谱视图须用不滚动宿主')
  const css = readFileSync(join(ROOT, 'src/client/styles.ts'), 'utf8')
  assert.match(css, /\.knj-graph-host\s*\{[^}]*flex-direction: column/, '宿主须列向 flex')
  assert.match(css, /\.knj-graph-host\s*\{[^}]*overflow: hidden/, '宿主不得滚动')
  assert.match(css, /\.knj-graph-host > \*[^{]*\{[^}]*flex: 1 1 auto/, '宿主子节点须吃满剩余高度')
  assert.match(css, /\.knj-graph-svg\s*\{[^}]*height: 100%/, 'svg 高度交给 CSS（100%）')
})

test('v12 嵌入态画布保留 200px 兜底高度（宿主不给确定高度时不许塌成 0）', () => {
  // svg 改成 height:100% 后，画布高度完全由父链决定：若宿主 pane body 没有确定高度，
  // 百分比高度退化成 auto → 画布可能塌成 0。给嵌入态画布一个最小高度兜底。
  const css = readFileSync(join(ROOT, 'src/client/styles.ts'), 'utf8')
  assert.match(css, /\.knj-graph-embed \.knj-fscanvas\s*\{[^}]*min-height: 200px/, '嵌入态画布须有 200px 兜底')
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

test('GraphView 终态几何不变：同步收敛后铺开并选边标签（不再逐帧力场重绘）', () => {
  const gv = join(ROOT, 'src/client/GraphView.tsx')
  const text = readFileSync(gv, 'utf8')
  // 力场参数与终态处理顺序必须与改前一致——v13 只改动效呈现，不改终态几何。
  assert.match(text, /const DEG = 0\.85, REP = 1200, TARGET = 120/, '力场参数不得改（终态几何不变）')
  assert.match(text, /for \(let frame = 0; frame < frameLimit; frame \+= 1\) integrate\(\)/, '应收敛：一次性同步跑完力场迭代')
  assert.match(text, /spreadToFill\(nodes, W, H\)/, '收敛结束后应调用 spreadToFill 铺满面板')
  assert.match(text, /placeLabels\(nodes, W, H, measureLabel\)/, '铺开后应选边/截断标签')
  const settle = text.indexOf('spreadToFill(nodes, W, H)')
  const labels = text.indexOf('placeLabels(nodes, W, H, measureLabel)')
  const repaint = text.indexOf('paint()', labels)
  assert.ok(settle > 0 && labels > settle, '先铺开坐标、再定标签侧别')
  assert.ok(repaint > labels, '终态定稿后须重绘一次')
  // 旧实现 raf(tick) 每帧跑力场并 innerHTML 重绘：开场前几帧位移巨大（“飞”），
  // 收敛最后一帧再把铺开结果瞬跳上去。该结构必须消失。
  assert.doesNotMatch(text, /requestAnimationFrame\(tick\)/, '不得再逐帧跑力场并重绘')
  // 侧别决定 text-anchor：左侧标签向右对齐，右侧标签向左对齐（否则文字会压回圆上）
  assert.match(text, /text-anchor="\$\{side === 'left' \? 'end' : 'start'\}"/, 'text-anchor 须按标签侧别选择')
})

test('GraphView 入场动效：固定时长缓动 + 大库/减少动效静态 + resize 不重播', () => {
  const text = readFileSync(join(ROOT, 'src/client/GraphView.tsx'), 'utf8')
  assert.match(text, /from '\.\.\/graph-motion\.ts'/, '动效参数/缓动须来自 graph-motion 纯模块')
  assert.match(text, /easeInOutSmoothstep\(/, '入场须用缓动函数（不许线性/瞬移）')
  assert.match(text, /ANIMATE_DURATION_MS/, '时长须用固定常量（与节点数无关）')
  assert.match(text, /shouldAnimate\(nodes\.length/, '节点数阈值 + 减少动效须走 shouldAnimate')
  assert.match(text, /prefers-reduced-motion/, '须识别 prefers-reduced-motion')
  assert.match(text, /lastAnimatedRef/, '尺寸变化不得重播动画（按 graph/seq 变化判断）')
  assert.match(text, /measuredSizeRef/, '须用实测尺寸确认 state.size 已最新（旧尺寸跑两遍 = 双次跳变）')
  assert.match(text, /measured\.w !== W \|\| measured\.h !== H/, '尺寸未就绪时应跳过本帧布局/动画')
  assert.match(text, /cancelAnimationFrame\(raf\)/, 'effect 清理须取消动画帧（F1）')
})
