// src/trigger.ts
// 任务级知识触发（L1）与回合级沉淀提醒（L5）。
//
// 为什么是「任务级」而不是「每次工具调用」：挂在 edit/write 前会让检索变成高频噪声
// （用户明确否掉了那个方案）。正确的锚点是——用户提出一件新事的时候，引入一次知识库。
//
// 匹配内核为什么不用 retrieve()：任务句长、分母大，占比天然偏低。
// 实测「怎么避免定时器在错误的时钟下工作」对含 cron 时区那页只共享一个 bigram，
// 占比接近 0 而被埋掉。所以这里改用「页面侧词表扫任务原文 + 绝对命中数」。
//
// 三条护栏（按优先级）：
//   1) 防自激循环：插件自己注入的提醒也是一条 user 消息，绝不能当成新任务（判据见 latestDirectUserTask）。
//   2) 宁可不说是第一原则：命中不足 / 空库 / 文本为空 → 一律返回空，一个字都不注入。
//   3) 只读：本模块不写 vault（唯一写入仍由 wiki_capture / wiki_ingest 承担）。
import type { VaultStore } from './vault-store.ts'
import type { WikiCategory, WikiPage } from './types.ts'

export interface TriggerCandidate {
  id: string
  category: WikiCategory
  title: string
  /** 页面 frontmatter 的 source：提醒里不展开，但保留以便追溯。 */
  source: string
  /** 命中的词表项（给模型一句「为什么提这一页」）。 */
  hits: string[]
  /** 排序分：2×标题命中数 + 1×标签命中数（仅内部用）。 */
  score: number
}

export interface MatchOptions {
  /** 最多返回几条（默认 3）。 */
  max?: number
}

/**
 * 加权命中门槛：≈「一个只在个别页出现的词」或「两三个中等词」。
 * 另有 MIN_TERMS 的条数门槛——实测单个词（小节标题里的「更新」）就说话是假阳性的主要来源。
 */
const MIN_SCORE = 1
const MIN_TERMS = 2
const DEFAULT_MAX = 3
/** 理由里最多列几个命中词。 */
const MAX_HITS_SHOWN = 4

const CJK_RUN = /^[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+$/
const ASCII_WORD = /[a-z0-9][a-z0-9_-]{2,}/g

/** 纯 CJK 连续串（与 retriever.tokenizeQuery 同一判据，保持两处语义一致）。 */
function isCjkRun(value: string): boolean {
  return CJK_RUN.test(value)
}

/** CJK 串的 2 字滑窗 bigram（无空格中文的唯一确定性拆法）。 */
function cjkBigrams(value: string): string[] {
  const chars = [...value]
  const out: string[] = []
  for (let i = 0; i + 1 < chars.length; i += 1) out.push(chars[i] + chars[i + 1])
  return out
}

/** 页面侧词表：标签 + 标题词 + **正文小节标题词**（`## Cron 时区被强制成 UTC` 这类）。 */
export function lexiconOf(page: Pick<WikiPage, 'title' | 'tags' | 'body'>): {
  tags: string[]
  terms: string[]
  headingTerms: string[]
} {
  const tags = (page.tags ?? []).map((t) => t.toLowerCase()).filter((t) => t.length > 0)
  const terms = extractTerms(page.title ?? '')
  const headingTerms = headingLines(page.body ?? '').flatMap(extractTerms)
  return { tags, terms: [...new Set([...terms, ...tags])], headingTerms: [...new Set(headingTerms)] }
}

/** 一段文本 → 词表项（ASCII 词 ≥3 字 + CJK 2 字滑窗）。 */
function extractTerms(text: string): string[] {
  const lower = text.toLowerCase()
  const out: string[] = []
  for (const match of lower.matchAll(ASCII_WORD)) out.push(match[0])
  for (const part of lower.split(/[^a-z0-9\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af_-]+/)) {
    if (isCjkRun(part)) out.push(...cjkBigrams(part))
  }
  return out.filter((t) => [...t].length >= 2)
}

/** 正文里的一级～六级小节标题行（去掉井号），语义密度远高于正文散文。 */
function headingLines(body: string): string[] {
  const out: string[] = []
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line)
    if (match) out.push(match[1])
  }
  return out
}

/** 词权重按文档频率衰减：只在个别页面出现的词才有区分度，泛词（如到处都有的 dsh）趋近 0。 */
function weightOf(df: number): number {
  if (df <= 1) return 1
  if (df === 2) return 0.7
  if (df <= 5) return 0.4
  return 0.15
}

