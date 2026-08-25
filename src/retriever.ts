// src/retriever.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VaultStore } from './vault-store.ts'
import type { WikiCategory, Confidence } from './types.ts'

export interface RetrievalCandidate {
  page: string
  id: string
  category: WikiCategory
  title: string
  confidence: Confidence
  snippet: string
  matchedBy: 'title' | 'tag' | 'body' | 'graph' | 'index'
}

export interface RetrievalResult {
  candidates: RetrievalCandidate[]
  strategy: string
  totalPages: number
}

const MAX_SNIPPET = 200

/** 解析 [[wikilink]]：剥离锚点（#…）与别名（|…），与 lint.ts 保持一致 */
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g

export function retrieve(
  store: VaultStore,
  query: string,
  opts: { mode?: 'auto' | 'index-only'; maxCandidates?: number } = {},
): RetrievalResult {
  const mode = opts.mode ?? 'auto'
  const maxCandidates = opts.maxCandidates ?? 10
  const q = query.trim().toLowerCase()
  const pages = store.listPages()
  const totalPages = pages.length

  if (!q) return { candidates: [], strategy: 'empty-query', totalPages }

  if (mode === 'index-only') {
    return { candidates: indexOnly(store, q, maxCandidates), strategy: 'index-only', totalPages }
  }

  const titleHits: RetrievalCandidate[] = []
  const tagHits: RetrievalCandidate[] = []
  for (const p of pages) {
    const page = store.readPage(p.id, p.category)
    if (!page) continue
    if (page.title.toLowerCase().includes(q)) {
      titleHits.push(candidate(page, p.category, 'title'))
    } else if (page.tags.some((t) => t.toLowerCase().includes(q))) {
      tagHits.push(candidate(page, p.category, 'tag'))
    }
  }

  if (titleHits.length > 0 || tagHits.length > 0) {
    return { candidates: [...titleHits, ...tagHits].slice(0, maxCandidates), strategy: 'title+tag', totalPages }
  }

  const bodyHits: RetrievalCandidate[] = []
  for (const p of pages) {
    const page = store.readPage(p.id, p.category)
    if (!page) continue
    const idx = page.body.toLowerCase().indexOf(q)
    if (idx !== -1) bodyHits.push(candidate(page, p.category, 'body', undefined, idx))
  }

  // L4：对 L3 命中的每个页面，取其出链邻居作为关联候选（matchedBy: 'graph'）
  const byId = allPagesById(store)
  const graphHits: RetrievalCandidate[] = []
  for (const hit of bodyHits) {
    for (const target of linkedPages(store, hit.id, hit.category)) {
      const tp = byId.get(target)
      if (!tp) continue
      if (bodyHits.some((h) => h.id === target)) continue // 已命中不重复
      const tpage = store.readPage(tp.id, tp.category)
      if (tpage) graphHits.push({ ...candidate(tpage, tp.category, 'body'), matchedBy: 'graph' })
    }
  }

  const all = [...bodyHits, ...graphHits]
  return { candidates: all.slice(0, maxCandidates), strategy: bodyHits.length > 0 ? 'title+tag+body+graph' : 'title+tag+body', totalPages }
}

function indexOnly(store: VaultStore, q: string, max: number): RetrievalCandidate[] {
  const out: RetrievalCandidate[] = []
  const indexPath = join(store.wikiRoot, 'index.md')
  try {
    const lines = readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n').split('\n')
    for (const line of lines) {
      const m = line.match(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/)
      if (m && line.toLowerCase().includes(q)) {
        const id = m[1].trim()
        const page = store.readPage(id, 'concepts') ?? store.readPage(id, 'entities') ?? store.readPage(id, 'references') ?? store.readPage(id, 'synthesis') ?? store.readPage(id, 'projects')
        if (page) {
          out.push(candidate(page, page.category, 'index', line.trim().slice(0, MAX_SNIPPET)))
          if (out.length >= max) break
        }
      }
    }
  } catch {
    // index.md 缺失时 L1 无候选，降级交给调用方
  }
  return out
}

function candidate(
  page: { id: string; title: string; tags: string[]; confidence: Confidence; body: string },
  category: WikiCategory,
  matchedBy: RetrievalCandidate['matchedBy'],
  snippetOverride?: string,
  matchIndex?: number,
): RetrievalCandidate {
  return {
    page: `${category}/${page.id}.md`,
    id: page.id,
    category,
    title: page.title,
    confidence: page.confidence,
    snippet: snippetOverride ?? snippet(page.body, matchedBy, matchIndex),
    matchedBy,
  }
}

function snippet(body: string, matchedBy: RetrievalCandidate['matchedBy'], matchIndex?: number): string {
  if (matchedBy === 'title' || matchedBy === 'tag') {
    const first = body.split('\n').find((l) => l.trim().length > 0) ?? ''
    return first.slice(0, MAX_SNIPPET)
  }
  if (typeof matchIndex === 'number') {
    // L3：以命中位置为中心的窗口（±100，收拢到正文边界，≤200 字符）
    const start = Math.max(0, matchIndex - MAX_SNIPPET / 2)
    return body.slice(start, start + MAX_SNIPPET)
  }
  return body.slice(0, MAX_SNIPPET)
}

/**
 * 返回页面正文中的出链 target 列表（[[b]]、[[c|别名]]、[[d#锚点]] 均归一为 id，
 * 锚点与别名被剥离），供 L4 图谱遍历与跨页关联复用。
 */
export function linkedPages(store: VaultStore, id: string, category: WikiCategory): string[] {
  const page = store.readPage(id, category)
  if (!page) return []
  const out: string[] = []
  for (const m of page.body.matchAll(WIKILINK_RE)) {
    out.push(m[1].trim())
  }
  return out
}

function allPagesById(store: VaultStore): Map<string, { id: string; category: WikiCategory; title: string }> {
  const map = new Map<string, { id: string; category: WikiCategory; title: string }>()
  for (const p of store.listPages()) map.set(p.id, p)
  return map
}
