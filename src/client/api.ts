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

/**
 * 会话级作用域：每个请求都带 `root=<工作区根>`。
 *
 * 为什么不是「服务端全局当前库」：面板是按会话渲染的，多个会话可能同时挂在不同的
 * 工作区。全局单值会被最后 activate 的那一个劫持，表现为「切换工作区后仍是旧库」
 * （见 .wiki/concepts/会话级知识库绑定）。带 root 后每个面板只读自己工作区的库。
 * 不带 root 的调用保持旧行为（全局当前库），供没有会话上下文的地方使用。
 */
function withRoot(path: string, root?: string): string {
  const r = (root ?? '').trim()
  if (!r) return path
  return `${path}${path.includes('?') ? '&' : '?'}root=${encodeURIComponent(r)}`
}

async function getJson<T>(path: string, root?: string): Promise<T> {
  const url = withRoot(path, root)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`wiki api ${url}: ${res.status}`)
  return res.json() as Promise<T>
}

export function fetchPages(root?: string): Promise<{ pages: PageSummary[]; total: number }> {
  return getJson(`${BASE}/pages`, root)
}

/** v5：磁盘原文（含 frontmatter），源码视图/编辑用。 */
export async function fetchRawPage(id: string, category: string, root?: string): Promise<string> {
  const res = await fetch(withRoot(`${BASE}/page?id=${encodeURIComponent(id)}&category=${encodeURIComponent(category)}&raw=1`, root))
  const data = await res.json() as { raw?: string; error?: string }
  if (!res.ok || data.error) throw new Error(data.error ?? `wiki api: ${res.status}`)
  return data.raw ?? ''
}

