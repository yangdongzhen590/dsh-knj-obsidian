// src/semantic-index.ts — 进程内本地语义检索（集成 QMD 库，不依赖全局 CLI/MCP，不联网）
//
// 设计要点：
// 1) 状态家目录固定 ~/.dsh/qmd（models/、index.sqlite、config.yml），模型按**绝对本地路径**配置；
//    创建 store 前把 XDG_CACHE_HOME 指向 <home>/.dsh（仅本进程），使 QMD 的模型目录正是 ~/.dsh/qmd/models。
// 2) 严格离线：模型缺失只回报精确路径与可选下载命令，绝不自动联网。
// 3) 只索引七个正式分类（天然排除 _system/、_raw/、wiki-export/、.manifest.json）；索引文件不进 vault。
// 4) 惰性动态 import('@tobilu/qmd')：库缺失时给可执行的降级答案，不影响既有关键词检索。
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_MODEL_FILENAME = 'embeddinggemma-300M-Q8_0.gguf'
/** 与 QMD 默认一致的上游仓库（文件名相同）；仅作为人工下载提示，不会被插件自动使用。 */
export const MODEL_DOWNLOAD_URL = 'https://hf-mirror.com/ggml-org/embeddinggemma-300M-GGUF/resolve/main/embeddinggemma-300M-Q8_0.gguf'
export const FORMAL_CATEGORIES = ['concepts', 'entities', 'references', 'synthesis', 'projects', 'dictionaries', 'tables'] as const
export const DEFAULT_LIMIT = 8
export const MAX_LIMIT = 20

export interface StateHomePaths { root: string; modelsDir: string; dbPath: string; configPath: string }

export function resolveStateHome(home: string = homedir()): StateHomePaths {
  const root = join(home, '.dsh', 'qmd')
  return { root, modelsDir: join(root, 'models'), dbPath: join(root, 'index.sqlite'), configPath: join(root, 'config.yml') }
}

export function resolveModelPath(home: string = homedir(), filename: string = DEFAULT_MODEL_FILENAME): string {
  return join(resolveStateHome(home).modelsDir, filename)
}

/** 本地模型发现：存在返回绝对路径，否则 undefined（调用方据此给出“未就绪”答案）。 */
export function findModel(home: string = homedir(), filename: string = DEFAULT_MODEL_FILENAME): string | undefined {
  const path = resolveModelPath(home, filename)
  return existsSync(path) ? path : undefined
}

/** 每个库一个集合：path = <vault>/.wiki，pattern 只匹配七个正式分类。 */
export function buildCollectionConfig(vaultRoot: string, collectionId?: string) {
  const id = collectionId ?? `${vaultRoot.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'vault'}-wiki`
  return {
    collections: {
      [id]: {
        path: join(vaultRoot, '.wiki'),
        pattern: `{${FORMAL_CATEGORIES.join(',')}}/**/*.md`,
      },
    },
  }
}

export function clampLimit(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(n), MAX_LIMIT)
}

export interface SemanticHit { id: string; category: string; title: string; snippet: string; score?: number }

const FORMAL_CATEGORY_SET: ReadonlySet<string> = new Set(FORMAL_CATEGORIES)

/**
 * 结果记录 → vault 内相对路径。
 * 实测 QMD 命中字段：`displayPath`（如 probe-wiki/concepts/rate-limiting.md）、
 * `filepath`（qmd://<collection>/concepts/rate-limiting.md URI）、`docid`（**内容哈希**，不是页面 id）。
 * 因此按 displayPath → path → filepath → file 取值，并剥掉 qmd://<collection>/ 前缀。
 * docid 绝不参与：它是哈希，拿来当 id 会给出无意义的「页面」。
 */
export function recordRelPath(record: Record<string, unknown>): string {
  const raw = record.displayPath ?? record.path ?? record.filepath ?? record.file ?? ''
  let text = String(raw).replace(/\\/g, '/')
  if (text.startsWith('qmd://')) {
    const rest = text.slice('qmd://'.length)
    const slash = rest.indexOf('/')
    text = slash >= 0 ? rest.slice(slash + 1) : rest
  }
  return text.replace(/^\/+/, '')
}