/**
 * 小节标题词的折扣：标题/标签是人工策展的强信号，小节标题却是写作者随手起的
 * （实测「更新」「问题」这类结构性词会造成假阳性），因此只算六成。
 */
const HEADING_ONLY_DISCOUNT = 0.6

/**
 * 用页面侧词表扫任务原文，返回相关页（按分降序、同分按 id 升序，保证可复现）。
 *
 * 打分 = Σ 命中词权重（按文档频率衰减）。命中不足 / 文本为空 / 空库 → 空数组：
 * 静默是默认行为，不是异常。
 */
export function matchTaskPages(
  store: VaultStore,
  taskText: string,
  opts: MatchOptions = {},
): TriggerCandidate[] {
  const text = (taskText ?? '').toLowerCase()
  if (text.trim().length === 0) return []
  const max = opts.max ?? DEFAULT_MAX

  // 第一遍：装载页面并统计词频（决定每个词的区分度）
  const pages: Array<{
    ref: { id: string; category: WikiCategory }
    page: WikiPage
    terms: string[]
    headingOnly: Set<string>
  }> = []
  const docFreq = new Map<string, number>()
  for (const ref of store.listPagesReadonly()) {
    const page = store.readPage(ref.id, ref.category)
    if (!page) continue
    const { tags, terms, headingTerms } = lexiconOf(page)
    const all = [...new Set([...terms, ...tags, ...headingTerms])]
    // 只出现在小节标题里的词（标题/标签里没有）→ 打折
    const headingOnly = new Set(headingTerms.filter((t) => !terms.includes(t)))
    pages.push({ ref, page, terms: all, headingOnly })
    for (const term of all) docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
  }

  // 第二遍：按权重累加命中（小节标题词打六折）
  const out: TriggerCandidate[] = []
  for (const entry of pages) {
    const matched = entry.terms.filter((t) => text.includes(t))
    const weightOfTerm = (t: string): number => {
      const base = weightOf(docFreq.get(t) ?? 1)
      return entry.headingOnly.has(t) ? base * HEADING_ONLY_DISCOUNT : base
    }
    const score = matched.reduce((sum, t) => sum + weightOfTerm(t), 0)
    // 精度门槛：至少要命中 2 个词，且加权分不低——单个词就说话是假阳性的主要来源
    if (matched.length < MIN_TERMS || score < MIN_SCORE) continue
    // 命中词按权重降序展示，理由更有信息量
    const hits = [...matched]
      .sort((a, b) => weightOfTerm(b) - weightOfTerm(a) || (a < b ? -1 : 1))
      .slice(0, MAX_HITS_SHOWN)
    out.push({
      id: entry.ref.id,
      category: entry.ref.category,
      title: entry.page.title,
      source: entry.page.source,
      hits,
      score,
    })
  }
  return out
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, max))
}

/** L1 的提醒文案：给路径、给理由、给「可以忽略」的出口（它不是门禁）。 */
export function renderTaskReminder(candidates: readonly TriggerCandidate[]): string {
  const lines = candidates.map((c) =>
    `- ${c.category}/${c.id}.md — ${c.title}（命中：${c.hits.join('、')}）`)
  return [
    `[知识库提示] 与本任务相关的页面（${candidates.length} 条）：`,
    ...lines,
    '建议动手前扫一眼；确认无关请忽略。',
  ].join('\n')
}

/** L5 的提醒文案：只在「用过库 + 改了代码 + 没写回」时出现。 */
export function renderCaptureReminder(): string {
  return [
    '[知识库提示] 本回合用过知识库、也改了代码，但没有写回。',
    '如果产生了可复用的结论或踩过的坑，考虑 wiki_capture（单页快速沉淀）或 wiki_ingest（批量整理）记一笔；没有则可忽略。',
  ].join('\n')
}

/** 开关：KNJ_OBSIDIAN_TRIGGER=off 时 L1/L5 全关（与 AUTO_REFRESH/SEMANTIC_FALLBACK 同族）。 */
export function triggerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.KNJ_OBSIDIAN_TRIGGER ?? '').trim().toLowerCase() !== 'off'
}

export interface SessionEventLike {
  type?: string
  seq?: number
  data?: {
    source?: { kind?: string }
    content?: Array<{ type?: string; text?: string }>
    name?: string
    arguments?: unknown
    text?: string
  }
}

function textOfEvent(event: SessionEventLike): string {
  const content = event.data?.content
  if (Array.isArray(content)) {
    return content.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('\n').trim()
  }
  return typeof event.data?.text === 'string' ? event.data.text.trim() : ''
}

