/**
 * 图谱视图（v10 页签式全屏）：
 * - 嵌入态：自适应画布 + 全屏按钮；点节点 → 直接开笔记工作台
 * - 全屏态（Portal 到 body）：顶部页签栏 —— 「图谱」页签 + 点击节点打开的页面页签
 * - 节点命中用 pointerup（布局动画逐帧重写 svg 子元素会让 click 丢失，表现为要点两次）
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchPages, fetchPage } from './api.ts'
import { renderMarkdown } from './markdown.ts'
import { IconClose, IconCompress, IconExpand, IconGraph, IconRefresh } from './icons.tsx'

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

function layoutParams(n: number): { frameLimit: number; spring: number } {
  if (n > 1200) return { frameLimit: 60, spring: 0.02 }
  if (n > 500) return { frameLimit: 90, spring: 0.03 }
  if (n > 150) return { frameLimit: 140, spring: 0.04 }
  return { frameLimit: 200, spring: 0.04 }
}

type FsTab =
  | { key: string; kind: 'graph' }
  | { key: string; kind: 'page'; ref: PageRef }

export function GraphView({ onOpenNote }: { onOpenNote: (id: string, category: string, title: string) => void }) {
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [tabs, setTabs] = useState<FsTab[]>([{ key: 'graph', kind: 'graph' }])
  const [activeKey, setActiveKey] = useState('graph')
  const [size, setSize] = useState({ w: 520, h: 320 })
  const svgRef = useRef<SVGSVGElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [idIndex, setIdIndex] = useState<Map<string, { category: string; title: string }> | null>(null)
  const active = activeKey === 'graph'
  const [seq, setSeq] = useState(0) // 切回图谱页签时强制重跑布局

  useEffect(() => {
    let cancelled = false
    fetch('/api/obsidian-wiki/graph')
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setGraph(d) })
      .catch((e) => { if (!cancelled) setError(String(e)) })
    fetchPages()
      .then(({ pages }) => {
        if (cancelled) return
        const m = new Map<string, { category: string; title: string }>()
        for (const p of pages) m.set(p.id, { category: p.category, title: p.title })
        setIdIndex(m)
      })
      .catch(() => { /* 索引失败：页内 wikilink 不跳 */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current
      if (!el || !active) return
      if (fullscreen) setSize({ w: Math.max(320, el.clientWidth || 320), h: Math.max(200, el.clientHeight || 300) })
      else setSize({ w: Math.max(320, el.clientWidth || 320), h: Math.max(200, (el.clientHeight || 300) - 86) })
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    if (wrapRef.current) ro.observe(wrapRef.current)
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => { ro.disconnect(); window.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen, active, seq])

  useEffect(() => {
    if (!graph || !svgRef.current || !active) return
    const svg = svgRef.current
    const W = size.w, H = size.h
    const nodes = graph.nodes.map((n, i) => ({
      ...n,
      x: W / 2 + Math.cos(i * 2.4) * Math.min(120, Math.max(60, W / 5)),
      y: H / 2 + Math.sin(i * 2.4) * Math.min(100, Math.max(50, H / 5)),
      vx: 0, vy: 0,
    }))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const edges = graph.edges.filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ ...e, a: byId.get(e.source)!, b: byId.get(e.target)! }))
    const orphans = new Set(graph.orphanIds)
    const { frameLimit, spring } = layoutParams(nodes.length)
    let frame = 0, raf = 0
    const DEG = 0.85, REP = 1200, TARGET = 120
    const tick = () => {
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
      paint()
      frame++
      if (frame < frameLimit) raf = requestAnimationFrame(tick)
    }
    const paint = () => {
      let out = ''
      for (const e of edges) {
        out += `<line x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}" class="knj-graph-edge${e.broken ? ' knj-graph-edge--broken' : ''}" stroke-width="1.5"/>`
      }
      for (const n of nodes) {
        const cls = orphans.has(n.id) ? 'knj-graph-node--orphan' : (CATEGORY_CLASS[n.category] ?? 'knj-graph-node--muted')
        out += `<g data-id="${esc(n.id)}" data-category="${esc(n.category)}" data-title="${esc(n.title)}" style="cursor:pointer">`
        out += `<circle cx="${n.x}" cy="${n.y}" r="8" class="knj-graph-node ${cls}"/>`
        out += `<text x="${n.x + 12}" y="${n.y + 4}" class="knj-graph-label">${esc(n.title)}</text>`
        out += `</g>`
      }
      svg.innerHTML = out
    }
    raf = requestAnimationFrame(tick)
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
    <div className="knj-vcol knj-graph-embed" style={{ padding: '4px 12px 12px' }}>
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
        <svg ref={svgRef} onPointerUp={handleNodePointerUp} viewBox={`0 0 ${size.w} ${size.h}`} className="knj-graph-svg" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: size.h }} />
      </div>
    </div>
  )
}

/** 页签内容：读页渲染；页内 wikilink 打开/激活对应页签。 */
function PageTabView({ refPage, idIndex, onOpenRef, onOpenFull }: {
  refPage?: { kind: 'page'; ref: PageRef }
  idIndex: Map<string, { category: string; title: string }> | null
  onOpenRef: (p: PageRef) => void
  onOpenFull: () => void
}) {
  const [state, setState] = useState<{ loading: boolean; html: string | null; err: string | null }>({ loading: true, html: null, err: null })
  useEffect(() => {
    let cancelled = false
    if (!refPage) { setState({ loading: false, html: null, err: null }); return }
    setState({ loading: true, html: null, err: null })
    const { ref } = refPage
    fetchPage(ref.id, ref.category)
      .then((page) => { if (!cancelled) setState({ loading: false, html: renderMarkdown(page.body), err: null }) })
      .catch((e) => { if (!cancelled) setState({ loading: false, html: null, err: String(e) }) })
    return () => { cancelled = true }
  }, [refPage?.ref.id, refPage?.ref.category])

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
