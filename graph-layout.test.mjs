// graph-layout.test.mjs — 图谱「面板空间利用」的几何契约（纯函数，行为断言）
//
// 背景（2026-09-21 实测，见对话内测量）：力导向布局的云团尺寸由力平衡决定、与面板无关——
// 1180px 面板里节点横向只跨 68%、宽屏 1600px 里只有 49%；而纵向被硬夹到 91%。
// 另有两处真问题：① 布局只夹「圆心」，标签向右伸 12+文字宽没人管 → 溢出面板被静默裁掉
// （实测最长标签 513px，超出面板 130px）；② 窄面板（边栏 336px）标签集体溢出 → 内容被撑成
// 2 倍宽 → viewBox meet 把整体缩小到 0.47× → 高度只用 43%。
//
// 修法（三步，只动坐标与标签，圆半径与字号全程不变 → 无变形）：
//   ① placeLabels：按两侧空余选边，放不下则按该侧可用宽度截断
//   ② spreadToFill：布局结束后把节点坐标按轴铺进可用区（限幅 ≤1.8×）
//   ③ viewBox 保持面板尺寸（不做等比缩放，避免字号被缩小）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  labelWidth, placeLabels, spreadToFill, labelBounds,
  GRAPH_PAD, NODE_R, LABEL_GAP, MAX_SPREAD, MAX_SPREAD_Y,
} from './lib/graph-layout.js'

const node = (title, x, y) => ({ id: title.slice(0, 6), title, category: 'concepts', x, y })

test('labelWidth：同字数下 CJK 比 ASCII 宽（估算口径，供 Node 侧测试用）', () => {
  assert.ok(labelWidth('中文标签') > labelWidth('abcd'), '4 个汉字应宽于 4 个 ASCII 字符')
  assert.ok(labelWidth('') === 0)
})

test('placeLabels：右侧放得下就放右边，且不截断', () => {
  const nodes = [node('短标题', 100, 100)]     // W=600 → 右侧剩余充裕
  const r = placeLabels(nodes, 600, 400)
  assert.equal(nodes[0].side, 'right')
  assert.equal(nodes[0].label, '短标题')
  assert.equal(r.truncated, 0)
})

test('placeLabels：右侧放不下、左侧放得下 → 改放左边（不截断）', () => {
  const long = '这是一条相当长的页面标题用来占据不少横向空间'
  const nodes = [node(long, 560, 100)]         // 靠近右边界：右侧放不下，左侧充裕
  placeLabels(nodes, 600, 400)
  assert.equal(nodes[0].side, 'left', '应翻到左侧')
  assert.equal(nodes[0].label, long, '左侧放得下就不该截断')
})

test('placeLabels：两侧都放不下 → 按可用宽度截断，且标签绝不越界', () => {
  const huge = '这是一条异常冗长的标题'.repeat(6)
  const W = 336, H = 420
  const nodes = [node(huge, 168, 200)]
  const r = placeLabels(nodes, W, H)
  assert.equal(r.truncated, 1, '应发生截断')
  assert.ok(nodes[0].label.endsWith('…'), '截断应带省略号')
  assert.ok(labelWidth(nodes[0].label) < labelWidth(huge), '截断后应更短')
  const b = labelBounds(nodes[0])
  assert.ok(b.left >= 0 && b.right <= W, `标签必须落在面板内：${JSON.stringify(b)} (W=${W})`)
})

test('placeLabels：任意位置 × 任意窄面板都不越界（不变量）', () => {
  const title = '跨源同 id 不覆盖：自动加后缀新建，防跨源静默丢失旧内容'
  for (const W of [240, 280, 336, 520, 1180]) {
    for (const x of [20, 40, W / 2, W - 40, W - 20]) {
      const nodes = [node(title, x, 100)]
      placeLabels(nodes, W, 400)
      const b = labelBounds(nodes[0])
      assert.ok(b.left >= 0 && b.right <= W, `W=${W} x=${x} 越界：${JSON.stringify(b)}`)
    }
  }
})

test('spreadToFill：面板有空白 → 按轴铺开，且限幅不超过 MAX_SPREAD', () => {
  // 模拟现状：云团横向只跨 800、纵向跨 512（面板 1180×560）
  const nodes = [node('a', 200, 30), node('b', 1000, 530)]
  const r = spreadToFill(nodes, 1180, 560)
  assert.ok(r.kx > 1, '横向应被铺开')
  assert.ok(r.kx <= MAX_SPREAD, `限幅：kx=${r.kx}`)
  assert.ok(r.ky >= 1 - 1e-9 && r.ky <= MAX_SPREAD, `ky=${r.ky}`)
})

