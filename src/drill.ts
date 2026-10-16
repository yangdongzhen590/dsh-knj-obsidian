// src/drill.ts
// wiki_drill / wiki_read 的核心逻辑（设计：docs/2026-09-27-wiki-drill-design.md）
//
// 三个不可动摇的约束：
//   1. 只读：检索路径零写入，绝不调 ensure()、绝不重建索引、绝不写回库；
//   2. 一跳：种子只附带一跳双链邻居。实测本库两跳即覆盖全库 40–60%（27 页库里 11–16 页），
//      一次性多跳等于把半个库倒进上下文，所以更深的下钻由调用方用 page 模式逐跳迭代（D2）；
//   3. 老实：语义层不可用/索引陈旧一律如实回报，绝不静默降级、绝不抛错。
import { normalizeTier } from './vault-store.ts'
import type { VaultStore } from './vault-store.ts'
import type { WikiCategory, WikiTier, WikiPage, Confidence } from './types.ts'
import { buildGraph } from './graph-engine.ts'
import type { GraphData } from './graph-engine.ts'
import { retrieve, linkedPages, TIER_WEIGHT, RETRIEVAL_CATEGORIES } from './retriever.ts'
import type { RetrievalCandidate } from './retriever.ts'
import { mapHitsToPages } from './semantic.ts'
import type { SemanticState } from './semantic-index.ts'

/** 语义层状态：'disabled' = 本次调用没给后端（不是错误，是调用方的选择）；
 *  'model-missing' / 'library-missing' 来自运行时探测（不在 semantic-index 的 SemanticState 里，属未就绪原因）。 */
export type DrillSemanticStatus = SemanticState | 'model-missing' | 'library-missing' | 'disabled'

export interface DrillNeighbor {
  id: string
  category: WikiCategory
  title: string
  tier: WikiTier
  /** out = 种子指向它；in = 它指向种子。 */
  direction: 'out' | 'in'
  /** 指向一个不存在的页（双链体检价值：断链也要看得见）。 */
  broken: boolean
  /** 库内度数（出链 + 入链，去重后），与 retriever 的度加权同口径。 */
  degree: number
  /** 从哪个种子页走过来的。 */
  via: string
  /** 独立取值，刻意不复用 retriever 的 'graph'（那是 L4 词面正文命中页的一跳出链）。 */
  matchedBy: 'graph-neighbor'
  score: number
}

export interface DrillSeed {
  page: string
  id: string
  category: WikiCategory
  title: string
  confidence: Confidence
  tier: WikiTier
  source: string
  snippet: string
  score: number
  matchedBy: string
  /** 哪些通道贡献了这一条（如 ['title','semantic']）——双通道命中者更可信，要可读。 */
  sources: string[]
  neighbors: DrillNeighbor[]
}

export interface DrillResult {
  mode: 'query' | 'page'
  strategy: string
  seeds: DrillSeed[]
  totalPages: number
  truncated?: { seeds: boolean; neighbors: boolean }
  message?: string
  semantic?: { status: DrillSemanticStatus; degraded?: string }
}

/** 语义后端返回的原始命中：既接受路径（对齐 semantic.ts 的 mapHitsToPages），也接受已解析的 id。 */
export interface DrillSemanticHit {
  path?: string
  id?: string
  category?: WikiCategory
  snippet?: string
}

export interface DrillSemanticBackend {
  name: string
  search(query: string, opts?: { limit?: number }): Promise<DrillSemanticHit[]>
}

export interface DrillQueryOptions {
  semantic?: DrillSemanticBackend | null
  /** 语义层状态（由调用方从运行时读出）。缺省 ready。 */
  semanticStatus?: DrillSemanticStatus
  /** 降级说明（通道失败等），如实透传给调用方。 */
  semanticDegraded?: string
  /** 种子数上限，默认 5、硬上限 10。 */
  limit?: number
  /** 每种子邻居数上限，默认 8、硬上限 20。 */
  neighbors?: number
  /** 词面通道候选上限（传给 retrieve）。 */
  maxCandidates?: number
  /** 传给语义后端的候选上限。 */
  semanticLimit?: number
}

export interface DrillPageOptions {
  category?: WikiCategory
  neighbors?: number
  /** 只看出链 / 只看入链 / 都看（默认 both）。 */
  direction?: 'out' | 'in' | 'both'
}