/** v5：全文保存（同源 JSON POST）。成功返回解析后的页面。 */
export async function saveRawPage(id: string, category: string, raw: string, root?: string): Promise<WikiPage> {
  const res = await fetch(withRoot(`${BASE}/page?id=${encodeURIComponent(id)}&category=${encodeURIComponent(category)}`, root), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  const data = await res.json() as { page?: WikiPage; error?: string }
  if (!res.ok || data.error) throw new Error(data.error ?? `save failed: ${res.status}`)
  return data.page as WikiPage
}

export function fetchSearch(q: string, mode: 'auto' | 'index-only' = 'auto', root?: string): Promise<{ candidates: SearchCandidate[]; strategy: string }> {
  return getJson(`${BASE}/search?q=${encodeURIComponent(q)}&mode=${mode}`, root)
}

export function fetchLint(root?: string): Promise<LintReport> {
  return getJson(`${BASE}/lint`, root)
}

/** 图谱数据（节点/边/孤儿），按 root 取库。 */
export function fetchGraph<T = unknown>(root?: string): Promise<T> {
  return getJson<T>(`${BASE}/graph`, root)
}

/** v6：重建 index.md（同源 POST）。 */
export async function rebuildIndex(root?: string): Promise<{ pageCount: number }> {
  const res = await fetch(withRoot(`${BASE}/rebuild-index`, root), {
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
  /** 2026-09-20 契约变更：导入 = 保真搬运到 `_raw/` 暂存区，不再直接写正式分类。 */
  files: Array<{ source: string; staged: string; status: string }>
  stagedDir?: string
  hint?: string
}

/** v6：路径导入 md（同源 POST）。 */
export async function importMd(path: string, category: string, root?: string): Promise<ImportResult> {
  const res = await fetch(withRoot(`${BASE}/import`, root), {
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
  /** 该库当前页数（跟随时由服务端按 root 解析后补上） */
  pageCount?: number
}

export interface VaultListEntry extends VaultInfo {
  pageCount: number
  /** 磁盘上是否已有 .wiki（注册 ≠ 建库；false 时 UI 提供「初始化知识库」入口） */
  initialized: boolean
}

export interface VaultsResponse {
  current: VaultInfo | null
  vaults: VaultListEntry[]
  /** 本次请求带 root 时回填：服务端实际解析到的工作区根（未初始化时等于请求的 root） */
  followedRoot?: string
  /** 本次请求带 root 且该工作区没有 .wiki：面板显示「本工作区没有知识库」而不是旧库 */
  uninitialized?: boolean
}

export function fetchVaults(root?: string): Promise<VaultsResponse> {
  return getJson(`${BASE}/vaults`, root)
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

/** 按目录激活（旧全局语义；面板已改为按会话 root 取库，保留给显式全局切换场景）。 */
export const activateVault = (root: string): Promise<VaultsResponse> => postVault('activate', { root })

export const switchVault = (id: string): Promise<VaultsResponse> => postVault('switch', { id })

export const attachVault = (root: string, name?: string): Promise<VaultsResponse> => postVault('attach', name?.trim() ? { root, name: name.trim() } : { root })

export const removeVault = (id: string): Promise<VaultsResponse> => postVault('remove', { id })

// ---------- 还原点（checkpoint） ----------
export interface CheckpointMeta { id: string; createdAt: string; pageCount: number }

export async function fetchCheckpoints(root?: string): Promise<CheckpointMeta[]> {
  const data = await getJson<{ checkpoints: CheckpointMeta[] }>(`${BASE}/checkpoints`, root)
  return data.checkpoints
}

/** 从还原点回滚（同源 JSON POST）。
 *  mode 默认 `merge`（非破坏性：只撤销快照内页面的修改，保留快照后新增页）；
 *  `exact` = 整库回到快照（会删除快照后新增页），需显式传入。 */
export async function restoreCheckpoint(id: string, mode: 'merge' | 'exact' = 'merge', root?: string): Promise<{ pageCount: number; restored: number; keptNewer: number; mode: string }> {
  const res = await fetch(withRoot(`${BASE}/checkpoint/restore`, root), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, mode }),
  })
  const data = await res.json() as { pageCount?: number; restored?: number; keptNewer?: number; mode?: string; error?: string }
  if (!res.ok || data.error) throw new Error(data.error ?? `restore failed: ${res.status}`)
  return { pageCount: data.pageCount ?? 0, restored: data.restored ?? 0, keptNewer: data.keptNewer ?? 0, mode: data.mode ?? mode }
}

/** 取单个知识页（非 raw）。 */
export async function fetchPage(id: string, category: string, root?: string): Promise<WikiPage> {
  const res = await fetch(withRoot(`${BASE}/page?id=${encodeURIComponent(id)}&category=${encodeURIComponent(category)}`, root))
  const data = await res.json() as { page?: WikiPage; error?: string }
  if (!res.ok || data.error || !data.page) throw new Error(data.error ?? `page api: ${res.status}`)
  return data.page
}

// ---------- v8 本地语义索引（严格离线） ----------

export interface SemanticRefreshRun {
  ok: boolean
  at: string
  documents: number
  chunks: number
  durationMs: number
  note?: string
}

export interface SemanticStatus {
  available: boolean
  modelPresent: boolean
  indexState: 'ready' | 'index-empty' | 'index-stale'
  documents: number
  pendingEmbedding: number
  hasVectorIndex: boolean
  refreshing: boolean
  startedAt?: string
  elapsedMs?: number
  /** 本进程内实测的一次冷启动耗时（首次刷新），用于给出「约 N 秒」的估算。 */
  coldStartMs?: number
  lastRun?: SemanticRefreshRun
  note?: string
}

export function fetchSemanticStatus(root?: string): Promise<SemanticStatus> {
  return getJson(`${BASE}/semantic-status`, root)
}

/** 触发后台重建索引（立刻返回；进度靠 fetchSemanticStatus 轮询）。 */
export async function triggerSemanticUpdate(root?: string): Promise<{ started: boolean; running: boolean; status: SemanticStatus }> {
  const res = await fetch(withRoot(`${BASE}/semantic-update`, root), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  const data = await res.json() as { started?: boolean; running?: boolean; status?: SemanticStatus; error?: string }
  if (!res.ok || data.error) throw new Error(data.error ?? `semantic update failed: ${res.status}`)
  return { started: data.started ?? false, running: data.running ?? false, status: data.status as SemanticStatus }
}
