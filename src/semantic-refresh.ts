// src/semantic-refresh.ts — 语义索引的「新鲜度」：自动/手动刷新 + 只读状态视图。
//
// 设计约束：
// 1) 严格离线：只在模型本地就位时才跑；缺模型只回报，不联网、不报错。
// 2) 单飞（single-flight）：同一库同时只允许一次刷新，重复调用复用同一个 promise。
// 3) 后台化：刷新在后台跑（真实库冷启动 ~1.5 分钟、稳态 ~40ms/篇），调用方拿到的是
//    「已开始/进行中」而不是阻塞到结束；进度靠 status() 轮询（读 sqlite 的待嵌入数在下降）。
// 4) 不抛异常：任何失败都变成结果里的 note，交给 UI/agent 如实展示。
import { join } from 'node:path'
import {
  classifyStatus, createSemanticRuntime, notReadyMessage, pendingEmbeddingCount, resolveStateHome,
  DEFAULT_MODEL_FILENAME,
  type SemanticState,
  type SemanticStatusRaw,
  type SemanticStore,
} from './semantic-index.ts'

export interface SemanticRuntimeView {
  status: SemanticState
  modelPath: string
  modelPresent: boolean
  store: SemanticStore | null
  /** 库加载失败时的真实底层错误（见 SemanticRuntime.loadError）：界面要如实带出，不能只给猜测。 */
  loadError?: string
}

export interface RefreshRunResult {
  ok: boolean
  at: string
  documents: number
  chunks: number
  durationMs: number
  /** 失败/跳过原因（如实回报，不吞）。 */
  note?: string
}

export interface SemanticStatusView {
  available: boolean
  modelPresent: boolean
  indexState: SemanticState
  documents: number
  pendingEmbedding: number
  hasVectorIndex: boolean
  refreshing: boolean
  startedAt?: string
  elapsedMs?: number
  /** 本进程内实测的一次冷启动耗时（首次刷新），用于 UI estimtate。 */
  coldStartMs?: number
  lastRun?: RefreshRunResult
  note?: string
}

export interface RefresherOptions {
  vaultRoot: string
  home?: string
  /** 自动刷新的 debounce（合并连续写入）。 */
  debounceMs?: number
  /** 自动刷新上限：待嵌入超过它就不自动跑，只回报（避免一次大批入库偷偷占满 CPU 很久）。 */
  maxAutoDocs?: number
  /** 测试注入点：替换真实运行时创建。 */
  runtimeFactory?: (opts: { vaultRoot: string; home?: string }) => Promise<SemanticRuntimeView>
  now?: () => number
}

export interface Refresher {
  schedule(reason?: string): void
  refreshNow(): Promise<RefreshRunResult>
  status(): Promise<SemanticStatusView>
  dispose(): void
}

export const DEFAULT_DEBOUNCE_MS = 15_000
export const DEFAULT_MAX_AUTO_DOCS = 500

/** 把 qmd 状态喂给纯函数分类器，返回 {indexState, documents, pendingEmbedding, hasVectorIndex}。 */
export function summarizeStatus(raw: SemanticStatusRaw | undefined): {
  indexState: SemanticState
  documents: number
  pendingEmbedding: number
  hasVectorIndex: boolean
} {
  const value = raw ?? {}
  return {
    indexState: classifyStatus(value),
    documents: value.totalDocuments ?? value.documents ?? 0,
    pendingEmbedding: pendingEmbeddingCount(value),
    hasVectorIndex: value.hasVectorIndex ?? (value.embeddings !== undefined),
  }
}