export const DEFAULT_SEED_LIMIT = 5
export const MAX_SEED_LIMIT = 10
export const DEFAULT_NEIGHBOR_LIMIT = 8
export const MAX_NEIGHBOR_LIMIT = 20

/** RRF 常数：与 semantic-index.ts 的 fuseRanked 保持一致，两处融合口径不得分叉。 */
const RRF_K = 60
const DEGREE_STEP = 0.1
const MAX_DEGREE_BONUS = 2
const MAX_SNIPPET = 200

/** 新链路的开关：KNJ_OBSIDIAN_DRILL=off 时工具立即返回关闭文案（与 SEMANTIC_FALLBACK 同族但独立）。 */
export function drillEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.KNJ_OBSIDIAN_DRILL ?? '').toLowerCase() !== 'off'
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  if (n <= 0) return fallback
  return Math.min(n, max)
}

function tierOf(page: WikiPage | null | undefined): WikiTier {
  return normalizeTier(page?.tier)
}

function tierWeight(tier: WikiTier): number {
  return TIER_WEIGHT[tier] ?? 1
}

function degreeBonus(degree: number): number {
  return Math.min(degree * DEGREE_STEP, MAX_DEGREE_BONUS)
}

function head(text: string): string {
  return text.length > MAX_SNIPPET ? `${text.slice(0, MAX_SNIPPET)}…` : text
}

// ---------- 邻接索引（复用 buildGraph：入链在 lint.ts / graph-engine.ts 已各算过一份，不再造第三份） ----------

interface Adjacency {
  graph: GraphData
  byId: Map<string, { category: WikiCategory; title: string; confidence: Confidence }>
  out: Map<string, string[]>
  inc: Map<string, string[]>
  broken: Map<string, string[]>
  degree: Map<string, number>
}

function adjacencyOf(store: VaultStore): Adjacency {
  const graph = buildGraph(store)
  const byId = new Map<string, { category: WikiCategory; title: string; confidence: Confidence }>()
  for (const n of graph.nodes) byId.set(n.id, { category: n.category, title: n.title, confidence: n.confidence })

  const out = new Map<string, string[]>()
  const inc = new Map<string, string[]>()
  const broken = new Map<string, string[]>()
  const outSeen = new Map<string, Set<string>>()
  const inSeen = new Map<string, Set<string>>()

  for (const e of graph.edges) {
    if (e.broken) {
      const list = broken.get(e.source) ?? []
      if (!list.includes(e.target)) list.push(e.target)
      broken.set(e.source, list)
      continue
    }
    const o = outSeen.get(e.source) ?? new Set<string>()
    if (!o.has(e.target)) { o.add(e.target); out.set(e.source, [...(out.get(e.source) ?? []), e.target]) }
    outSeen.set(e.source, o)
    const i = inSeen.get(e.target) ?? new Set<string>()
    if (!i.has(e.source)) { i.add(e.source); inc.set(e.target, [...(inc.get(e.target) ?? []), e.source]) }
    inSeen.set(e.target, i)
  }

  const degree = new Map<string, number>()
  for (const n of graph.nodes) degree.set(n.id, (out.get(n.id)?.length ?? 0) + (inc.get(n.id)?.length ?? 0))
  return { graph, byId, out, inc, broken, degree }
}

function neighborOf(
  store: VaultStore,
  adj: Adjacency,
  id: string,
  direction: 'out' | 'in',
  via: string,
): DrillNeighbor {
  const meta = adj.byId.get(id)
  const page = meta ? store.readPage(id, meta.category) : undefined
  const tier = tierOf(page)
  const degree = adj.degree.get(id) ?? 0
  return {
    id,
    category: meta?.category ?? 'concepts',
    title: meta?.title ?? id,
    tier,
    direction,
    broken: !meta,
    degree,
    via,
    matchedBy: 'graph-neighbor',
    // 邻居分数：度加权 × tier 权重，与 retriever 的 scoreOf 同口径（基础分取 0，因为它的价值来自"被链到"）
    score: degreeBonus(degree) * tierWeight(tier),
  }
}

