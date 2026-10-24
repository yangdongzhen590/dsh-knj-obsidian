// src/graph-motion.ts
// 图谱「入场动效」的纯参数与缓动（客户端与 Node 测试共用）。
//
// 为什么需要（2026-10-25 实测）：嵌入态画布吃满侧栏高度后，入场仍是「逐帧跑力场 + 每帧重绘」：
//   ① 开场前几帧位移巨大（看着像节点“飞出去”），
//   ② 收敛最后一帧才把 spreadToFill 的 1.8×/3× 铺开写回坐标 → 一次瞬跳，然后彻底静止，
//   ③ 每帧 O(n²) 力场 + innerHTML 重写，节点越多越贵。
//
// 改为：先同步收敛出终态（力场参数与终态几何完全不变），再从初始环形位置按固定时长缓动到终态。
// 这样动效时长与节点数无关、单帧位移有数学上界、结尾不再瞬跳；大库与「减少动效」直接静态呈现。

/** 入场动效总时长（固定；不随节点数变化）。 */
export const ANIMATE_DURATION_MS = 640

/** 超过这个节点数就不做入场动画，直接呈现终态（力场每帧 O(n²)，大库优先流畅）。 */
export const ANIMATE_MAX_NODES = 300

/**
 * 平滑步进缓动 f(t)=3t²−2t³：峰值斜率 1.5。
 * 选它而不是标准 easeInOutCubic（峰值斜率 3）：同一时长下前者的单帧最大位移只有后者的 1/2，
 * 这正是「开场不要暴走」要的数学保证。入参越界自动夹到 [0,1]。
 */
export function easeInOutSmoothstep(t: number): number {
  if (!(t > 0)) return 0
  if (t >= 1) return 1
  return t * t * (3 - 2 * t)
}

/**
 * 是否播放入场动画。
 * @param nodeCount - 本次渲染的节点数（> ANIMATE_MAX_NODES 时直接静态终态）。
 * @param reducedMotion - 用户/系统要求「减少动态效果」（prefers-reduced-motion: reduce）。
 */
export function shouldAnimate(nodeCount: number, reducedMotion = false): boolean {
  if (reducedMotion) return false
  return nodeCount <= ANIMATE_MAX_NODES
}
