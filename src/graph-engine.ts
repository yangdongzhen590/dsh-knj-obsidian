// src/graph-engine.ts
import type { VaultStore } from './vault-store.ts'
import type { WikiCategory, Confidence } from './types.ts'

export interface GraphNode {
  id: string
  title: string
  category: WikiCategory
  confidence: Confidence
}

export interface GraphEdge {
  source: string
  target: string
  broken: boolean
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  orphanIds: string[]
  pageCount: number
}

/** 解析 [[wikilink]]：剥离锚点（#…）与别名（|…），与 retriever.ts / lint.ts 保持一致 */
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g

export function buildGraph(store: VaultStore): GraphData {
  const pages = store.listPagesReadonly()
  const ids = new Set(pages.map((p) => p.id))
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const incoming = new Map<string, number>()

  for (const p of pages) {
    const page = store.readPage(p.id, p.category)
    nodes.push({
      id: p.id,
      title: page?.title ?? p.title,
      category: p.category,
      confidence: page?.confidence ?? 'extracted',
    })
    if (!page) continue
    for (const m of page.body.matchAll(WIKILINK_RE)) {
      const target = m[1].trim()
      edges.push({ source: p.id, target, broken: !ids.has(target) })
      if (ids.has(target)) {
        incoming.set(target, (incoming.get(target) ?? 0) + 1)
      }
    }
  }

  const outgoing = new Map<string, number>()
  for (const e of edges) {
    if (!e.broken) outgoing.set(e.source, (outgoing.get(e.source) ?? 0) + 1)
  }

  const orphanIds = pages
    .filter((p) => {
      const hasOut = (outgoing.get(p.id) ?? 0) > 0
      const hasIn = (incoming.get(p.id) ?? 0) > 0
      return !hasOut && !hasIn
    })
    .map((p) => p.id)

  return { nodes, edges, orphanIds, pageCount: pages.length }
}

/** HTML 转义助手：供任何需要把用户文本直接嵌入 HTML 文本槽的场景使用（渲染层走 textContent，此为兜底助手） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const CATEGORY_COLORS: Record<string, string> = {
  concepts: '#3b82f6',
  entities: '#22c55e',
  references: '#f97316',
  synthesis: '#a855f7',
  projects: '#6b7280',
}

/**
 * JSON 序列化后再把 < > & 转为 \uXXXX 安全形式。
 * 实测 Node 的 JSON.stringify 并不转义尖括号（{"title":"<script>…"} 原样输出），
 * 若原样内嵌进 HTML 的内联 <script> 块，title 中的 </script> 会提前闭合脚本——
 * 既破坏页面又构成注入。浏览器解析 \u003c 时等价于 <，值不丢失；嵌入文本则不出现任何原始 < > &。
 */
