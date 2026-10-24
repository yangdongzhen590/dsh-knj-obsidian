// graph-motion.test.mjs — 图谱入场动效的纯函数契约（2026-10-25）
//
// 背景：嵌入态画布吃满侧栏高度后（v12），入场仍是「逐帧跑力场 + 每帧重绘」：
//   前几帧位移很大（看着像“飞出去”），收敛最后一帧再把节点按轴铺开 1.8×/3× → 瞬跳；
//   节点越多 O(n²)/帧 越贵。改为：同步收敛出终态 → 固定时长缓动入场（大库/减少动效直接静态）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANIMATE_DURATION_MS, ANIMATE_MAX_NODES, easeInOutSmoothstep, shouldAnimate,
} from './lib/graph-motion.js'

test('easeInOutSmoothstep：端点夹取 + 单调不减 + 峰值斜率 ≈1.5（不许开场瞬移）', () => {
  assert.equal(easeInOutSmoothstep(0), 0)
  assert.equal(easeInOutSmoothstep(1), 1)
  assert.equal(easeInOutSmoothstep(-1), 0, '进度 <0 时夹到 0')
  assert.equal(easeInOutSmoothstep(2), 1, '进度 >1 时夹到 1')
  let prev = 0
  let peak = 0
  const steps = 400
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    const v = easeInOutSmoothstep(t)
    assert.ok(v >= prev - 1e-12, `应单调不减：t=${t} v=${v} prev=${prev}`)
    peak = Math.max(peak, (v - prev) * steps)
    prev = v
  }
  // 平滑步进 f=3t²-2t³ 的峰值斜率 1.5 → 单帧位移 ≤1.5×(距离/时长)×1帧
  assert.ok(peak <= 1.6, `峰值斜率应 ≤1.6：${peak}`)
  assert.ok(peak >= 1.3, `峰值斜率应接近 1.5（否则动效拖沓）：${peak}`)
})

test('shouldAnimate：≤300 节点且未要求减少动效才动画', () => {
  assert.equal(shouldAnimate(2), true)
  assert.equal(shouldAnimate(ANIMATE_MAX_NODES), true, '阈值本身仍动画')
  assert.equal(shouldAnimate(ANIMATE_MAX_NODES + 1), false, '大库直接静态终态')
  assert.equal(shouldAnimate(2, true), false, 'prefers-reduced-motion：小库也不动画')
  assert.equal(shouldAnimate(ANIMATE_MAX_NODES + 1, true), false)
})

test('时长常数：固定 ~640ms（与节点数无关）', () => {
  assert.equal(typeof ANIMATE_DURATION_MS, 'number')
  assert.ok(ANIMATE_DURATION_MS >= 400 && ANIMATE_DURATION_MS <= 1000, `时长量级应在 400–1000ms：${ANIMATE_DURATION_MS}`)
  assert.equal(typeof ANIMATE_MAX_NODES, 'number')
  assert.ok(ANIMATE_MAX_NODES >= 100, `大库阈值不应过小：${ANIMATE_MAX_NODES}`)
})
