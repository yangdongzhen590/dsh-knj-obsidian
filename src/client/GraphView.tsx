/**
 * 图谱视图（v10 页签式全屏，v13 入场动效克制化）：
 * - 嵌入态：自适应画布 + 全屏按钮；点节点 → 直接开笔记工作台
 * - 全屏态（Portal 到 body）：顶部页签栏 —— 「图谱」页签 + 点击节点打开的页面页签
 * - 节点命中用 pointerup（动画逐帧重写 svg 子元素会让 click 丢失，表现为要点两次）
 * - v13：先同步收敛出终态（力场参数不变），再按固定时长缓动入场；大库/减少动效直接静态
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchGraph, fetchPages, fetchPage } from './api.ts'
import { renderMarkdown } from './markdown.ts'
import { IconClose, IconCompress, IconExpand, IconGraph, IconRefresh } from './icons.tsx'
import { LABEL_GAP, NODE_R, labelWidth, placeLabels, spreadToFill } from '../graph-layout.ts'
import { ANIMATE_DURATION_MS, easeInOutSmoothstep, shouldAnimate } from '../graph-motion.ts'

interface GraphNode { id: string; title: string; category: string; confidence: string }
interface GraphEdge { source: string; target: string; broken: boolean }
interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; orphanIds: string[]; pageCount: number }
interface PageRef { id: string; category: string; title: string }

const ESC_MAP: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }
function esc(s: string): string { return s.replace(/[<>&"]/g, (c) => ESC_MAP[c] ?? c) }

const CATEGORY_CLASS: Record<string, string> = {
  concepts: 'knj-graph-node--concepts', entities: 'knj-graph-node--entities',
  references: 'knj-graph-node--references', synthesis: 'knj-graph-node--synthesis', projects: 'knj-graph-node--projects',
  dictionaries: 'knj-graph-node--dictionaries', tables: 'knj-graph-node--tables',
}
const CATEGORY_LABELS: Record<string, string> = {
  concepts: '概念', entities: '实体', references: '参考', synthesis: '综合', projects: '项目',
  dictionaries: '字典', tables: '数据结构',
}

/** 浏览器里用 canvas 实测标签宽度；无 canvas 时退回 graph-layout 的估算口径（Node 测试用同一口径）。 */
function makeLabelMeasurer(): (t: string) => number {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return labelWidth
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif'
    return (t: string) => ctx.measureText(t).width
  } catch {
    return labelWidth
  }
}

function layoutParams(n: number): { frameLimit: number; spring: number } {
  if (n > 1200) return { frameLimit: 60, spring: 0.02 }
  if (n > 500) return { frameLimit: 90, spring: 0.03 }
  if (n > 150) return { frameLimit: 140, spring: 0.04 }
  return { frameLimit: 200, spring: 0.04 }
}

/** 系统级「减少动态效果」开关；不支持的宿主/测试环境按「不减少」处理。 */
function prefersReducedMotion(): boolean {
  try {
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
  } catch {
    return false
  }
}

type FsTab =
  | { key: string; kind: 'graph' }
  | { key: string; kind: 'page'; ref: PageRef }