test('spreadToFill：已经填满的面板不动（kx=ky=1，避免无谓抖动）', () => {
  const nodes = [node('a', GRAPH_PAD + NODE_R, GRAPH_PAD + NODE_R), node('b', 336 - GRAPH_PAD - NODE_R, 420 - GRAPH_PAD - NODE_R)]
  const r = spreadToFill(nodes, 336, 420)
  assert.ok(Math.abs(r.kx - 1) < 0.02, `已填满不该铺开：kx=${r.kx}`)
  assert.ok(Math.abs(r.ky - 1) < 0.02, `已填满不该铺开：ky=${r.ky}`)
})

test('spreadToFill：铺开后节点仍留在面板内（含半径留边）', () => {
  const nodes = [node('a', 700, 300), node('b', 720, 320), node('c', 680, 280)]
  spreadToFill(nodes, 400, 300)
  for (const n of nodes) {
    assert.ok(n.x >= GRAPH_PAD && n.x <= 400 - GRAPH_PAD, `x 越界 ${n.x}`)
    assert.ok(n.y >= GRAPH_PAD && n.y <= 300 - GRAPH_PAD, `y 越界 ${n.y}`)
  }
})

test('v12 纵向铺开上限按轴放开：高画布上 ky 可超过横向 MAX_SPREAD', () => {
  // 背景：画布改成吃满侧栏高度后（侧栏 336×~900），纵轴空间远超力导向云团，
  // 单一 1.8× 上限会把点锁在中间一条带里 → 高度仍有一半空白。
  assert.ok(MAX_SPREAD_Y > MAX_SPREAD, `纵向上限应高于横向：${MAX_SPREAD_Y} vs ${MAX_SPREAD}`)
  const nodes = [node('a', 200, 400), node('b', 200, 500)]
  const r = spreadToFill(nodes, 336, 900)
  assert.ok(r.ky > MAX_SPREAD, `高画布应允许纵向铺开超过横向上限：ky=${r.ky}`)
  assert.ok(r.ky <= MAX_SPREAD_Y, `纵向限幅：ky=${r.ky} ≤ ${MAX_SPREAD_Y}`)
  assert.ok(r.kx <= MAX_SPREAD, `横向仍受 ${MAX_SPREAD} 限幅：kx=${r.kx}`)
  for (const n of nodes) {
    assert.ok(n.y >= GRAPH_PAD && n.y <= 900 - GRAPH_PAD, `铺开后 y 越界 ${n.y}`)
  }
})

test('v12 宽画布（全屏）不放宽纵向：仍按 MAX_SPREAD 收口，避免把分类聚簇上下扯开', () => {
  // 全屏 1180×560 是「宽画布」：纵向可用 512，云团只跨 100 → 若不设限会拉到 5.1×。
  const nodes = [node('a', 300, 300), node('b', 300, 400)]
  const r = spreadToFill(nodes, 1180, 560)
  assert.ok(r.ky <= MAX_SPREAD + 1e-9, `宽画布纵向不该超过 ${MAX_SPREAD}：ky=${r.ky}`)
  assert.ok(r.ky > 1, '仍有空白时应向上收（ky>1）')
})

test('spreadToFill：单节点/零跨度不产生 NaN、不抛错', () => {
  const single = [node('only', 100, 100)]
  const r = spreadToFill(single, 600, 400)
  assert.ok(Number.isFinite(r.kx) && Number.isFinite(r.ky))
  assert.deepEqual(spreadToFill([], 600, 400), { kx: 1, ky: 1 })
})

test('labelBounds：与 placeLabels 的选边一致（左右各一套算法）', () => {
  const right = node('右', 100, 100); placeLabels([right], 600, 400)
  const b1 = labelBounds(right)
  assert.ok(Math.abs(b1.left - (right.x + LABEL_GAP)) < 1e-9, '右侧标签从 x+GAP 起')
  const left = node('这是一个很长的标题放在右边一定放不下', 580, 100); placeLabels([left], 600, 400)
  const b2 = labelBounds(left)
  assert.ok(b2.right <= left.x - LABEL_GAP + 1e-9, '左侧标签到 x-GAP 止')
})
