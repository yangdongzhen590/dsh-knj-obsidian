/**
 * 图谱视图（设计 v2）：力导向布局渲染进 <svg>。
 * - 节点按 category 着色（CSS 类 → 宿主令牌，浅/深主题自适应），孤儿灰色，断链红色虚线
 * - 顶部统计 + 图例 chips；点击节点回调 onOpenNote 打开笔记
 * - 安全：用户可控字段（id/title/category）进入 innerHTML 前一律经 esc() 转义
 */
import { useEffect, useRef, useState } from 'react'
import { IconGraph, IconRefresh } from './icons.tsx'

interface GraphNode { id: string; title: string; category: string; confidence: string }
interface GraphEdge { source: string; target: string; broken: boolean }
interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; orphanIds: string[]; pageCount: number }

// innerHTML 注入防护：Record 索引签名满足 strict noImplicitAny；语义不变：< > & " 全部转为实体。
const ESC_MAP: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }
function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ESC_MAP[c] ?? c)
}

/** category → 节点 CSS 类（颜色由 styles.ts 令牌驱动） */
const CATEGORY_CLASS: Record<string, string> = {
  concepts: 'knj-graph-node--concepts', entities: 'knj-graph-node--entities',
  references: 'knj-graph-node--references', synthesis: 'knj-graph-node--synthesis', projects: 'knj-graph-node--projects',
  dictionaries: 'knj-graph-node--dictionaries', tables: 'knj-graph-node--tables',
}

const CATEGORY_LABELS: Record<string, string> = {
  concepts: '概念', entities: '实体', references: '参考', synthesis: '综合', projects: '项目',
  dictionaries: '字典', tables: '数据结构',
}

export function GraphView({ onOpenNote }: { onOpenNote: (id: string, category: string, title: string) => void }) {
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/obsidian-wiki/graph')
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setGraph(d) })
      .catch((e) => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!graph || !svgRef.current) return
    const svg = svgRef.current
    const W = 600, H = 400
    const nodes = graph.nodes.map((n, i) => ({ ...n, x: W / 2 + Math.cos(i * 2.4) * 140, y: H / 2 + Math.sin(i * 2.4) * 140, vx: 0, vy: 0 }))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    // 双端都存在的边才参与布局：断链边的 target 不在节点集（buildGraph 对缺失
    // 目标仍出边并标 broken）；source 也一并防御，避免 e.a/e.b undefined 在 tick 崩溃。
    const edges = graph.edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ ...e, a: byId.get(e.source)!, b: byId.get(e.target)! }))
    const orphans = new Set(graph.orphanIds)
    let frame = 0
    let raf = 0
    const DEG = 0.85, REP = 1200, SPRING = 0.04, TARGET = 120

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
        const f = (d - TARGET) * SPRING
        e.a.vx += (dx / d) * f; e.a.vy += (dy / d) * f
        e.b.vx -= (dx / d) * f; e.b.vy -= (dy / d) * f
      }
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy
        n.x = Math.max(20, Math.min(W - 20, n.x))
        n.y = Math.max(20, Math.min(H - 20, n.y))
      }
      paint()
      frame++
      if (frame < 200) raf = requestAnimationFrame(tick)
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

    const onClick = (ev: MouseEvent) => {
      const el = (ev.target as Element).closest('g[data-id]') as SVGGElement | null
      if (!el) return
      // dataset 读回的是解析后的原始值（属性实体在解析时已还原）
      onOpenNote(el.dataset.id!, el.dataset.category!, el.dataset.title!)
    }
    svg.addEventListener('click', onClick)
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); svg.removeEventListener('click', onClick) }
  }, [graph, onOpenNote])

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

  return <div className="knj-vcol" style={{ padding: '4px 12px 12px' }}>
    <div className="knj-graph-head">
      <span className="knj-graph-stats">{graph.nodes.length} 节点 · {graph.edges.length} 边</span>
      <span className="knj-statusbar__spacer" />
      <span className="knj-pop__hint">点击节点打开笔记</span>
    </div>
    <div className="knj-graph-legend">
      {legendKeys.map((cat) => (
        <span key={cat} className={`knj-chip knj-chip--${cat}`}>{CATEGORY_LABELS[cat] ?? cat}</span>
      ))}
      {graph.orphanIds.length > 0 && <span className="knj-chip knj-chip--neutral">孤儿 {graph.orphanIds.length}</span>}
    </div>
    <svg ref={svgRef} width={600} height={400} viewBox="0 0 600 400" className="knj-graph-svg" />
  </div>
}