export function GraphView({ onOpenNote, root }: { onOpenNote: (id: string, category: string, title: string) => void; root?: string }) {
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [tabs, setTabs] = useState<FsTab[]>([{ key: 'graph', kind: 'graph' }])
  const [activeKey, setActiveKey] = useState('graph')
  const [size, setSize] = useState({ w: 520, h: 320 })
  const svgRef = useRef<SVGSVGElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  /** 上一次播过入场动画的「图 + seq」：只有它们变了才重播，单纯尺寸变化不重播。 */
  const lastAnimatedRef = useRef<{ graph: GraphData | null; seq: number }>({ graph: null, seq: -1 })
  /** 最近一次实测画布尺寸：布局 effect 用它确认 state 里的 size 已是最新（避免用旧尺寸跑两遍）。 */
  const measuredSizeRef = useRef<{ w: number; h: number } | null>(null)
  const [idIndex, setIdIndex] = useState<Map<string, { category: string; title: string }> | null>(null)
  const active = activeKey === 'graph'
  const [seq, setSeq] = useState(0) // 切回图谱页签时强制重跑布局

  useEffect(() => {
    let cancelled = false
    fetchGraph<GraphData>(root)
      .then((d) => { if (!cancelled) setGraph(d) })
      .catch((e) => { if (!cancelled) setError(String(e)) })
    fetchPages(root)
      .then(({ pages }) => {
        if (cancelled) return
        const m = new Map<string, { category: string; title: string }>()
        for (const p of pages) m.set(p.id, { category: p.category, title: p.title })
        setIdIndex(m)
      })
      .catch(() => { /* 索引失败：页内 wikilink 不跳 */ })
    return () => { cancelled = true }
  }, [root])

  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current
      if (!el || !active) return
      // v12（2026-10-25）：画布高度由 flex 链决定，这里只读实测像素。
      // 嵌入态不再「自测高度再减 86px」——那会把测量结果写回被测量元素，
      // 形成「测量 → 改高 → 再测量」的反馈环，画布被钉在 320/200px 地板，
      // 侧栏再高也留一大片空白（本次改动要修的正是它）。
      // 宽度下限用 200（不是 320）：320 的画布宽度下限会让 viewBox 比实测画布更宽，
      // preserveAspectRatio=meet 于是整体缩 2.5% 且标签按 320 排版、右侧被裁几像素。
      const next = { w: Math.max(200, el.clientWidth || 320), h: Math.max(200, el.clientHeight || 320) }
      // 尺寸没变就不 setState：setSize 每次都是新对象，会白白触发一次「布局 effect 重跑」，
      // 而重跑会把正在播的入场动画打断成瞬跳（ResizeObserver 在挂载后还会补发一次同样尺寸）。
      const prev = measuredSizeRef.current
      if (prev && prev.w === next.w && prev.h === next.h) return
      measuredSizeRef.current = next
      setSize(next)
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    if (wrapRef.current) ro.observe(wrapRef.current)
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => { ro.disconnect(); window.removeEventListener('keydown', onKey) }
    // 依赖 graph：首帧取数中画布还没挂载（wrapRef 为 null），数据到达后必须重量一次并挂观测器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, fullscreen, active, seq])

  useEffect(() => {
    if (!graph || !svgRef.current || !active) return
    const svg = svgRef.current
    const W = size.w, H = size.h
    // v13：测量先于布局 effect 跑，state 里的 size 可能还是上一帧的旧尺寸（首帧 520×320）。
    // 用旧尺寸跑一遍力场+动画，紧接着真尺寸再跑一遍 → 观众看到两次位移（正是“跳得快”的元凶之一）。
    // 这里只在「尺寸与实测一致」时布局；不一致就先让位给下一次 setSize 渲染。
    const measured = measuredSizeRef.current
    if (measured && (measured.w !== W || measured.h !== H)) return
    // label/side 由 placeLabels 在布局收敛后写入（见 graph-layout.ts）
    const nodes: (GraphNode & {
      x: number; y: number; vx: number; vy: number
      label?: string; side?: 'left' | 'right'
    })[] = graph.nodes.map((n, i) => ({
      ...n,
      x: W / 2 + Math.cos(i * 2.4) * Math.min(120, Math.max(60, W / 5)),
      y: H / 2 + Math.sin(i * 2.4) * Math.min(100, Math.max(50, H / 5)),
      vx: 0, vy: 0,
    }))
    // 入场动效的起点 = 初始环形位置（力场随后把它推到终态）。
    const from = nodes.map((n) => ({ x: n.x, y: n.y }))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const edges = graph.edges.filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ ...e, a: byId.get(e.source)!, b: byId.get(e.target)! }))
    const orphans = new Set(graph.orphanIds)
    const { frameLimit, spring } = layoutParams(nodes.length)
    const DEG = 0.85, REP = 1200, TARGET = 120

    /** 一步力场迭代（只改坐标、不绘制）——参数与旧实现完全一致，保证终态几何不变。 */
    const integrate = () => {
      for (const a of nodes) {
        a.vx *= DEG; a.vy *= DEG
        for (const b of nodes) {
          if (a === b) continue
          const dx = a.x - b.x, dy = a.y - b.y
          const d2 = dx * dx + dy * dy + 0.01
          const d = Math.sqrt(d2)
          const f = REP / d2
          a.vx += (dx / d) * f; a.vy += (dy / d) * f
        }
      }
      for (const e of edges) {
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const f = (d - TARGET) * spring
        e.a.vx += (dx / d) * f; e.a.vy += (dy / d) * f
        e.b.vx -= (dx / d) * f; e.b.vy -= (dy / d) * f
      }
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy
        n.x = Math.max(24, Math.min(W - 24, n.x))
        n.y = Math.max(24, Math.min(H - 24, n.y))
      }
    }
    const measureLabel = makeLabelMeasurer()
    const paint = () => {
      let out = ''
      for (const e of edges) {
        out += `<line x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}" class="knj-graph-edge${e.broken ? ' knj-graph-edge--broken' : ''}" stroke-width="1.5"/>`
      }
      for (const n of nodes) {
        const cls = orphans.has(n.id) ? 'knj-graph-node--orphan' : (CATEGORY_CLASS[n.category] ?? 'knj-graph-node--muted')
        const side = n.side ?? 'right'
        const label = n.label ?? n.title
        const lx = side === 'left' ? n.x - LABEL_GAP : n.x + LABEL_GAP
        out += `<g data-id="${esc(n.id)}" data-category="${esc(n.category)}" data-title="${esc(n.title)}" style="cursor:pointer">`
        // 悬停显示完整标题：标签可能因面板过窄被截断（见 graph-layout.placeLabels）
        out += `<title>${esc(n.title)}</title>`
        out += `<circle cx="${n.x}" cy="${n.y}" r="${NODE_R}" class="knj-graph-node ${cls}"/>`
        out += `<text x="${lx}" y="${n.y + 4}" class="knj-graph-label" text-anchor="${side === 'left' ? 'end' : 'start'}">${esc(label)}</text>`
        out += `</g>`
      }
      svg.innerHTML = out
    }

    // ① 同步收敛出终态：一次算完，不再逐帧跑力场并重绘（旧实现开场前几帧位移巨大、收敛后又瞬跳）。
    for (let frame = 0; frame < frameLimit; frame += 1) integrate()
    // ② 终态定稿：铺开 + 标签选边/截断（旧实现写在收敛最后一帧；这里同样只作用于终态）。
    spreadToFill(nodes, W, H)
    placeLabels(nodes, W, H, measureLabel)
    const target = nodes.map((n) => ({ x: n.x, y: n.y }))

    // ③ 入场呈现：切库/切回页签重播；只是尺寸变化（窗口/侧栏 resize）不重播，否则拖窗口会一直抖。
    const last = lastAnimatedRef.current
    const replay = last.graph !== graph || last.seq !== seq
    lastAnimatedRef.current = { graph, seq }
    if (!replay || !shouldAnimate(nodes.length, prefersReducedMotion())) {
      paint()
      return
    }
    let raf = 0
    const startedAt = performance.now()
    const step = () => {
      const t = (performance.now() - startedAt) / ANIMATE_DURATION_MS
      const e = easeInOutSmoothstep(t)
      for (let i = 0; i < nodes.length; i += 1) {
        nodes[i].x = from[i].x + (target[i].x - from[i].x) * e
        nodes[i].y = from[i].y + (target[i].y - from[i].y) * e
      }
      paint()
      if (t < 1) raf = requestAnimationFrame(step)
    }
    step()
    return () => { cancelAnimationFrame(raf) }
  }, [graph, size, active, seq])

  // 节点命中用 pointerup（不用 click）：布局动画每帧 innerHTML 重写 svg 子元素，
  // 按下/抬起落在不同 DOM 实例时浏览器不派发 click（表现为要点两次）。
  const handleNodePointerUp = (ev: { target: EventTarget | null }) => {
    const el = (ev.target as Element | null)?.closest('g[data-id]') as SVGGElement | null
    if (!el) return
    const p = { id: el.dataset.id!, category: el.dataset.category!, title: el.dataset.title! }
    if (fullscreen) {
      const key = `p:${p.category}/${p.id}`
      setTabs((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, { key, kind: 'page', ref: p }]))
      setActiveKey(key)
    } else {
      onOpenNote(p.id, p.category, p.title)
    }
  }

  // 页内 wikilink / 复用打开：打开或激活一个页面页签
  const openPageTab = (p: PageRef) => {
    const key = `p:${p.category}/${p.id}`
    setTabs((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, { key, kind: 'page', ref: p }]))
    setActiveKey(key)
  }

  const closeTab = (key: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.key !== key)
      if (next.length === 0) return [{ key: 'graph', kind: 'graph' }]
      if (activeKey === key) setActiveKey('graph')
      return next
    })
    setSeq((s) => s + 1)
  }

  if (error) return <div className="knj-error"><IconRefresh size={14} />图谱加载失败：{error}</div>
  if (!graph) return <div className="knj-loading"><span className="knj-spinner"><IconRefresh size={14} /></span>图谱加载中…</div>
  if (graph.nodes.length < 2) {
    return <div className="knj-empty">
      <span className="knj-empty__icon"><IconGraph size={30} /></span>
      <div>图谱还太小（{graph.nodes.length} 节点）</div>
      <div>先吸收几份文档，图谱就会长出来。</div>
    </div>
  }

  const legendKeys = [...new Set(graph.nodes.map((n) => n.category))]
  const legend = (
    <div className="knj-graph-legend">
      {legendKeys.map((cat) => (
        <span key={cat} className={`knj-chip knj-chip--${cat}`}>{CATEGORY_LABELS[cat] ?? cat}</span>
      ))}
      {graph.orphanIds.length > 0 && <span className="knj-chip knj-chip--neutral">孤儿 {graph.orphanIds.length}</span>}
    </div>
  )
  const stats = <span className="knj-graph-stats">{graph.nodes.length} 节点 · {graph.edges.length} 边</span>

  return fullscreen ? (
    createPortal(
      <div className="knj-wiki">
        <div className="knj-graph-fs" onClick={(e) => { if (e.target === e.currentTarget) setFullscreen(false) }}>
          <div className="knj-vcol" style={{ height: '100%', padding: 12, gap: 8 }}>
            <div className="knj-fsbar">
              {stats}
              <span className="knj-fsbar__sep" />
              <div className="knj-fstabs">
                <span className={`knj-fstab${activeKey === 'graph' ? ' knj-fstab--active' : ''}`}
                  onClick={() => { setActiveKey('graph'); setSeq((s) => s + 1) }}>
                  <IconGraph size={13} />图谱
                </span>
                {tabs.filter((t) => t.kind === 'page').map((t) => (
                  <span key={t.key} className={`knj-fstab${activeKey === t.key ? ' knj-fstab--active' : ''}`}
                    onClick={() => setActiveKey(t.key)} title={t.key}>
                    {(t as { kind: 'page'; ref: PageRef }).ref.title}
                    <button type='button' className="knj-fstab__close" title='关闭'
                      onClick={(e) => { e.stopPropagation(); closeTab(t.key) }}>
                      <IconClose size={11} />
                    </button>
                  </span>
                ))}
              </div>
              <span className="knj-statusbar__spacer" />
              <button type='button' className="knj-icon-btn" title='退出全屏 (Esc)'
                onClick={() => { setFullscreen(false); setActiveKey('graph') }}>
                <IconCompress size={14} />
              </button>
            </div>
            {legend}
            {activeKey === 'graph' ? (
              <div ref={wrapRef} className="knj-fscanvas">
                <svg ref={svgRef} onPointerUp={handleNodePointerUp} viewBox={`0 0 ${size.w} ${size.h}`} className="knj-graph-svg" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }} />
              </div>
            ) : (
              <div className="knj-fspage">
                <PageTabView
                  root={root}
                  refPage={tabs.find((t) => t.key === activeKey && t.kind === 'page') as { kind: 'page'; ref: PageRef } | undefined}
                  idIndex={idIndex}
                  onOpenRef={(p) => openPageTab(p)}
                  onOpenFull={() => {
                    const tab = tabs.find((t) => t.key === activeKey && t.kind === 'page') as { kind: 'page'; ref: PageRef } | undefined
                    if (tab) { setFullscreen(false); setActiveKey('graph'); onOpenNote(tab.ref.id, tab.ref.category, tab.ref.title) }
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body,
    )
  ) : (
    // v12：嵌入态在 knj-graph-host 的 flex 链里长高；head/legend 保持原样（用户要求不动视觉），
    // 画布 .knj-fscanvas 用 flex:1 吃掉剩余高度，svg 由 CSS 撑满（100%），不再由 state 写死高度。
    <div className="knj-vcol knj-graph-embed" style={{ flex: '1 1 auto', minHeight: 0, padding: '4px 12px 12px' }}>
      <div className="knj-graph-head">
        {stats}
        <span className="knj-statusbar__spacer" />
        <span className="knj-pop__hint">点击节点打开笔记</span>
        <button type='button' className="knj-icon-btn" title='全屏图谱' onClick={() => setFullscreen(true)}>
          <IconExpand size={14} />
        </button>
      </div>
      {legend}
      <div ref={wrapRef} className="knj-fscanvas">
        <svg ref={svgRef} onPointerUp={handleNodePointerUp} viewBox={`0 0 ${size.w} ${size.h}`} className="knj-graph-svg" preserveAspectRatio="xMidYMid meet" />
      </div>
    </div>
  )
}

/** 页签内容：读页渲染；页内 wikilink 打开/激活对应页签。 */
function PageTabView({ refPage, idIndex, onOpenRef, onOpenFull, root }: {
  refPage?: { kind: 'page'; ref: PageRef }
  idIndex: Map<string, { category: string; title: string }> | null
  onOpenRef: (p: PageRef) => void
  onOpenFull: () => void
  root?: string
}) {
  const [state, setState] = useState<{ loading: boolean; html: string | null; err: string | null }>({ loading: true, html: null, err: null })
  useEffect(() => {
    let cancelled = false
    if (!refPage) { setState({ loading: false, html: null, err: null }); return }
    setState({ loading: true, html: null, err: null })
    const { ref } = refPage
    fetchPage(ref.id, ref.category, root)
      .then((page) => { if (!cancelled) setState({ loading: false, html: renderMarkdown(page.body), err: null }) })
      .catch((e) => { if (!cancelled) setState({ loading: false, html: null, err: String(e) }) })
    return () => { cancelled = true }
  }, [refPage?.ref.id, refPage?.ref.category, root])

  const onContentClick = (ev: ReactMouse) => {
    const a = (ev.target as Element | null)?.closest?.('a[data-wikilink]') as HTMLElement | null
    if (!a) return
    ev.preventDefault(); ev.stopPropagation()
    const id = a.dataset.wikilink ?? ''
    const hit = idIndex?.get(id)
    if (hit) onOpenRef({ id, category: hit.category, title: hit.title })
  }

  const page = refPage?.ref
  return (
    <div className="knj-fspage__inner" onClick={onContentClick}>
      <div className="knj-fspage__bar">
        <span className="knj-fspage__title" title={page?.id}>{page?.title}</span>
        <span className="knj-statusbar__spacer" />
        <span className="knj-pop__hint">{page ? `${page.category}/${page.id}` : ''}</span>
        <button type='button' className="knj-icon-btn" title='在笔记工作台完整打开' onClick={onOpenFull}>
          <IconExpand size={13} />
        </button>
      </div>
      <div className="knj-fspage__body">
        {state.loading
          ? <div className="knj-loading"><span className="knj-spinner"><IconRefresh size={14} /></span>加载中…</div>
          : state.err
            ? <div className="knj-error"><IconRefresh size={14} />{state.err}</div>
            : state.html
              ? <div className="wiki-md-content" dangerouslySetInnerHTML={{ __html: state.html }} />
              : null}
      </div>
    </div>
  )
}
type ReactMouse = { target: EventTarget | null; preventDefault: () => void; stopPropagation: () => void }
