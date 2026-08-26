/** 与后端 /api/obsidian-wiki/* 通信的客户端。同源 fetch。 */
export interface PageSummary {
  id: string
  category: string
  title: string
  confidence: string
}

export interface SearchCandidate {
  id: string
  category: string
  title: string
  confidence: string
  snippet: string
}

export interface LintReport {
  orphans: string[]
  brokenLinks: { from: string; target: string }[]
  missingFrontmatter: string[]
  pageCount: number
}

const BASE = '/api/obsidian-wiki'

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`wiki api ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

export function fetchPages(): Promise<{ pages: PageSummary[]; total: number }> {
  return getJson(`${BASE}/pages`)
}

export function fetchSearch(q: string, mode: 'auto' | 'index-only' = 'auto'): Promise<{ candidates: SearchCandidate[]; strategy: string }> {
  return getJson(`${BASE}/search?q=${encodeURIComponent(q)}&mode=${mode}`)
}

export function fetchLint(): Promise<LintReport> {
  return getJson(`${BASE}/lint`)
}
