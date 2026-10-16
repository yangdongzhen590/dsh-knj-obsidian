// src/semantic-hits.ts
// 语义层的「按库取用」共享模块。
//
// 为什么单独成模块：语义运行时（qmd 嵌入 + 本地模型）原本只长在 tools.ts 里，而它有两个消费者——
//   - wiki_query / wiki_drill 的语义通道（tools.ts）
//   - L1 任务级触发在字面 0 命中时的兜底（trigger.ts）
// 触发层必须复用同一个「按库根缓存」的运行时：模型只加载一次；而且触发层**只接受已经热起来**的
// 运行时（冷启动几十秒，绝不能挂住 pre-step，见 requireWarm）。
//
// 开关与语义约束与旧实现逐字一致：`KNJ_OBSIDIAN_SEMANTIC_FALLBACK=off` 一律关闭（含触发层）。
// 只读：检索路径不建 collection、不触发索引、不下载模型。
import { basename } from 'node:path'
import {
  createSemanticRuntime, clampLimit, runOfflineSearch, collectionIdOf,
  type SemanticHit, type SemanticRuntime,
} from './semantic-index.ts'
import type { SemanticPageHit } from './retriever.ts'
import type { WikiCategory } from './types.ts'

/**
 * 语义兜底开关：`KNJ_OBSIDIAN_SEMANTIC_FALLBACK=off` 时完全关闭。
 * 与 `KNJ_OBSIDIAN_AUTO_REFRESH=off` 同族：单元测试与离线环境用它避免加载 300M 嵌入模型、
 * 不去碰用户真实的 ~/.dsh/qmd（模型冷启动一次就要几十秒，测试里不可接受）。
 */
export function semanticFallbackEnabled(): boolean {
  return (process.env.KNJ_OBSIDIAN_SEMANTIC_FALLBACK ?? '').trim().toLowerCase() !== 'off'
}

/** 创建语义运行时的可注入点（测试替换；默认真实实现，会读 ~/.dsh/qmd 与本地模型）。 */
export type SemanticRuntimeFactory = (root: string) => Promise<SemanticRuntime>

export const defaultSemanticRuntimeFactory: SemanticRuntimeFactory =
  (root) => createSemanticRuntime({ vaultRoot: root })

/**
 * 失败结论的复用窗口（毫秒）。窗口内复用同一次失败，窗外允许重试。
 *
 * 为什么需要这个窗口：**失败不是永久事实**。模型文件是用户手动放进 `<home>/.dsh/qmd/models`
 * 的、sqlite 句柄占用是瞬时的——而 `notReadyMessage('model-missing')` 对用户明确承诺过
 * 「放好后无需重启，再次检索即可自动加载」。旧实现把失败（含 `store: null`）也按库根**永久**缓存，
 * 这句承诺在 wiki_drill 与触发层（走按库缓存）上直接失效：一次瞬时失败 = 该进程内语义层全废，
 * 只有重启能恢复——这正是 2026-10-15 事故里「界面报 0 篇、重启就好了」的机制。
 *
 * 为什么不是「完全不缓存失败」：那会让每个回合都重试一次。窗口把重试成本压到每 30 秒最多一次，
 * 同时保住并发单飞（pending 期间一律复用同一个 Promise，绝不并发拉起两次模型）。
 * 环境变量 `KNJ_OBSIDIAN_SEMANTIC_RETRY_MS` 可覆盖（测试用它把窗口压到 0）。
 */
export const SEMANTIC_FAILURE_RETRY_MS = 30_000

