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
  matchedBy: 'title' | 'tag' | 'body'
}

export interface RetrievalResult {
  candidates: RetrievalCandidate[]
  strategy: string
  totalPages: number
}

const MAX_SNIPPET = 200

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
    if (idx !== -1) bodyHits.push(candidate(page, p.category, 'body'))
  }

  return { candidates: bodyHits.slice(0, maxCandidates), strategy: 'title+tag+body', totalPages }
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
          out.push(candidate(page, page.category, 'body'))
          if (out.length >= max) break
        }
      }
    }
  } catch {
    // index.md 缺失时 L1 无候选，降级交给调用方
  }
  return out
}

function candidate(page: { id: string; title: string; tags: string[]; confidence: Confidence; body: string }, category: WikiCategory, matchedBy: RetrievalCandidate['matchedBy']): RetrievalCandidate {
  return {
    page: `${category}/${page.id}.md`,
    id: page.id,
    category,
    title: page.title,
    confidence: page.confidence,
    snippet: snippet(page.body, matchedBy),
    matchedBy,
  }
}

function snippet(body: string, matchedBy: RetrievalCandidate['matchedBy']): string {
  if (matchedBy === 'title' || matchedBy === 'tag') {
    const first = body.split('\n').find((l) => l.trim().length > 0) ?? ''
    return first.slice(0, MAX_SNIPPET)
  }
  return body.slice(0, MAX_SNIPPET)
}