function jsonForEmbed(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

/**
 * 导出单文件交互图谱 HTML：内联 SVG + 原生 JS 力导向布局（斥力 + 弹簧力，多帧收敛），
 * 支持拖拽节点、滚轮缩放（viewBox）、悬停显示标题、按 category 着色、断链红色虚线、孤儿灰色。
 * 零外部依赖。所有用户内容（title/id）经 jsonForEmbed 转义，渲染层用 textContent，双保险防注入。
 */
export function exportGraphHtml(graph: GraphData): string {
  const nodesJson = jsonForEmbed(graph.nodes)
  const edgesJson = jsonForEmbed(graph.edges)
  const orphanIdsJson = jsonForEmbed(graph.orphanIds)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Wiki Graph — ${graph.pageCount} 页</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #111; color: #ddd; }
  #graph { width: 100vw; height: 100vh; }
  #legend { position: fixed; bottom: 16px; left: 16px; background: rgba(0,0,0,.7); padding: 8px 12px; border-radius: 8px; font-size: 12px; }
  .legend-item { display: inline-flex; align-items: center; margin-right: 12px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 4px; }
  #info { position: fixed; top: 16px; right: 16px; background: rgba(0,0,0,.7); padding: 8px 12px; border-radius: 8px; font-size: 12px; }
  #tooltip { position: fixed; background: rgba(0,0,0,.9); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 12px; pointer-events: none; display: none; z-index: 10; }
</style>
</head>
<body>
<svg id="graph" viewBox="0 0 1200 800"></svg>
<div id="legend"><span class="legend-item"><span class="dot" style="background:${CATEGORY_COLORS.concepts}"></span>概念</span><span class="legend-item"><span class="dot" style="background:${CATEGORY_COLORS.entities}"></span>实体</span><span class="legend-item"><span class="dot" style="background:${CATEGORY_COLORS.references}"></span>参考</span><span class="legend-item"><span class="dot" style="background:${CATEGORY_COLORS.synthesis}"></span>综合</span><span class="legend-item"><span class="dot" style="background:${CATEGORY_COLORS.projects}"></span>项目</span><span class="legend-item"><span class="dot" style="border:1px dashed #f87171;background:transparent"></span>断链</span><span class="legend-item"><span class="dot" style="background:#374151"></span>孤儿</span></div>
<div id="info">${graph.nodes.length} 节点 · ${graph.edges.length} 边 · 拖拽/滚轮缩放${graph.nodes.length > 500 ? ' · 图谱较大（>500 节点），性能受限' : ''}</div>
<div id="tooltip"></div>
<script>
const NODES = ${nodesJson};
const EDGES = ${edgesJson};
const ORPHANS = new Set(${orphanIdsJson});
const COLORS = ${jsonForEmbed(CATEGORY_COLORS)};
const W = 1200, H = 800;
const nodes = NODES.map((n, i) => ({ ...n, x: W/2 + Math.cos(i) * 200, y: H/2 + Math.sin(i) * 200, vx: 0, vy: 0 }));
const nodesById = new Map(nodes.map((n) => [n.id, n]));
// 全部边参与渲染；只有两端节点都在的边参与弹簧力（断链边仅渲染不发力学，防止 ghost 节点漂移）
const edges = EDGES.map((e) => ({ ...e, a: nodesById.get(e.source), b: nodesById.get(e.target) || null }));
const physicsEdges = edges.filter((e) => e.a && e.b);
const svg = document.getElementById('graph');
const NS = 'http://www.w3.org/2000/svg';
const tooltip = document.getElementById('tooltip');
const DEG = 0.85, REP = 1200, SPRING = 0.04, TARGET = 140;
let dragNode = null, dragX = 0, dragY = 0;

function tick() {
  for (const a of nodes) {
    a.vx *= DEG; a.vy *= DEG;
    for (const b of nodes) {
      if (a === b) continue;
      const dx = a.x - b.x, dy = a.y - b.y;
      const d2 = dx*dx + dy*dy + 0.01;
      const d = Math.sqrt(d2);
      const f = REP / d2;
      a.vx += (dx/d) * f; a.vy += (dy/d) * f;
    }
  }
  for (const e of physicsEdges) {
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
    const d = Math.sqrt(dx*dx + dy*dy) || 1;
    const f = (d - TARGET) * SPRING;
    const fx = (dx/d) * f, fy = (dy/d) * f;
    e.a.vx += fx; e.a.vy += fy;
    e.b.vx -= fx; e.b.vy -= fy;
  }
  for (const n of nodes) {
    if (n !== dragNode) { n.x += n.vx; n.y += n.vy; }
    n.x = Math.max(20, Math.min(W-20, n.x));
    n.y = Math.max(20, Math.min(H-20, n.y));
  }
}

let stubAngle = 0;
function render() {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const defs = document.createElementNS(NS, 'defs');
  svg.appendChild(defs);
  for (const e of edges) {
    const x1 = e.a.x, y1 = e.a.y;
    let x2, y2;
    if (e.b) { x2 = e.b.x; y2 = e.b.y; }
    else { stubAngle += 2.39996; x2 = e.a.x + Math.cos(stubAngle) * 46; y2 = e.a.y + Math.sin(stubAngle) * 46; }
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', e.broken ? '#f87171' : '#4b5563');
    line.setAttribute('stroke-width', e.broken ? 1 : 1.5);
    if (e.broken) line.setAttribute('stroke-dasharray', '4 3');
    svg.appendChild(line);
    if (e.broken) {
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', x2); dot.setAttribute('cy', y2);
      dot.setAttribute('r', 3); dot.setAttribute('fill', '#f87171');
      svg.appendChild(dot);
    }
  }
  for (const n of nodes) {
    const g = document.createElementNS(NS, 'g');
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('cx', n.x); circle.setAttribute('cy', n.y);
    circle.setAttribute('r', 10);
    circle.setAttribute('fill', COLORS[n.category] || '#6b7280');
    if (ORPHANS.has(n.id)) circle.setAttribute('fill', '#374151');
    g.appendChild(circle);
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', n.x + 14); text.setAttribute('y', n.y + 4);
    text.setAttribute('font-size', 11);
    text.setAttribute('fill', '#e5e7eb');
    text.textContent = n.title;
    g.appendChild(text);
    g.addEventListener('mousedown', (ev) => { dragNode = n; dragX = ev.clientX; dragY = ev.clientY; });
    g.addEventListener('mouseenter', () => { tooltip.style.display = 'block'; tooltip.textContent = n.title + '（' + n.category + '）'; });
    g.addEventListener('mousemove', (ev) => { tooltip.style.left = (ev.clientX + 12) + 'px'; tooltip.style.top = (ev.clientY + 12) + 'px'; });
    g.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    svg.appendChild(g);
  }
}

function loop() { for (let i = 0; i < 5; i++) tick(); render(); requestAnimationFrame(loop); }
svg.addEventListener('mousemove', (ev) => {
  if (!dragNode) return;
  const rect = svg.getBoundingClientRect();
  dragNode.x += (ev.clientX - dragX) / (rect.width / W);
  dragNode.y += (ev.clientY - dragY) / (rect.height / H);
  dragX = ev.clientX; dragY = ev.clientY;
});
window.addEventListener('mouseup', () => { dragNode = null; });
svg.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const rect = svg.getBoundingClientRect();
  const k = ev.deltaY > 0 ? 0.9 : 1.1;
  svg.setAttribute('viewBox', (W * (1 - k) / 2) + ' ' + (H * (1 - k) / 2) + ' ' + (W * k) + ' ' + (H * k));
}, { passive: false });
loop();
</script>
</body>
</html>`
}