export function createRefresher(opts: RefresherOptions): Refresher {
  const now = opts.now ?? (() => Date.now())
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const maxAutoDocs = opts.maxAutoDocs ?? DEFAULT_MAX_AUTO_DOCS
  const runtimeFactory = opts.runtimeFactory
    ?? ((o: { vaultRoot: string; home?: string }) => createSemanticRuntime(o))

  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<RefreshRunResult> | null = null
  let startedAtMs: number | null = null
  let lastRun: RefreshRunResult | undefined
  let coldStartMs: number | undefined
  let disposed = false

  async function run(): Promise<RefreshRunResult> {
    const startedMs = now()
    startedAtMs = startedMs
    const at = new Date().toISOString()
    const runtime = await runtimeFactory({ vaultRoot: opts.vaultRoot, home: opts.home })
    const paths = resolveStateHome(opts.home)
    if (!runtime.modelPresent) {
      return {
        ok: false, at, documents: 0, chunks: 0, durationMs: now() - startedMs,
        note: notReadyMessage('model-missing', paths.modelsDir, DEFAULT_MODEL_FILENAME),
      }
    }
    if (!runtime.store) {
      return {
        ok: false, at, documents: 0, chunks: 0, durationMs: now() - startedMs,
        note: notReadyMessage('library-missing'),
      }
    }

    const store = runtime.store
    try {
      await store.update()
      const embedded = await store.embed() as { docsProcessed?: number; chunksEmbedded?: number } | undefined
      const durationMs = now() - startedMs
      if (coldStartMs === undefined) coldStartMs = durationMs
      return {
        ok: true, at,
        documents: embedded?.docsProcessed ?? 0,
        chunks: embedded?.chunksEmbedded ?? 0,
        durationMs,
      }
    } catch (error) {
      return {
        ok: false, at, documents: 0, chunks: 0, durationMs: now() - startedMs,
        note: `刷新失败：${error instanceof Error ? error.message : String(error)}`,
      }
    } finally {
      try { await store.close?.() } catch { /* 关闭失败不影响结果 */ }
    }
  }

  function refreshNow(): Promise<RefreshRunResult> {
    if (running) return running
    const promise = run()
      .then((result) => { lastRun = result; return result })
      .catch((error) => {
        const fallback: RefreshRunResult = {
          ok: false, at: new Date().toISOString(), documents: 0, chunks: 0, durationMs: 0,
          note: `刷新异常：${error instanceof Error ? error.message : String(error)}`,
        }
        lastRun = fallback
        return fallback
      })
      .finally(() => {
        running = null
        startedAtMs = null
      })
    running = promise
    return promise
  }

  async function fire(): Promise<void> {
    timer = null
    const view = await status()
    if (view.pendingEmbedding > maxAutoDocs) {
      lastRun = {
        ok: false, at: new Date().toISOString(), documents: 0, chunks: 0, durationMs: 0,
        note: `待嵌入 ${view.pendingEmbedding} 篇，超过自动刷新上限 ${maxAutoDocs} 篇：已跳过自动刷新，请在边栏点「更新索引」。`,
      }
      return
    }
    await refreshNow()
  }

  function schedule(): void {
    if (disposed) return
    // 关掉自动刷新（仍可用边栏「更新索引」手动跑）：KNJ_OBSIDIAN_AUTO_REFRESH=off
    if ((process.env.KNJ_OBSIDIAN_AUTO_REFRESH ?? '').trim().toLowerCase() === 'off') return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { void fire() }, debounceMs)
    // 后台任务不阻止宿主退出
    if (typeof timer.unref === 'function') timer.unref()
  }

  async function status(): Promise<SemanticStatusView> {
    const base = {
      available: false,
      modelPresent: false,
      indexState: 'index-empty' as SemanticState,
      documents: 0,
      pendingEmbedding: 0,
      hasVectorIndex: false,
      refreshing: running !== null,
      ...(startedAtMs === null ? {} : { startedAt: new Date(startedAtMs).toISOString(), elapsedMs: now() - startedAtMs }),
      ...(coldStartMs === undefined ? {} : { coldStartMs }),
      ...(lastRun === undefined ? {} : { lastRun }),
    }

    let runtime: SemanticRuntimeView | null = null
    try {
      runtime = await runtimeFactory({ vaultRoot: opts.vaultRoot, home: opts.home })
    } catch (error) {
      return { ...base, note: `语义状态读取失败：${error instanceof Error ? error.message : String(error)}` }
    }
    if (!runtime.modelPresent) {
      return { ...base, modelPresent: false, note: notReadyMessage('model-missing', resolveStateHome(opts.home).modelsDir, DEFAULT_MODEL_FILENAME) }
    }
    if (!runtime.store) {
      return { ...base, modelPresent: true, note: notReadyMessage('library-missing', undefined, undefined, runtime.loadError) }
    }

    try {
      const raw = await runtime.store.getStatus() as SemanticStatusRaw | undefined
      const summary = summarizeStatus(raw)
      return { ...base, available: true, modelPresent: true, ...summary }
    } catch (error) {
      return { ...base, modelPresent: true, note: `索引状态读取失败：${error instanceof Error ? error.message : String(error)}` }
    } finally {
      try { await runtime.store.close?.() } catch { /* 关闭失败不影响状态 */ }
    }
  }

  function dispose(): void {
    disposed = true
    if (timer) clearTimeout(timer)
    timer = null
  }

  return { schedule, refreshNow, status, dispose }
}

// ---------- 按库缓存（工具与路由共用同一个刷新器，保证单飞语义生效） ----------

const registry = new Map<string, Refresher>()

export function refresherFor(vaultRoot: string, home?: string): Refresher {
  const key = `${vaultRoot}::${home ?? ''}`
  const existing = registry.get(key)
  if (existing) return existing
  const created = createRefresher({ vaultRoot, home: home ?? undefined })
  registry.set(key, created)
  return created
}

export function disposeRefreshers(): void {
  for (const refresher of registry.values()) refresher.dispose()
  registry.clear()
}

/** 由 vault store 推出库根（.wiki 的父目录）。 */
export function vaultRootOf(store: { wikiRoot: string }): string {
  return join(store.wikiRoot, '..')
}