/**
 * 最近一条**直接用户**任务（`user/message` 且 `source.kind === 'user'`）。
 * 判据对齐 dsh-doublecheck 的折叠逻辑：插件注入（kind: 'plugin:<name>'，会话格式 v4 起）、宿主注入的 AGENTS.md
 * （kind: 'agent-instructions'）、运行时上下文快照等一律不算任务——
 * 否则本插件注入的提醒会把自己再触发一次（自激循环）。
 */
export function latestDirectUserTask(
  events: readonly SessionEventLike[],
): { seq: number; text: string } | undefined {
  let found: { seq: number; text: string } | undefined
  for (const event of events ?? []) {
    if (event?.type !== 'user/message') continue
    if (event.data?.source?.kind !== 'user') continue
    const text = textOfEvent(event)
    if (text.length === 0) continue
    found = { seq: typeof event.seq === 'number' ? event.seq : 0, text }
  }
  return found
}

export interface TurnFacts {
  /** 本回合读过库（含 read/grep/glob 指向 .wiki，或调用了 wiki_query / wiki_search_semantic）。 */
  readVault: boolean
  /** 本回合改了库外的文件（改 .wiki 内的页面属于知识维护本身，不算）。 */
  mutatedOutside: boolean
  /** 本回合写回过库（wiki_capture / wiki_ingest）。 */
  wroteVault: boolean
}

const VAULT_READ_TOOLS = new Set(['read', 'grep', 'glob', 'read_image', 'wiki_query', 'wiki_search_semantic'])
const MUTATION_TOOLS = new Set(['edit', 'write', 'str_replace_editor'])
const VAULT_WRITE_TOOLS = new Set(['wiki_capture', 'wiki_ingest'])

function argsTextOf(event: SessionEventLike): string {
  const raw = event.data?.arguments
  if (raw === undefined || raw === null) return ''
  if (typeof raw === 'string') return raw
  try {
    return JSON.stringify(raw)
  } catch {
    return ''
  }
}

function pathOf(event: SessionEventLike): string {
  const raw = event.data?.arguments
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return ''
    }
  }
  if (parsed && typeof parsed === 'object') {
    const value = (parsed as Record<string, unknown>).file_path ?? (parsed as Record<string, unknown>).path
    if (typeof value === 'string') return value
  }
  return ''
}

/** 折叠一个回合的工具调用事实（纯函数；调用方决定回合边界）。 */
export function foldTurnFacts(events: readonly SessionEventLike[]): TurnFacts {
  const facts: TurnFacts = { readVault: false, mutatedOutside: false, wroteVault: false }
  for (const event of events ?? []) {
    if (event?.type !== 'tool/call') continue
    const name = event.data?.name ?? ''
    const argsText = argsTextOf(event)
    if (VAULT_READ_TOOLS.has(name)) {
      if (name.startsWith('wiki_') || /\.wiki/i.test(argsText)) facts.readVault = true
      continue
    }
    if (VAULT_WRITE_TOOLS.has(name)) {
      facts.wroteVault = true
      continue
    }
    if (MUTATION_TOOLS.has(name)) {
      const target = pathOf(event)
      if (!/\.wiki[\\/]/i.test(target)) facts.mutatedOutside = true
    }
  }
  return facts
}

/** L5 是否该说话：三者齐备才提醒（宁可不说是第一原则）。 */
export function shouldRemindCapture(facts: TurnFacts): boolean {
  return facts.readVault && facts.mutatedOutside && !facts.wroteVault
}

// ---------------------------------------------------------------------------
// cordis 接线：薄到只剩「取值 → 纯函数 → 注入」。
// 交付机制照 dsh-doublecheck：agent.inject(createUserMessage({...})) 把一条 user 消息
// 放进**下一步**的 inbox（inject → send(input, 'next-step', false)）。
// 它可见、不阻断、不改用户的流程——这是 L1/L5 的强度上限（remind 档）。
// ---------------------------------------------------------------------------

export interface TriggerDeps {
  /** 注入点：构造模型可见的提醒消息（默认懒加载宿主提供的 @deepseek-ai/dsh-llm）。 */
  createNotice?: (text: string, summary: string) => unknown
}

/** 触发层只需要 provider 的「当前库」读取能力。 */
export interface VaultProviderLike {
  currentReadonly?: () => VaultStore
  current?: () => VaultStore
}

interface SessionLike {
  snapshotEvents?: () => SessionEventLike[] | undefined
  events?: SessionEventLike[]
}

interface AgentLike {
  session?: unknown
  inject?: (input: unknown) => void
}