function neighborsFor(
  store: VaultStore,
  adj: Adjacency,
  id: string,
  via: string,
  opts: { limit: number; direction: 'out' | 'in' | 'both' },
): { items: DrillNeighbor[]; more: number } {
  const outgoing = opts.direction === 'in' ? [] : (adj.out.get(id) ?? [])
  const incoming = opts.direction === 'out' ? [] : (adj.inc.get(id) ?? [])
  const brokenOut = opts.direction === 'in' ? [] : (adj.broken.get(id) ?? [])

  const items: DrillNeighbor[] = []
  const seen = new Set<string>()
  for (const target of outgoing) {
    if (seen.has(target)) continue
    seen.add(target)
    items.push(neighborOf(store, adj, target, 'out', via))
  }
  for (const source of incoming) {
    if (seen.has(source)) continue
    seen.add(source)
    items.push(neighborOf(store, adj, source, 'in', via))
  }
  for (const ghost of brokenOut) {
    if (seen.has(ghost)) continue
    seen.add(ghost)
    items.push(neighborOf(store, adj, ghost, 'out', via))
  }

  items.sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id))
  return { items: items.slice(0, opts.limit), more: Math.max(0, items.length - opts.limit) }
}

// ---------- 种子融合 ----------

interface SeedDraft {
  id: string
  category: WikiCategory
  matchedBy: string
  sources: string[]
  snippet: string
  rrf: number
  candidate?: RetrievalCandidate
}

/**
 * 名次级 RRF 融合：两路各自按名次贡献 1/(60+rank)，同页累加。
 * 为什么用排名级而不是分数加权：词面分是 0–13 的自定义分、语义分是 QMD 的融合分数，
 * 两者量纲不可比，加权和等于把不可比的分相加（D4）。
 */
export function fuseSeedRanks(
  word: readonly RetrievalCandidate[],
  semantic: readonly { id: string; category: WikiCategory }[],
): SeedDraft[] {
  const drafts = new Map<string, SeedDraft>()
  const push = (id: string, category: WikiCategory, channel: string, rank: number, extra: Partial<SeedDraft>) => {
    const gain = 1 / (RRF_K + rank)
    const hit = drafts.get(id)
    if (hit) {
      hit.rrf += gain
      if (!hit.sources.includes(channel)) hit.sources.push(channel)
      if (!hit.candidate && extra.candidate) {
        hit.candidate = extra.candidate
        hit.matchedBy = extra.matchedBy ?? hit.matchedBy
        hit.snippet = extra.snippet ?? hit.snippet
      }
      return
    }
    drafts.set(id, {
      id,
      category,
      matchedBy: extra.matchedBy ?? 'semantic',
      sources: [channel],
      snippet: extra.snippet ?? '',
      rrf: gain,
      candidate: extra.candidate,
    })
  }

  word.forEach((c, i) => push(c.id, c.category, c.matchedBy, i + 1, { candidate: c, matchedBy: c.matchedBy, snippet: c.snippet }))
  semantic.forEach((s, i) => push(s.id, s.category, 'semantic', i + 1, { matchedBy: 'semantic', snippet: '' }))
  return [...drafts.values()]
}

// ---------- 模式 A：query 入口 ----------

