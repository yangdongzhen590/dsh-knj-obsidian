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