/**
 * 相对路径 → { id, category }。
 * 只接受 <category>/<file>.md 且分类属于七个正式目录：_system/（会话归档）、wiki-export/、
 * _raw/ 等内部位置即便被索引命中也不会成为检索结果。
 */
export function pageRefOf(relPath: string): { id: string; category: string } | undefined {
  const parts = relPath.split('/').filter(Boolean)
  if (parts.length < 2) return undefined
  const file = parts[parts.length - 1] ?? ''
  const category = parts[parts.length - 2] ?? ''
  if (!FORMAL_CATEGORY_SET.has(category)) return undefined
  if (!file.toLowerCase().endsWith('.md')) return undefined
  const id = file.slice(0, -3)
  return id ? { id, category } : undefined
}

/** frontmatter 里的 title（QMD 只回文件名主干，正式标题在正文头部）。 */
function frontmatterTitle(body: unknown): string | undefined {
  if (typeof body !== 'string' || !body.startsWith('---')) return undefined
  const end = body.indexOf('\n---', 3)
  const head = body.slice(3, end < 0 ? body.length : end)
  const matched = /^title:[ \t]*(.+)$/m.exec(head)
  if (!matched) return undefined
  const title = (matched[1] ?? '').trim().replace(/^["']|["']$/g, '')
  return title.length > 0 ? title : undefined
}

/** 片段来源：QMD 命中没有 snippet 字段，正文在 body（或混合检索的 bestChunk）。 */
function snippetOf(record: Record<string, unknown>): string {
  if (typeof record.snippet === 'string' && record.snippet.trim().length > 0) return record.snippet.trim()
  if (typeof record.bestChunk === 'string' && record.bestChunk.trim().length > 0) return record.bestChunk.trim()
  const body = typeof record.body === 'string' ? record.body : ''
  if (body.length === 0) return ''
  const stripped = body.startsWith('---')
    ? body.slice(Math.max(0, body.indexOf('\n---', 3)) + 4)
    : body
  return stripped.replace(/\s+/g, ' ').trim()
}

/** 去重键：<category>/<id>（同一页面在不同通道里的路径写法可能不同，但推导出的页面引用一致）。 */
export function recordKey(record: Record<string, unknown>): string {
  const ref = pageRefOf(recordRelPath(record))
  return ref ? `${ref.category}/${ref.id}` : ''
}

/**
 * 结果整形：只保留有界字段；id/category 由路径推导（非正式分类/非 .md 一律丢弃）；
 * 标题优先取 frontmatter title；score 缺失时保持 undefined（不编造）。
 */
export function shapeSearchResults(raw: ReadonlyArray<Record<string, unknown>>, limit: number): SemanticHit[] {
  const out: SemanticHit[] = []
  for (const r of raw) {
    if (out.length >= limit) break
    if (!r || typeof r !== 'object') continue
    const ref = pageRefOf(recordRelPath(r))
    if (!ref) continue
    const score = typeof r.score === 'number' ? r.score : undefined
    out.push({
      id: ref.id,
      category: ref.category,
      title: frontmatterTitle(r.body) ?? (String(r.title ?? '').trim() || ref.id),
      snippet: snippetOf(r).slice(0, 400),
      ...(score === undefined ? {} : { score }),
    })
  }
  return out
}

export type SemanticState = 'ready' | 'index-empty' | 'index-stale'
/**
 * 索引状态分类。注意 QMD 的 `getStatus()` 真实返回是
 * `{ totalDocuments, needsEmbedding, hasVectorIndex, collections[] }`（**不是** documents/embeddings），
 * 因此以 totalDocuments / needsEmbedding / hasVectorIndex 为准，同时兼容旧的 documents/embeddings 形态。
 */
export function classifyStatus(status: {
  documents?: number
  embeddings?: number
  totalDocuments?: number
  needsEmbedding?: number
  hasVectorIndex?: boolean
}): SemanticState {
  const documents = status.totalDocuments ?? status.documents ?? 0
  if (documents <= 0) return 'index-empty'
  const needsEmbedding = status.needsEmbedding ?? 0
  if (needsEmbedding > 0) return 'index-stale'
  const embeddings = status.embeddings
  if (typeof embeddings === 'number' && embeddings < documents) return 'index-stale'
  if (status.hasVectorIndex === false) return 'index-stale'
  return 'ready'
}

/** 待嵌入篇数（用于「索引陈旧」的可执行提示）。 */
export function pendingEmbeddingCount(status: {
  documents?: number
  embeddings?: number
  totalDocuments?: number
  needsEmbedding?: number
}): number {
  if (typeof status.needsEmbedding === 'number') return Math.max(0, status.needsEmbedding)
  const documents = status.totalDocuments ?? status.documents ?? 0
  const embeddings = status.embeddings ?? documents
  return Math.max(0, documents - embeddings)
}

export type NotReadyReason = 'model-missing' | 'library-missing'

/** 未就绪答案：给出可执行信息，绝不静默联网。 */
export function notReadyMessage(reason: NotReadyReason, modelsDir?: string, filename: string = DEFAULT_MODEL_FILENAME): string {
  if (reason === 'library-missing') {
    return '语义检索不可用：进程内 QMD 库（@tobilu/qmd）未能加载——未安装，或其原生依赖在本机不可用；该库随插件安装，无需单独安装/启动 QMD。'
      + '请改用关键词检索 wiki_query（L1–L4 分层检索仍然可用），或重装插件后再试。'
  }
  const dir = modelsDir ?? resolveStateHome().modelsDir
  return `语义检索未就绪：缺少本地嵌入模型 ${filename}。`
    + `请把模型文件放到 ${dir}\\${filename}（插件不会自动下载，也不会联网）。`
    + `可选手动下载：${MODEL_DOWNLOAD_URL} 。放好后无需重启，再次检索即可自动加载。`
}

/**
 * 禁用 QMD 的云端模型：把查询扩展（generate）与精排（rerank）指向本地**不存在**的路径。
 * 依据：这两个模型的默认值是 hf: 云端 URI，而 node-llama-cpp 的 resolveModelFile 在文件缺失时
 * 会直接联网下载（见 node_modules/@tobilu/qmd/dist/llm.js 注释 “resolveModelFile handles HF URIs
 * and downloads to the cache dir”）。指向本地后，任何误用都只是一次本地失败，绝不产生网络请求。
 */
export function offlineModelPins(modelsDir: string): { generate: string; rerank: string } {
  return {
    generate: join(modelsDir, 'DISABLED-query-expansion.gguf'),
    rerank: join(modelsDir, 'DISABLED-rerank.gguf'),
  }
}

/** 记录 → 稳定去重键：见文件上方的 recordKey（<category>/<id>）。 */

/**
 * 多通道融合（RRF）：每个通道按名次贡献 1/(60+rank)，按融合分数降序取前 limit 条。
 * 同一页面只出现一次（保留首次出现的记录字段），score = 融合分数（越大越相关，非概率）。
 */
export function fuseRanked(
  channels: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>,
  limit: number,
): Array<Record<string, unknown>> {
  const RRF_K = 60
  const merged = new Map<string, { record: Record<string, unknown>; score: number }>()
  for (const list of channels) {
    let rank = 0
    for (const record of list) {
      if (!record || typeof record !== 'object') continue
      rank += 1
      const key = recordKey(record)
      if (!key) continue
      const gain = 1 / (RRF_K + rank)
      const hit = merged.get(key)
      if (hit) hit.score += gain
      else merged.set(key, { record, score: gain })
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit))
    .map((entry) => ({ ...entry.record, score: entry.score }))
}

export interface OfflineSearchOutcome {
  results: SemanticHit[]
  /** 通道降级说明（有则必须如实回报给调用方）。 */
  degraded?: string
  channels: { vector: number; lexical: number }
}

/**
 * 严格离线的检索通道组合：向量（本地嵌入模型）+ BM25（无需模型），本地 RRF 融合。
 * 刻意**不使用** store.search() 的混合检索——那会拉起查询扩展与精排两个云端模型。
 * 任一通道失败都降级并如实说明，绝不抛异常。
 */
export async function runOfflineSearch(store: SemanticStore, query: string, limit: number): Promise<OfflineSearchOutcome> {
  const notes: string[] = []
  let vector: ReadonlyArray<Record<string, unknown>> = []
  let lexical: ReadonlyArray<Record<string, unknown>> = []

  try {
    vector = (await store.searchVector?.(query, { limit })) ?? []
  } catch (error) {
    notes.push(`向量通道不可用，已降级为关键词通道：${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    lexical = (await store.searchLex?.(query, { limit })) ?? []
  } catch (error) {
    if (notes.length === 0) notes.push(`关键词通道失败：${error instanceof Error ? error.message : String(error)}`)
  }

  const lists = [vector, lexical].filter((list) => list.length > 0)
  const results = shapeSearchResults(lists.length > 1 ? fuseRanked(lists, limit) : (lists[0] ?? []), limit)
  return {
    results,
    ...(notes.length > 0 ? { degraded: notes.join('；') } : {}),
    channels: { vector: vector.length, lexical: lexical.length },
  }
}

/**
 * 进程环境版的离线模型配置（键名即 QMD 读取的环境变量）。
 * 为什么必须设：QMD 的**分块**路径（`chunkDocumentByTokens` → `getDefaultLlamaCpp()` → `llm.tokenize()`）
 * 走的是**模块级单例**，它不读我们传给 `createStore` 的 config，只认 env / 默认值。
 * 不设 env 时单例会去解析默认的 `hf:` 云端模型并在缺失时联网下载——实测表现为 embed 阶段
 * 无限等待（进程内存不涨、CPU 不动、模型从未加载）。
 */
export function offlineModelEnv(modelsDir: string, modelPath: string): Record<string, string> {
  const pins = offlineModelPins(modelsDir)
  return { QMD_EMBED_MODEL: modelPath, QMD_GENERATE_MODEL: pins.generate, QMD_RERANK_MODEL: pins.rerank }
}

/** 把离线模型配置写进当前进程环境（幂等；只影响本进程，宿主重启即消失）。 */
export function applyOfflineModelEnv(models: { embed: string; generate: string; rerank: string }): void {
  process.env.QMD_EMBED_MODEL = models.embed
  process.env.QMD_GENERATE_MODEL = models.generate
  process.env.QMD_RERANK_MODEL = models.rerank
}

/** QMD `getStatus()` 的松散形态（真实字段 + 兼容旧字段）。 */
export interface SemanticStatusRaw {
  documents?: number
  embeddings?: number
  totalDocuments?: number
  needsEmbedding?: number
  hasVectorIndex?: boolean
  collections?: ReadonlyArray<Record<string, unknown>>
}

export interface SemanticStore {
  /**
   * QMD 的混合检索（BM25 + 向量 + **LLM 查询扩展** + RRF + **LLM 精排**）。
   * 本插件**不调用**：扩展模型默认 hf:tobil/qmd-query-expansion-1.7B、精排模型默认
   * hf:ggml-org/Qwen3-Reranker-0.6B，缺失时 node-llama-cpp 会自动联网下载。
   * 严格离线只用下面两个单通道方法（见 runOfflineSearch）。
   */
  search?(options: { query: string; limit?: number; rerank?: boolean }): Promise<ReadonlyArray<Record<string, unknown>>>
  /** 向量通道：只用本地嵌入模型。 */
  searchVector?(query: string, options?: { limit?: number }): Promise<ReadonlyArray<Record<string, unknown>>>
  /** 关键词通道（BM25）：完全不需要模型。 */
  searchLex?(query: string, options?: { limit?: number }): Promise<ReadonlyArray<Record<string, unknown>>>
  update(options?: Record<string, unknown>): Promise<unknown>
  embed(options?: Record<string, unknown>): Promise<unknown>
  getStatus(): Promise<SemanticStatusRaw> | SemanticStatusRaw
  getIndexHealth?(): unknown
  addCollection?(name: string, config: { path: string; pattern?: string }): unknown
  close?(): unknown
}

export interface SemanticRuntime {
  status: 'ready' | 'index-empty' | 'index-stale'
  modelPath: string
  modelPresent: boolean
  store: SemanticStore | null
  /** 索引计数（供工具如实回报「有几篇还没嵌入」；模型缺失时为 0）。 */
  index: { documents: number; pendingEmbedding: number; hasVectorIndex: boolean }
}

export interface CreateRuntimeOptions {
  vaultRoot: string
  home?: string
  /** 测试注入点：跳过真实库加载与模型检查。 */
  storeFactory?: (opts: { dbPath: string; config: unknown }) => Promise<SemanticStore>
  /** 测试注入点：强制“库缺失”。 */
  libraryUnavailable?: boolean
}

/**
 * 创建（或复用）当前库的语义检索运行时。库缺失/模型缺失都返回可诊断结果，不抛异常。
 */
export async function createSemanticRuntime(opts: CreateRuntimeOptions): Promise<SemanticRuntime> {
  const home = opts.home ?? homedir()
  const paths = resolveStateHome(home)
  const modelPath = resolveModelPath(home)
  const modelPresent = existsSync(modelPath)
  const emptyIndex = { documents: 0, pendingEmbedding: 0, hasVectorIndex: false }

  if (opts.libraryUnavailable) return { status: 'index-empty', modelPath, modelPresent, store: null, index: emptyIndex }
  try { mkdirSync(paths.modelsDir, { recursive: true }) } catch { /* 目录创建失败不影响后续诊断 */ }

  // 模型缺失时**不打开索引库**：未就绪路径零副作用（不 import 库、不建 sqlite、不留句柄），
  // 只把「该把模型放哪」如实告诉调用方。
  if (!modelPresent) return { status: 'index-empty', modelPath, modelPresent: false, store: null, index: emptyIndex }

  let store: SemanticStore
  // 本地嵌入模型（绝对路径）+ 云端模型禁用位：任何路径都不会触发 HF 下载
  const models = { ...offlineModelPins(paths.modelsDir), embed: modelPath }
  try {
    if (opts.storeFactory) {
      store = await opts.storeFactory({ dbPath: paths.dbPath, config: { ...buildCollectionConfig(opts.vaultRoot), models } })
    } else {
      // 仅本进程生效：让 QMD 的模型目录落在 <home>/.dsh/qmd/models，
      // 并把「本地模型 + 禁用位」写进进程环境——见 applyOfflineModelEnv 的原因说明。
      if (!process.env.XDG_CACHE_HOME) process.env.XDG_CACHE_HOME = join(home, '.dsh')
      applyOfflineModelEnv(models)
      // 变量说明符：@tobilu/qmd 是「可选 peer」（autoInstallPeers:false 下不随插件安装），
      // 插件仓库里没有它的类型声明，写字面量会让 tsc 报 TS2307 —— 与 trigger.ts 里
      // 加载宿主 @deepseek-ai/dsh-llm 的写法保持一致：运行时按需解析，缺失由下面的 catch 兜底。
      const qmdSpecifier = '@tobilu/qmd'
      const mod = await import(qmdSpecifier) as unknown as { createStore: (o: { dbPath: string; config: unknown }) => Promise<SemanticStore> }
      store = await mod.createStore({
        dbPath: paths.dbPath,
        config: {
          ...buildCollectionConfig(opts.vaultRoot),
          models,
        },
      })
    }
  } catch {
    return { status: 'index-empty', modelPath, modelPresent, store: null, index: emptyIndex }
  }

  let status: SemanticState = 'index-empty'
  let index = emptyIndex
  try {
    const raw = await store.getStatus()
    status = classifyStatus(raw ?? {})
    index = {
      documents: raw?.totalDocuments ?? raw?.documents ?? 0,
      pendingEmbedding: pendingEmbeddingCount(raw ?? {}),
      hasVectorIndex: raw?.hasVectorIndex ?? false,
    }
  } catch { /* 状态读取失败按空索引处理 */ }
  return { status, modelPath, modelPresent, store, index }
}