export async function drillQuery(
  store: VaultStore,
  query: string,
  opts: DrillQueryOptions = {},
): Promise<DrillResult> {
  const seedLimit = clamp(opts.limit, DEFAULT_SEED_LIMIT, MAX_SEED_LIMIT)
  const neighborLimit = clamp(opts.neighbors, DEFAULT_NEIGHBOR_LIMIT, MAX_NEIGHBOR_LIMIT)
  const q = query.trim()
  if (!q) {
    return { mode: 'query', strategy: 'empty-query', seeds: [], totalPages: store.listPagesReadonly().length, message: '查询为空：请给出检索词或自然语言问题。' }
  }

  const word = retrieve(store, q, { maxCandidates: opts.maxCandidates ?? 20 })
  const adj = adjacencyOf(store)

  const semanticStatus: DrillSemanticStatus = opts.semantic ? (opts.semanticStatus ?? 'ready') : 'disabled'
  const semanticHits: { id: string; category: WikiCategory; snippet?: string }[] = []
  let semanticUsed = false

  if (opts.semantic && semanticStatus !== 'index-empty') {
    try {
      const raw = await opts.semantic.search(q, { limit: opts.semanticLimit ?? seedLimit })
      if (Array.isArray(raw)) {
        for (const hit of raw) {
          if (hit && typeof hit.id === 'string' && hit.category && RETRIEVAL_CATEGORIES.includes(hit.category)) {
            semanticHits.push({ id: hit.id, category: hit.category, ...(hit.snippet ? { snippet: hit.snippet } : {}) })
            continue
          }
          if (hit && typeof hit.path === 'string') {
            for (const mapped of mapHitsToPages(store.wikiRoot, [{ path: hit.path }])) semanticHits.push(mapped)
          }
        }
        semanticUsed = semanticHits.length > 0 || semanticStatus === 'ready'
      }
    } catch {
      // 语义层任何失败都只降级，绝不抛出（与 semantic.ts 的契约一致）
      semanticUsed = false
    }
  }

  const drafts = fuseSeedRanks(word.candidates, semanticHits)
  const order = new Map(drafts.map((d, i) => [d.id, i]))
  const scored = drafts
    .map((d) => {
      const candidate = d.candidate
      const meta = adj.byId.get(d.id)
      const page = candidate ? undefined : (meta ? store.readPage(d.id, meta.category) : undefined)
      const tier = normalizeTier(candidate?.tier ?? page?.tier)
      const degree = adj.degree.get(d.id) ?? 0
      return { draft: d, candidate, page, meta, tier, degree, score: d.rrf * (1 + degreeBonus(degree)) * tierWeight(tier) }
    })
    .filter((s) => s.candidate || s.page)
    .sort((a, b) => (b.score - a.score) || ((order.get(a.draft.id) ?? 0) - (order.get(b.draft.id) ?? 0)))

  const truncatedSeeds = scored.length > seedLimit
  let truncatedNeighbors = false
  const seeds: DrillSeed[] = scored.slice(0, seedLimit).map((s) => {
    const nb = neighborsFor(store, adj, s.draft.id, s.draft.id, { limit: neighborLimit, direction: 'both' })
    if (nb.more > 0) truncatedNeighbors = true
    const category = s.candidate?.category ?? s.meta?.category ?? s.draft.category
    return {
      page: `${category}/${s.draft.id}.md`,
      id: s.draft.id,
      category,
      title: s.candidate?.title ?? s.meta?.title ?? s.draft.id,
      confidence: s.candidate?.confidence ?? s.meta?.confidence ?? 'extracted',
      tier: s.tier,
      source: s.candidate?.source ?? s.page?.source ?? '',
      snippet: s.candidate?.snippet ?? s.draft.snippet ?? (s.page ? head(s.page.body) : ''),
      score: s.score,
      matchedBy: s.draft.candidate?.matchedBy ?? 'semantic',
      sources: s.draft.sources,
      neighbors: nb.items,
    }
  })

  const parts = [word.strategy]
  if (semanticUsed) parts.push('semantic')
  parts.push('graph-neighbor')

  return {
    mode: 'query',
    strategy: parts.join('+'),
    seeds,
    totalPages: word.totalPages,
    ...(truncatedSeeds || truncatedNeighbors ? { truncated: { seeds: truncatedSeeds, neighbors: truncatedNeighbors } } : {}),
    ...(drillMessage(semanticStatus, opts.semanticDegraded) ? { message: drillMessage(semanticStatus, opts.semanticDegraded) } : {}),
    semantic: { status: semanticStatus, ...(opts.semanticDegraded ? { degraded: opts.semanticDegraded } : {}) },
  }
}

/** 降级/未完备用语：一律如实说清"这次是基于什么给出的结果"。 */
function drillMessage(status: DrillSemanticStatus, degraded?: string): string | undefined {
  const notes: string[] = []
  if (status === 'disabled') notes.push('语义检索未启用（本次仅词面通道）；如需语义召回请调用 wiki_search_semantic 或检查索引。')
  if (status === 'index-stale') notes.push('语义层基于旧索引，可能漏掉最近新增或修改的页；建议先更新索引再检索。')
  if (status === 'index-empty') notes.push('语义索引为空，本次仅词面结果；可先在边栏点「更新索引」。')
  if (status === 'model-missing') notes.push('语义检索未就绪：缺少本地嵌入模型（插件不会自动下载，也不会联网）。')
  if (status === 'library-missing') notes.push('语义检索不可用：进程内 QMD 库未能加载；本次仅词面结果。')
  if (degraded) notes.push(degraded)
  return notes.length > 0 ? notes.join(' ') : undefined
}