function failureRetryMs(): number {
  const raw = Number(process.env.KNJ_OBSIDIAN_SEMANTIC_RETRY_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : SEMANTIC_FAILURE_RETRY_MS
}

interface SemanticRuntimeEntry {
  promise: Promise<SemanticRuntime | null>
  /** 还在加载中：期间一律复用（并发单飞，绝不并发拉起两次模型）。 */
  pending: boolean
  /** 拿到了可用的 store ⇒ 永久复用；否则只复用冷却窗内的结论。 */
  usable: boolean
  /** 结论落地时刻（冷窗判断基准）。 */
  settledAt: number
}

/** 按库根缓存的语义运行时（进程级；可用的模型只加载一次）。 */
const semanticRuntimes = new Map<string, SemanticRuntimeEntry>()
/** 已解析完成的运行时（同步可读的「热」判据源）。 */
const warmRuntimes = new Map<string, SemanticRuntime | null>()
/**
 * 工厂**抛错**时的真实原因（按库根记录）。
 * 为什么需要：工厂抛错这条路会把运行时降级成 null，而 null 上没有 loadError——
 * 报给用户的就只剩「猜一个原因」（见 SemanticRuntime.loadError 的说明）。
 * 正常的工厂（createSemanticRuntime）**从不抛错**（它内部兜住并返回带 loadError 的运行时），
 * 所以这张表只为注入式工厂与异常路径服务。
 */
const runtimeFactoryErrors = new Map<string, string>()

/** 取某库最近一次工厂抛错的原因（诊断用；成功或从未尝试则为 undefined）。 */
export function semanticRuntimeError(vaultRoot: string): string | undefined {
  return runtimeFactoryErrors.get(vaultRoot)
}

/** 取（或惰性创建）某库的语义运行时；失败绝不抛出。可用则永久复用，失败只复用冷却窗。 */
export function semanticRuntimeFor(
  vaultRoot: string,
  factory: SemanticRuntimeFactory = defaultSemanticRuntimeFactory,
): Promise<SemanticRuntime | null> {
  const cached = semanticRuntimes.get(vaultRoot)
  if (cached && (cached.pending || cached.usable || Date.now() - cached.settledAt < failureRetryMs())) {
    return cached.promise
  }
  const entry: SemanticRuntimeEntry = {
    promise: Promise.resolve(null),
    pending: true,
    usable: false,
    settledAt: Date.now(),
  }
  entry.promise = factory(vaultRoot)
    .catch((error) => {
      runtimeFactoryErrors.set(vaultRoot, error instanceof Error ? `${error.name}: ${error.message}` : String(error))
      return null
    })
    .then((runtime) => {
      entry.pending = false
      // 「可用」的判据是拿到了 store：模型缺失 / 库加载失败都算未就绪，必须允许之后再试。
      entry.usable = runtime?.store != null
      entry.settledAt = Date.now()
      if (entry.usable) runtimeFactoryErrors.delete(vaultRoot)
      warmRuntimes.set(vaultRoot, runtime)
      return runtime
    })
  semanticRuntimes.set(vaultRoot, entry)
  return entry.promise
}

/**
 * 同步取「已热」的运行时：**绝不触发创建/加载**。
 * 触发层用它当门——没热过就放弃语义兜底，宁可沉默也不把 pre-step 挂几十秒。
 */
export function warmSemanticRuntime(vaultRoot: string): SemanticRuntime | null {
  return warmRuntimes.get(vaultRoot) ?? null
}

/** 关闭并清空所有缓存的语义运行时（插件 dispose 时调用，避免 sqlite 句柄与模型常驻）。 */
export function disposeSemanticRuntimes(): void {
  for (const entry of semanticRuntimes.values()) {
    void entry.promise.then((runtime) => { try { runtime?.store?.close?.() } catch { /* 关闭失败不影响退出 */ } })
  }
  semanticRuntimes.clear()
  warmRuntimes.clear()
}

export interface SemanticHitsRequest {
  vaultRoot: string
  query: string
  limit: number
  factory?: SemanticRuntimeFactory
  /** true = 只接受已热的运行时（触发层用）；false/缺省 = 允许惰性加载（工具用）。 */
  requireWarm?: boolean
}

/**
 * 取语义原始命中。任何不可用/失败（开关关闭、模型缺失、库缺失、索引为空、后端抛错）
 * 都返回空数组 → 调用方保持纯词面结果，绝不抛错、不联网、不建索引。
 */
export async function semanticRawHits(request: SemanticHitsRequest): Promise<SemanticHit[]> {
  if (!semanticFallbackEnabled()) return []
  const limit = clampLimit(request.limit)
  // 检索必须限定到本库的 collection：索引库全局共享，不限定会返回别库页面（详见 runOfflineSearch）。
  const collection = collectionIdOf(request.vaultRoot)
  if (request.requireWarm) {
    const warm = warmSemanticRuntime(request.vaultRoot)
    return warm?.store ? searchWarm(warm.store, request.query, limit, collection) : []
  }
  const runtime = await semanticRuntimeFor(request.vaultRoot, request.factory ?? defaultSemanticRuntimeFactory)
  return runtime?.store ? searchWarm(runtime.store, request.query, limit, collection) : []
}

async function searchWarm(
  store: NonNullable<SemanticRuntime['store']>,
  query: string,
  limit: number,
  collection: string,
): Promise<SemanticHit[]> {
  try {
    const outcome = await runOfflineSearch(store, query, limit, collection)
    return outcome.results
  } catch {
    return []
  }
}

/** 语义命中 → 页面命中（给 retrieve() 融合用）。分类合法性由 retrieve() 的白名单兜底。 */
export function toSemanticPageHits(hits: readonly SemanticHit[]): SemanticPageHit[] {
  const out: SemanticPageHit[] = []
  for (const hit of hits) {
    if (!hit?.id || !hit.category) continue
    const category = hit.category as WikiCategory
    out.push(hit.snippet ? { id: hit.id, category, snippet: hit.snippet } : { id: hit.id, category })
  }
  return out
}

/** 语义命中 → 触发层候选（避免 trigger 直接依赖 semantic-index 的类型）。 */
export interface SemanticCandidateHint {
  id: string
  category: string
  score: number
  snippet: string
}

/** 语义原始命中 → 触发层候选（按 score 降序、截断到 limit）。 */
export function toCandidateHints(hits: readonly SemanticHit[], limit: number): SemanticCandidateHint[] {
  const out: SemanticCandidateHint[] = []
  for (const hit of hits) {
    if (!hit?.id || !hit.category) continue
    const score = typeof hit.score === 'number' && Number.isFinite(hit.score) ? hit.score : 0
    out.push({ id: hit.id, category: hit.category, score, snippet: typeof hit.snippet === 'string' ? hit.snippet : '' })
  }
  return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, Math.max(0, limit))
}

/** 未命中诊断日志里的「工作区」名（与旧实现同口径）。 */
export function workspaceNameOf(vaultRoot: string): string {
  return basename(vaultRoot)
}

// clampLimit 在此转出：调用方原本从 semantic-index 间接拿它，避免两处各写一遍截断规则。
export { clampLimit }
