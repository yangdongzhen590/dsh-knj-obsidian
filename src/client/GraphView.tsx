/**
 * 图谱视图：拉取 /api/obsidian-wiki/graph，用力导向布局（斥力 + 弹簧力）渲染进 <svg>。
 * 节点按 category 着色，孤儿灰色，断链红色虚线；点击节点回调 onOpenNote 打开笔记。
 *
 * 安全：所有用户可控字段（节点 id/title/category）进入 innerHTML 前一律经 esc()
 * 转义（含属性值场景的引号）——含 <script> 的标题只会以实体形式出现，无脚本执行面。
 */
import { useEffect, useRef, useState } from 'react'

interface GraphNode { id: string; title: string; category: string; confidence: string }
interface GraphEdge { source: string; target: string; broken: boolean }
interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; orphanIds: string[]; pageCount: number }

const CATEGORY_COLORS: Record<string, string> = {
  concepts: '#3b82f6', entities: '#22c55e', references: '#f97316',
  synthesis: '#a855f7', projects: '#6b7280',
}

// innerHTML 注入防护：Record 索引签名满足 strict noImplicitAny（brief 的字面量对象
// 按 string 键索引会报 TS7053），语义不变：< > & " 全部转为实体。
const ESC_MAP: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }
function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ESC_MAP[c] ?? c)
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
        out += `<line x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}" stroke="${e.broken ? '#f87171' : '#4b5563'}" stroke-width="1.5"${e.broken ? ' stroke-dasharray="4 3"' : ''}/>`
      }
      for (const n of nodes) {
        const fill = orphans.has(n.id) ? '#374151' : (CATEGORY_COLORS[n.category] ?? '#6b7280')
        out += `<g data-id="${esc(n.id)}" data-category="${esc(n.category)}" data-title="${esc(n.title)}" style="cursor:pointer">`
        out += `<circle cx="${n.x}" cy="${n.y}" r="9" fill="${fill}"/>`
        out += `<text x="${n.x + 12}" y="${n.y + 4}" font-size="10" fill="#e5e7eb">${esc(n.title)}</text>`
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

  if (error) return <div style={{ padding: 16, color: '#f87171' }}>图谱加载失败：{error}</div>
  if (!graph) return <div style={{ padding: 16, color: '#9ca3af' }}>图谱加载中…</div>
  if (graph.nodes.length < 2) return <div style={{ padding: 24, color: '#9ca3af', textAlign: 'center' }}>
    图谱过小（{graph.nodes.length} 节点）——先吸收几份文档，图谱就会长出来。
  </div>

  return <div style={{ padding: 12 }}>
    <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>{graph.nodes.length} 节点 · {graph.edges.length} 边 · 点击节点打开笔记</div>
    <svg ref={svgRef} width={600} height={400} viewBox="0 0 600 400"
      style={{ background: '#111827', borderRadius: 8, width: '100%', height: 'auto' }} />
  </div>
}