// ---------- 模式 B：page 入口（纯图，零嵌入、毫秒级） ----------

export function drillPage(store: VaultStore, id: string, opts: DrillPageOptions = {}): DrillResult {
  const neighborLimit = clamp(opts.neighbors, DEFAULT_NEIGHBOR_LIMIT, MAX_NEIGHBOR_LIMIT)
  const direction = opts.direction ?? 'both'
  const words = id?.trim() ?? ''
  const pages = store.listPagesReadonly()
  if (!words) {
    return { mode: 'page', strategy: 'empty-id', seeds: [], totalPages: pages.length, message: 'page 为空：请给出页面 id（可先用 wiki_query 或 wiki_drill 的 query 模式找 id）。' }
  }

  const found = opts.category
    ? pages.filter((p) => p.id === words && p.category === opts.category)
    : pages.filter((p) => p.id === words)
  if (found.length === 0) {
    return {
      mode: 'page',
      strategy: 'unknown-id',
      seeds: [],
      totalPages: pages.length,
      message: `页面 id 不存在：${words}。请先用 wiki_query 或 wiki_drill 的 query 模式找到真实 id（本工具不做模糊匹配）。`,
    }
  }

  const adj = adjacencyOf(store)
  let truncatedNeighbors = false
  const seeds: DrillSeed[] = found.map((p) => {
    const page = store.readPage(p.id, p.category)
    const tier = tierOf(page)
    const degree = adj.degree.get(p.id) ?? 0
    const nb = neighborsFor(store, adj, p.id, p.id, { limit: neighborLimit, direction })
    if (nb.more > 0) truncatedNeighbors = true
    return {
      page: `${p.category}/${p.id}.md`,
      id: p.id,
      category: p.category,
      title: page?.title ?? p.title,
      confidence: page?.confidence ?? 'extracted',
      tier,
      source: page?.source ?? '',
      snippet: head(page?.body ?? ''),
      score: degreeBonus(degree) * tierWeight(tier),
      matchedBy: 'graph',
      sources: ['graph'],
      neighbors: nb.items,
    }
  })

  const empty = seeds[0].neighbors.length === 0
  return {
    mode: 'page',
    strategy: `graph-neighbor:${direction}`,
    seeds,
    totalPages: pages.length,
    ...(truncatedNeighbors ? { truncated: { seeds: false, neighbors: true } } : {}),
    // 条件展开而非 message: undefined —— 宿主网关的 isJsonValue 把 undefined 判为非法 JSON 值，
    // 整条工具输出会被拒（value is not lossless JSON）。无话可说时字段必须「不存在」。
    ...(empty ? { message: '该页在库内没有任何双链（可能是孤儿页）：没有出链也没有入链可下钻。' } : {}),
  }
}

// ---------- wiki_read：整页 + 摘要 + 出入链清单 ----------

export interface PageDetail {
  page: string
  id: string
  category: WikiCategory
  title: string
  tier: WikiTier
  confidence: Confidence
  summary: string
  body: string
  outLinks: string[]
  brokenLinks: string[]
  inLinks: string[]
}

export function readPageDetail(store: VaultStore, id: string, category?: WikiCategory): PageDetail | null {
  const words = id?.trim() ?? ''
  if (!words) return null
  const pages = store.listPagesReadonly()
  const found = category ? pages.find((p) => p.id === words && p.category === category) : pages.find((p) => p.id === words)
  if (!found) return null
  const page = store.readPage(found.id, found.category)
  if (!page) return null

  const outLinks = [...new Set(linkedPages(store, found.id, found.category))]
  const adj = adjacencyOf(store)
  return {
    page: `${found.category}/${found.id}.md`,
    id: found.id,
    category: found.category,
    title: page.title,
    tier: tierOf(page),
    confidence: page.confidence,
    summary: page.summary ?? '',
    body: page.body,
    outLinks,
    brokenLinks: outLinks.filter((t) => !adj.byId.has(t)),
    inLinks: [...new Set(adj.inc.get(found.id) ?? [])],
  }
}