export interface TriggerHost {
  on(event: 'agent/pre-step', handler: (
    payload: { agent?: AgentLike },
    next: () => Promise<unknown>,
  ) => Promise<unknown>): unknown
  on(event: 'agent/turn-stopping', handler: (payload: { agent?: AgentLike }) => Promise<void>): unknown
}

interface TriggerState {
  /** 已处理过的直接用户任务 seq（同一个任务只匹配一次，任务内后续步骤不再重复匹配）。 */
  lastTaskSeq: number
  /** L5 每会话只提醒一次。 */
  captureReminded: boolean
  /** 回合事实折叠的水位线（只折叠新事件）。 */
  lastEventSeq: number
}

/** 会话事件快照：0.1.2-alpha.5+ 用 snapshotEvents()，更早用 .events（与 doublecheck 同探测）。 */
function sessionEventsOf(session: unknown): SessionEventLike[] {
  const s = session as SessionLike | null | undefined
  if (!s) return []
  if (typeof s.snapshotEvents === 'function') return s.snapshotEvents() ?? []
  return s.events ?? []
}

export function installTrigger(
  ctx: TriggerHost,
  provider: VaultProviderLike,
  deps: TriggerDeps = {},
): () => void {
  const states = new WeakMap<object, TriggerState>()

  const createNotice = deps.createNotice ?? (async (text: string, summary: string) => {
    // 变量说明符：@deepseek-ai/dsh-llm 是宿主提供的包（运行时由 profiles/node_modules 解析到），
    // 插件仓库里没有它的类型声明，写字面量会让 tsc 报找不到模块。
    const specifier = '@deepseek-ai/dsh-llm'
    const mod = await import(specifier) as { createUserMessage: (input: unknown) => unknown }
    // 来源必须写成 `plugin:<name>`：会话格式 v4 退回了裸的 `kind: 'plugin'` + `plugin` 组合，
    // 写入路径（codec 的 assertV4SourceRowAdmission）见到 kind === 'plugin' 会直接抛
    // `format v4 message requires a producer-owned source kind`；而这里 inject() 没有被 await，
    // 抛出会绕过下面的 try/catch 冒到 turn 上，UI 报「本轮运行失败」。
    // `plugin:<name>` 也正是 v3→v4 迁移给本插件历史行推导出的 kind，两代读回同一形状。
    return mod.createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin:dsh-knj-obsidian', form: 'notice', summary },
    })
  })

  function stateOf(session: unknown): TriggerState {
    const key = (session ?? {}) as object
    const existing = states.get(key)
    if (existing) return existing
    const created: TriggerState = { lastTaskSeq: -1, captureReminded: false, lastEventSeq: -1 }
    states.set(key, created)
    return created
  }

  /** 只读取当前库；不可用时返回 null（触发层是增益，不是依赖）。 */
  function currentVault(): VaultStore | null {
    try {
      const store = typeof provider.currentReadonly === 'function'
        ? provider.currentReadonly()
        : provider.current?.()
      return store ?? null
    } catch {
      return null
    }
  }

  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (!triggerEnabled() || agent?.inject === undefined) return decision
    try {
      const task = latestDirectUserTask(sessionEventsOf(agent.session))
      if (!task) return decision
      const state = stateOf(agent.session)
      if (state.lastTaskSeq === task.seq) return decision
      state.lastTaskSeq = task.seq // 同一任务只匹配一次（无论是否有命中）
      const store = currentVault()
      if (!store) return decision
      const hits = matchTaskPages(store, task.text)
      if (hits.length === 0) return decision
      agent.inject(await createNotice(renderTaskReminder(hits), '知识库提示'))
    } catch {
      // 触发层任何异常都不得影响主流程
    }
    return decision
  })

  ctx.on('agent/turn-stopping', async ({ agent }) => {
    if (!triggerEnabled() || agent?.inject === undefined) return
    try {
      const state = stateOf(agent.session)
      if (state.captureReminded) return
      const events = sessionEventsOf(agent.session)
      const fresh = events.filter((e) => (e.seq ?? 0) > state.lastEventSeq)
      state.lastEventSeq = events.reduce((max, e) => Math.max(max, e.seq ?? 0), state.lastEventSeq)
      if (!shouldRemindCapture(foldTurnFacts(fresh))) return
      state.captureReminded = true
      agent.inject(await createNotice(renderCaptureReminder(), '沉淀提醒'))
    } catch {
      // 同上
    }
  })

  // 监听随 ctx 生命周期卸载，无需额外清理
  return () => {}
}
