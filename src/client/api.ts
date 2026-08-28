/** 与后端 /api/obsidian-wiki/* 通信的客户端。同源 fetch。 */
export interface PageSummary {
  id: string
  category: string
  title: string
  confidence: string
}

export interface WikiPage {
  id: string
  title: string
  category: string
  tags: string[]
  source: string
  confidence: string
  created: string
  updated: string
  body: string
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

/** v5：磁盘原文（含 frontmatter），源码视图/编辑用。 */
export async function fetchRawPage(id: string, category: string): Promise<string> {
  const res = await fetch(`${BASE}/page?id=${encodeURIComponent(id)}&category=${encodeURIComponent(category)}&raw=1`)
  const data = await res.json() as { raw?: string; error?: string }
  if (!res.ok || data.error) throw new Error(data.error ?? `wiki api: ${res.status}`)
  return data.raw ?? ''
}

/** v5：全文保存（同源 JSON POST）。成功返回解析后的页面。 */
export async function saveRawPage(id: string, category: string, raw: string): Promise<WikiPage> {
  const res = await fetch(`${BASE}/page?id=${encodeURIComponent(id)}&category=${encodeURIComponent(category)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  const data = await res.json() as { page?: WikiPage; error?: string }
  if (!res.ok || data.error) throw new Error(data.error ?? `save failed: ${res.status}`)
  return data.page as WikiPage
}

export function fetchSearch(q: string, mode: 'auto' | 'index-only' = 'auto'): Promise<{ candidates: SearchCandidate[]; strategy: string }> {
  return getJson(`${BASE}/search?q=${encodeURIComponent(q)}&mode=${mode}`)
}

export function fetchLint(): Promise<LintReport> {
  return getJson(`${BASE}/lint`)
}

/** v6：重建 index.md（同源 POST）。 */
export async function rebuildIndex(): Promise<{ pageCount: number }> {
  const res = await fetch(`${BASE}/rebuild-index`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  const data = await res.json() as { pageCount?: number; error?: string }
  if (!res.ok || data.error) throw new Error(data.error ?? `rebuild failed: ${res.status}`)
  return { pageCount: data.pageCount ?? 0 }
}

export interface ImportResult {
  imported: number
  updated: number
  skipped: number
  files: Array<{ source: string; id: string; category: string; status: string; renamed?: boolean }>
}

/** v6：路径导入 md（同源 POST）。 */
export async function importMd(path: string, category: string): Promise<ImportResult> {
  const res = await fetch(`${BASE}/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, category }),
  })
  const data = await res.json() as Partial<ImportResult> & { error?: string }
  if (!res.ok || data.error) throw new Error(data.error ?? `import failed: ${res.status}`)
  return data as ImportResult
}

// ---------- v7 vault 管理 ----------

export interface VaultInfo {
  id: string
  name: string
  root: string
  source: 'cwd' | 'workspace' | 'attached'
}

export interface VaultListEntry extends VaultInfo {
  pageCount: number
}

export interface VaultsResponse {
  current: VaultInfo | null
  vaults: VaultListEntry[]
}

export function fetchVaults(): Promise<VaultsResponse> {
  return getJson(`${BASE}/vaults`)
}

async function postVault(action: string, payload: Record<string, unknown>): Promise<VaultsResponse> {
  const res = await fetch(`${BASE}/vault/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json() as Partial<VaultsResponse> & { error?: string }
  if (!res.ok || data.error) throw new Error(data.error ?? `vault ${action} failed: ${res.status}`)
  return data as VaultsResponse
}

/** 按目录激活（跟工作区走）：已注册仅切换，未注册自动挂接。 */
export const activateVault = (root: string): Promise<VaultsResponse> => postVault('activate', { root })

export const switchVault = (id: string): Promise<VaultsResponse> => postVault('switch', { id })

export const attachVault = (root: string, name?: string): Promise<VaultsResponse> => postVault('attach', name?.trim() ? { root, name: name.trim() } : { root })

export const removeVault = (id: string): Promise<VaultsResponse> => postVault('remove', { id })
