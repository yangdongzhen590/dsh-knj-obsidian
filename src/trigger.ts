// src/trigger.ts
// 任务级知识触发（L1）与回合级沉淀提醒（L5），以及会话级库绑定（L0）。
//
// 为什么是「任务级」而不是「每次工具调用」：挂在 edit/write 前会让检索变成高频噪声
// （用户明确否掉了那个方案）。正确的锚点是——用户提出一件新事的时候，引入一次知识库。
//
// 匹配内核为什么不用 retrieve()：任务句长、分母大，占比天然偏低。
// 实测「怎么避免定时器在错误的时钟下工作」对含 cron 时区那页只共享一个 bigram，
// 占比接近 0 而被埋掉。所以这里改用「页面侧词表扫任务原文 + 绝对命中数」。
//
// L0（2026-09-28 新增）：本模块原先一律读 provider 的**全局当前库**，而那个值是宿主进程内存里的
// 单值——实测宿主内存与磁盘注册表已经不一致（内存 iobs_pro / 磁盘 tap-taste），于是「在 A 工作区
// 问 A 的事」会被 B 库的页面命中。现在按**会话**解析库根（session.header.cwd），只读、不写盘。
//
// 三条护栏（按优先级）：
//   1) 防自激循环：插件自己注入的提醒也是一条 user 消息，绝不能当成新任务（判据见 latestDirectUserTask）。
//   2) 宁可不说是第一原则：命中不足 / 空库 / 文本为空 → 一律返回空，一个字都不注入。
//   3) 只读：本模块不写 vault、不写注册表（唯一写入仍由 wiki_capture / wiki_ingest 承担）。
import { join, resolve } from 'node:path'
import type { VaultStore } from './vault-store.ts'
import type { WikiCategory, WikiPage } from './types.ts'
import { semanticRawHits, toCandidateHints } from './semantic-hits.ts'

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
  /** frontmatter `summary:`：一档提示用它替代「只有路径」——模型据此判断值不值得展开。 */
  summary?: string
  /** 命中来源：字面词表 / 语义兜底（如实标注，便于诊断「为什么提这一页」）。 */
  matchedBy?: 'lexical' | 'semantic'
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

/** 词表命中：命中项 + 权重降序的理由词（命中不足时返回 null）。 */
function lexicalHitsOf(
  taskText: string,
  entry: { terms: string[]; headingOnly: Set<string> },
  weightOfTerm: (term: string) => number,
): { hits: string[]; score: number } | null {
  const matched = entry.terms.filter((t) => taskText.includes(t))
  const score = matched.reduce((sum, t) => sum + weightOfTerm(t), 0)
  // 精度门槛：至少要命中 2 个词，且加权分不低——单个词就说话是假阳性的主要来源
  if (matched.length < MIN_TERMS || score < MIN_SCORE) return null
  const hits = [...matched]
    .sort((a, b) => weightOfTerm(b) - weightOfTerm(a) || (a < b ? -1 : 1))
    .slice(0, MAX_HITS_SHOWN)
  return { hits, score }
}

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
    const weightOfTerm = (t: string): number => {
      const base = weightOf(docFreq.get(t) ?? 1)
      return entry.headingOnly.has(t) ? base * HEADING_ONLY_DISCOUNT : base
    }
    const lex = lexicalHitsOf(text, entry, weightOfTerm)
    if (!lex) continue
    out.push({
      id: entry.ref.id,
      category: entry.ref.category,
      title: entry.page.title,
      source: entry.page.source,
      hits: lex.hits,
      score: lex.score,
      ...(entry.page.summary ? { summary: entry.page.summary } : {}),
      matchedBy: 'lexical',
    })
  }
  return out
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, max))
}

/** 语义兜底最多取几条（只取前两名：低于门槛的第三条只会稀释信噪比）。 */
const SEMANTIC_FALLBACK_LIMIT = 5
/** 语义兜底的入库门槛：低于它宁可不说不说（与字面门槛同精神）。 */
const SEMANTIC_MIN_SCORE = 0.35

/**
 * 字面 0 命中时的语义兜底（L1 一档的第二条通道）。
 *
 * 为什么需要它：任务句长、改写式提问与库内页面没有共享字面词，整条字面通道会 0 命中 → 完全沉默
 * （实测「怎么避免定时器在错误的时钟下工作」这类问法）。语义层能救回一部分。
 *
 * 为什么只接受**已热**的运行时：冷启动要加载本地 300M 模型（几十秒），挂在 pre-step 上会把
 * 模型调用拖死。没热过就放弃——首轮沉默，等某个 wiki 工具把运行时带热后自动生效。
 *
 * @returns 语义候选；开关关闭 / 未热 / 无模型 / 无索引 / 抛错 一律空数组
 */
export async function semanticFallbackCandidates(
  store: VaultStore,
  taskText: string,
  opts: MatchOptions = {},
): Promise<TriggerCandidate[]> {
  const text = (taskText ?? '').trim()
  if (text.length === 0) return []
  const max = opts.max ?? DEFAULT_MAX
  const root = vaultRootOfStore(store)
  if (!root) return []
  let hits: Awaited<ReturnType<typeof semanticRawHits>>
  try {
    hits = await semanticRawHits({ vaultRoot: root, query: text, limit: SEMANTIC_FALLBACK_LIMIT, requireWarm: true })
  } catch {
    return []
  }
  const out: TriggerCandidate[] = []
  for (const hint of toCandidateHints(hits, SEMANTIC_FALLBACK_LIMIT)) {
    if (hint.score < SEMANTIC_MIN_SCORE) continue
    const category = hint.category as WikiCategory
    const page = store.readPage(hint.id, category)
    if (!page) continue
    out.push({
      id: hint.id,
      category,
      title: page.title,
      source: page.source,
      // 语义命中没有「命中词」可展示，改列语义片段里的前几个词做理由（为空则不列）
      hits: semanticReasonOf(hint.snippet),
      score: hint.score,
      ...(page.summary ? { summary: page.summary } : {}),
      matchedBy: 'semantic',
    })
    if (out.length >= max) break
  }
  return out
}

/** 语义片段的理由词：取前若干 CJK 短语/ASCII 词，只为让提示里的「为什么提这一页」有据可查。 */
function semanticReasonOf(snippet: string): string[] {
  const terms = extractTerms((snippet ?? '').slice(0, 200))
  const seen: string[] = []
  for (const term of terms) {
    if (term.length < 2 || seen.includes(term)) continue
    seen.push(term)
    if (seen.length >= MAX_HITS_SHOWN) break
  }
  return seen
}

/** 库根：VaultStore 的只读属性（供触发层按库定位语义索引）。 */
function vaultRootOfStore(store: VaultStore): string {
  const value = (store as unknown as { wikiRoot?: unknown }).wikiRoot
  return typeof value === 'string' ? resolve(value) : ''
}

/** L1 一档的提醒文案：给路径、给理由、给**摘要**（不再只给路径），并留「可以忽略」的出口。 */
export function renderTaskReminder(candidates: readonly TriggerCandidate[]): string {
  const lines = candidates.map((c) => {
    const why = c.hits.length > 0 ? `（命中：${c.hits.join('、')}）` : ''
    const via = c.matchedBy === 'semantic' ? '［语义］' : ''
    const summary = c.summary?.trim() ? `\n  ${truncate(c.summary.trim(), 120)}` : ''
    return `- ${c.category}/${c.id}.md — ${c.title}${via}${why}${summary}`
  })
  return [
    `[知识库提示] 与本任务相关的页面（${candidates.length} 条）：`,
    ...lines,
    '建议动手前扫一眼；确认无关请忽略。',
  ].join('\n')
}

/** L1 二档的提醒文案：一档被忽略时才出现——直接把**正文**给模型，不再要求它自己去读。 */
export function renderStageTwoReminder(page: WikiPage, category: WikiCategory, id: string): string {
  return [
    `[知识库提示] 上一步给你的相关页面未被查看，直接给出正文（${category}/${id}.md — ${page.title}）：`,
    '',
    truncate(page.body ?? '', STAGE_TWO_BODY_LIMIT),
  ].join('\n')
}

/** 二档正文上限（字符数；≈1200 token 量级，是「一次提示」的预算帽）。 */
export const STAGE_TWO_BODY_LIMIT = 4800

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n…（已截断）`
}

/**
 * L5 的提醒文案：只在「用过库 + 改了代码 + 没写回」时出现。
 *
 * ⚠️ 为什么改成「征询」而不是「建议写回」（2026-10-13，实测驱动的修订）：
 * 旧文案写的是「考虑 wiki_capture / wiki_ingest 记一笔」，而真实会话日志显示，提醒之后模型
 * **自主**调用了 `wiki_capture`（随后还跑了 `wiki_lint` 自检）——把知识写进库这个动作，
 * 用户明确要求**必须由用户决定**（会话蒸馏是已预留的、由用户点击触发的正规通道）。
 * 因此这条提示的语义从「去做」改成「**先问用户**」，配合写入闸（见 gateWikiWrite）兜底：
 * 未经用户显式授权的写入会被拒绝。
 */
export function renderCaptureReminder(): string {
  return [
    '[知识库提示] 本回合用过知识库、也改了代码，可能产生了可复用的结论。',
    '⚠️ 不要自行写库。先**问用户**要不要沉淀这次结论；用户同意后，用 wiki_capture（单页）或 wiki_ingest（批量）写入；',
    '用户没同意就不要写。未经授权的写入会被拒绝。',
  ].join('\n')
}

/**
 * 开关：KNJ_OBSIDIAN_TRIGGER=off 时 L0/L1/L3/L5 全关（与 AUTO_REFRESH/SEMANTIC_FALLBACK 同族）。
 */
export function triggerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.KNJ_OBSIDIAN_TRIGGER ?? '').trim().toLowerCase() !== 'off'
}

/** L3 复发提醒开关：`KNJ_OBSIDIAN_TRIGGER_RECURRENCE=off` 关闭。默认开（噪声最低的一层）。 */
export function recurrenceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.KNJ_OBSIDIAN_TRIGGER_RECURRENCE ?? '').trim().toLowerCase() !== 'off'
}

/**
 * L1 二档开关：`KNJ_OBSIDIAN_TRIGGER_FULLTEXT=off` 时只留一档（提示但不追投正文）。
 * 默认开——「漏」是实测最痛的失败模式，二档正是它的直接对策。
 */
export function fullTextStageEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.KNJ_OBSIDIAN_TRIGGER_FULLTEXT ?? '').trim().toLowerCase() !== 'off'
}

export interface SessionEventLike {
  type?: string
  seq?: number
  data?: {
    source?: { kind?: string; plugin?: string; form?: string; summary?: string }
    content?: Array<{ type?: string; text?: string }>
    name?: string
    arguments?: unknown
    text?: string
    /** 回合号：宿主在 turn/step/tool 事件上都会带（见 dsh-session 的 SessionEventMap）。 */
    turn?: number
    /** `tool/result` 的模型可见结果（外层包一层 `{type:'tool-result', content:[{type:'text'}]}`）。 */
    message?: { content?: unknown }
  }
}

/**
 * 事件里的模型可见文本。
 *
 * `user/message` 是扁平结构（`content: [{type:'text',text}]`），但 **`tool/result` 包了一层**：
 * `message.content = [{ type:'tool-result', content: [{type:'text',text}] }]`（实测自真实会话日志；
 * 形状见 dsh-llm 的 ToolResultBlock）。早期实现只认顶层 `{type:'text'}`，于是对 tool/result 永远
 * 返回空串 → L3 的失败指纹通道**完全失效**（只剩宿主显式 error 那条路），而单测因为夹具形状不对
 * 一直保持绿色。这里两种形状都认。
 */
function textOfEvent(event: SessionEventLike): string {
  const content = event.data?.content
  if (Array.isArray(content)) {
    const direct = content.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('\n').trim()
    if (direct.length > 0) return direct
  }
  const nested = (event.data as { message?: { content?: unknown } } | undefined)?.message?.content
  if (Array.isArray(nested)) {
    const parts: string[] = []
    for (const block of nested) {
      if (!block || typeof block !== 'object') continue
      const inner = (block as { content?: unknown }).content
      if (!Array.isArray(inner)) continue
      for (const leaf of inner) {
        if (leaf && typeof leaf === 'object' && (leaf as { type?: string }).type === 'text') {
          const value = (leaf as { text?: unknown }).text
          if (typeof value === 'string') parts.push(value)
        }
      }
    }
    return parts.join('\n').trim()
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

function parsedArgsOf(event: SessionEventLike): Record<string, unknown> {
  const raw = event.data?.arguments
  if (raw === undefined || raw === null) return {}
  if (typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function pathOf(event: { data?: { name?: string; arguments?: unknown } }): string {
  const raw = event?.data?.arguments
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

/** 某条任务（按 seq）之后，会话是否碰过库——L2 的「本任务查过吗」。 */
export function consultedVaultSince(events: readonly SessionEventLike[], sinceSeq: number): boolean {
  for (const event of events ?? []) {
    if (typeof event?.seq === 'number' && event.seq < sinceSeq) continue
    if (event?.type !== 'tool/call') continue
    const name = event.data?.name ?? ''
    if (name.startsWith('wiki_')) return true
    if (VAULT_READ_TOOLS.has(name) && /\.wiki/i.test(argsTextOf(event))) return true
  }
  return false
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

/**
 * L1 二档判据（纯函数）：一档提过的那一页，模型是否真的看过。
 *
 * 只看**本回合**的工具调用（回合边界由宿主 turn 号给出，与 L5 同一口径）：
 *   - `read`/`grep`/`glob`/`read_image` 的目标路径指向 .wiki → 看过（任何页都算"去看了库"？）
 *   - `wiki_query` / `wiki_search_semantic` / `wiki_read` / `wiki_drill` → 看过
 * 特意**不要求**命中的正是那一页：模型顺着提示读了别的页也是「去查库」的行为，
 * 二档只在「读完提示后整个回合都没碰库」时才说话——这是最不容争议的忽略判据。
 */
export function foldHintOutcome(events: readonly SessionEventLike[]): { consultedVault: boolean } {
  let consultedVault = false
  for (const event of events ?? []) {
    if (event?.type !== 'tool/call') continue
    const name = event.data?.name ?? ''
    if (name.startsWith('wiki_')) { consultedVault = true; continue }
    if (!VAULT_READ_TOOLS.has(name)) continue
    if (/\.wiki/i.test(argsTextOf(event))) consultedVault = true
  }
  return { consultedVault }
}

/** L5 是否该说话：三者齐备才提醒（宁可不说是第一原则）。 */
export function shouldRemindCapture(facts: TurnFacts): boolean {
  return facts.readVault && facts.mutatedOutside && !facts.wroteVault
}

// ---------------------------------------------------------------------------
// L3: recurring-failure signal (same pitfall twice -> this time look it up)
//
// Why the SECOND occurrence, not the first: on the first failure the model is still
// exploring, and a hint there is noise. The same failure appearing again is hard
// evidence that the previous attempt did not work -- the cheapest high-value signal
// in this module (no semantics, no need for the vault to have content, no path guessing).
//
// Only FAILURE EVIDENCE counts, never the bare word "error" in a body: reading a source
// file that defines an error constant would match everywhere (real false-positive source).
//   a) the host marks a tool-level failure via tool/result error{name,code};
//   b) the result text carries a failure fingerprint (TS#### / Error: / ERR_* / [exit code: N]);
//   c) the result text has error/failed at the start of a line (a statement by the tool),
//      which excludes prose that merely mentions the word mid-sentence.
// ---------------------------------------------------------------------------

/**
 * L3 触发门槛：同一签名至少出现这么多次。
 *
 * 为什么是 3 而不是 2（2026-10-13 实测上调）：在真实开发会话里"同一个签名出现 2 次"太常见了
 * ——典型的 `edit` 失败一次、重读文件后成功；或边改边跑测试导致的两次断言失败。本会话实测
 * 门槛 2 会给出 **5 条**提示（其中 3 条计数正好是 2），而门槛 3 只给出 2 条真复发的。
 * 宁可不说是第一原则在此的落点：**第三次**才说明上一个办法确实没生效。
 */
export const RECURRENCE_THRESHOLD = 3
/** Fingerprint cap: longer tokens drag in paths/line numbers and stop matching across runs. */
const FAILURE_TOKEN_LIMIT = 140
/** How many recent failure events to fold (bounds the per-turn-stopping cost). */
const RECURRENCE_SCAN_LIMIT = 400

const FAILURE_PATTERNS: readonly RegExp[] = [
  /\berror\s+TS\d+\b/i, // TypeScript
  /\bERR_[A-Z_]+\b/, // Node error codes
  /\b[A-Za-z_]*Error\b\s*:/, // Error: / TypeError: / ToolTimeoutError: 这类运行时异常
]
/**
 * 执行类工具（只有它们的输出是「这次运行的诊断」）。`read` / `grep` / `glob` 返回的是
 * **被引用的文件内容**——正文里出现 error、甚至出现 `[exit code: N]` 字符串，都只是
 * "文件里写着这句话"，绝不是工具失败。实测踩到：`grep` 搜到 30 处匹配被旧判据当成一次失败。
 */
const EXECUTOR_TOOLS = new Set(['pwsh', 'bash', 'shell', 'run_code', 'exec'])
/** 「弱证据」只看输出开头这么长——足够覆盖 `[stderr]` 段与首行异常，又避开长正文里的引用。 */
const HEAD_WINDOW = 400

/**
 * 找出「活的」失败证据。判据分两档：
 *
 *   - **强证据**（不依赖工具名、不依赖退出码）：TS 错误码 / `ERR_xxx` / `Error:` 这类异常行，
 *     且必须出现在**输出开头**。为什么不依赖工具名：回连失败时工具名会退化成 `tool`，
 *     此时仍需能认；而"位置"已经足够区分——`grep`/`read` 的输出开头是 "Found N matches" 或
 *     引用的文件内容，引用里的错误字样几乎不会恰好落在开头。
 *   - **弱证据**：非零退出码，但**必须与强证据同时出现**才算。
 *
 * ⚠️ 退出码**单独不算**（2026-10-13 实测）：PowerShell 的 `... | Select-String ...` 会因为
 * 最后一个管道命令没匹配到而返回 1，宿主如实报 `[exit code: 1]`——于是「成功的命令」也带非零码。
 * 本会话里 7 条**不同**命令都因此带上退出码 1，把「同一个失败」计到 15 次。教训与旧版
 * 「行首 error/failed/失败」被骗是同一个：**不要把输出正文/流程产物当失败证据**。
 *
 * 代价：没有异常行也没有退出码的失败不再触发 L3（宁可不说是第一原则）。
 */
function liveFailureEvidence(text: string, executor: boolean): string | undefined {
  const head = text.slice(0, HEAD_WINDOW)
  for (const pattern of FAILURE_PATTERNS) {
    const match = pattern.exec(head)
    if (match) return match[0]
  }
  if (!executor) return undefined
  const code = /\[exit code:\s*(-?\d+)\]/i.exec(text)
  // 弱证据 = 非零退出码 **且** 输出开头出现错误词。用 [^\n]{0,24} 而不是 `^\s*`：
  // 实测 `[stderr] An error occurred: …` 这种带前缀的行会被 `^\s*(error|…)` 漏掉
  // （`[` 不是空白），而错误词紧跟在前缀之后仍属"开头"。
  if (code && Number(code[1]) !== 0 && /(?:^|\n)[^\n]{0,24}?(?:error|failed|失败|异常)/i.test(head)) {
    return '[exit code: #] ' + normalizeFailure(head.split('\n').find((l) => l.trim().length > 0) ?? '')
  }
  return undefined
}

/**
 * Failure signature of one tool result: `tool::command::error`.
 *
 * Measured against real session logs (2026-10-13): **`tool/result` carries no `name`**, so the tool
 * name must be recovered by joining `message.source.callId` back to its `tool/call`
 * (5/5 joins succeeded on the sample). Without joining, the signature degrades to `tool::…` and —
 * worse — five failures of five *different* commands all collapse into one `[exit code: #]`
 * signature, which destroys the very meaning of "second occurrence". Hence the command dig
 * in the middle: the same command failing the same way is a true recurrence; different
 * commands failing with the same exit code are not.
 *
 * @param event - a `tool/result` event
 * @param events - full session events (used to resolve the originating `tool/call`); omit to
 *                 degrade gracefully to `tool::command::`-less signatures
 * @returns the signature; undefined when there is no failure evidence
 */
export function failureSignatureOf(
  event: SessionEventLike,
  events?: readonly SessionEventLike[],
): string | undefined {
  if (event?.type !== 'tool/result') return undefined
  const joined = events ? callIndex(events).get(callIdOfResult(event)) : undefined
  const rawName = (event.data as { name?: unknown } | undefined)?.name
  const tool = joined?.name
    ?? (typeof rawName === 'string' && rawName.length > 0 ? rawName : 'tool')
  const command = joined?.fingerprint ? joined.fingerprint + '::' : ''

  // 宿主显式标记的工具级失败（形如 ToolTimeoutError）——最硬的证据，任何工具都认
  const explicit = (event.data as { error?: { name?: string; code?: string } } | undefined)?.error
  if (explicit && (explicit.name || explicit.code)) {
    return tool + '::' + command + normalizeFailure(String(explicit.name ?? '') + ' ' + String(explicit.code ?? ''))
  }
  const text = textOfEvent(event)
  if (text.length === 0) return undefined
  const evidence = liveFailureEvidence(text, EXECUTOR_TOOLS.has(tool))
  if (!evidence) return undefined
  return tool + '::' + command + normalizeFailure(evidence)
}

/** `tool/result` 回连 `tool/call` 的键（实测：message.source.callId，内层 block 也带 toolCallId）。 */
function callIdOfResult(event: SessionEventLike): string {
  const message = (event.data as { message?: { source?: { callId?: unknown }; content?: unknown } } | undefined)?.message
  const src = message?.source?.callId
  if (typeof src === 'string' && src.length > 0) return src
  const content = message?.content
  if (Array.isArray(content)) {
    for (const block of content) {
      const id = (block as { toolCallId?: unknown } | undefined)?.toolCallId
      if (typeof id === 'string' && id.length > 0) return id
    }
  }
  return ''
}

/** 工具入参里最像「做了什么」的那个字段（命令类优先；文件类退化为路径）。 */
const COMMAND_ARG_KEYS = ['command', 'cmd', 'script', 'code', 'query', 'pattern'] as const
const PATH_ARG_KEYS = ['file_path', 'path', 'notebook_path'] as const
/** 命令指纹长度上限（够区分命令，又不让签名爆长）。 */
const COMMAND_FINGERPRINT_LIMIT = 90

function commandFingerprintOf(args: unknown): string {
  let parsed = args
  if (typeof args === 'string') {
    try {
      parsed = JSON.parse(args)
    } catch {
      return normalizeFailure(args).slice(0, COMMAND_FINGERPRINT_LIMIT)
    }
  }
  if (!parsed || typeof parsed !== 'object') return ''
  const record = parsed as Record<string, unknown>
  for (const key of COMMAND_ARG_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return normalizeFailure(value).slice(0, COMMAND_FINGERPRINT_LIMIT)
    }
  }
  for (const key of PATH_ARG_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return normalizeFailure(value).slice(0, COMMAND_FINGERPRINT_LIMIT)
    }
  }
  return ''
}

/** callId → {工具名, 命令指纹}（`tool/call` 侧；回连用）。 */
function callIndex(events: readonly SessionEventLike[]): Map<string, { name: string; fingerprint: string }> {
  const out = new Map<string, { name: string; fingerprint: string }>()
  for (const event of events ?? []) {
    if (event?.type !== 'tool/call') continue
    const data = event.data as { callId?: unknown; name?: unknown; arguments?: unknown } | undefined
    const id = typeof data?.callId === 'string' ? data.callId : ''
    if (id.length === 0) continue
    out.set(id, {
      name: typeof data?.name === 'string' && data.name.length > 0 ? data.name : 'tool',
      fingerprint: commandFingerprintOf(data?.arguments),
    })
  }
  return out
}

/** Collapse whitespace and blank out bare numbers (line/port/duration differ every run). */
function normalizeFailure(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/\b\d+\b/g, '#').trim().slice(0, FAILURE_TOKEN_LIMIT)
}

/**
 * Failure-signature frequency over the whole session. Not sliced by turn on purpose:
 * recurrence is inherently cross-turn.
 *
 * @param events - session events (order-independent; only `tool/result` is read)
 * @returns signature -> occurrence count
 */
export function foldFailureFrequency(events: readonly SessionEventLike[]): Map<string, number> {
  const out = new Map<string, number>()
  let seen = 0
  for (let i = (events?.length ?? 1) - 1; i >= 0 && seen < RECURRENCE_SCAN_LIMIT; i -= 1) {
    const event = events[i]
    if (event?.type !== 'tool/result') continue
    seen += 1
    const signature = failureSignatureOf(event, events)
    if (!signature) continue
    out.set(signature, (out.get(signature) ?? 0) + 1)
  }
  return out
}

/**
 * 方案 A（2026-10-13 用户决策）：L3 说话前先确认**库里有相关页**。
 *
 * 为什么需要：判据收紧后 L3 认的都是真失败，但实测复发集中在「开发流程的正常试错」
 * （`edit` 未先读就编辑、边改边跑测试失败）——库里并没有解释这些失败的页面，
 * 「去查库」是无效建议，只会稀释提示的可信度。
 *
 * 判据是事实而非猜测：拿失败指纹当查询串，走与 L1 同一个词表内核检索一次库；
 * 无命中 → **沉默**（宁可不说是第一原则）。
 */
export function vaultCanHelp(store: VaultStore, signature: string): boolean {
  try {
    const hint = recurrenceHintOf(signature)
    if (hint.trim().length === 0) return false
    return matchTaskPages(store, hint, { max: 1 }).length > 0
  } catch {
    return false // 库不可读 → 沉默（触发层是增益，不是依赖）
  }
}

/** 只保留有信息量的字段/词，供 `vaultCanHelp` 当查询串（丢掉噪声重的部分）。 */
const HINT_STOPWORDS = new Set([
  'pwsh', 'bash', 'shell', 'exec', 'run_code', 'tool', 'edit', 'write', 'read', 'grep', 'glob',
  'exit', 'code', 'error', 'failed', 'fs', 'err', 'typeerror', 'syntaxerror', 'assertionerror',
  'fserror', 'scoped', 'errorconstructor', 'object', 'string',
])
/** 查询串的长度上限（够表达主题，又不至于把整条命令带进去）。 */
const HINT_TEXT_LIMIT = 120

export function recurrenceHintOf(signature: string): string {
  const parts = signature.split('::')
  const text = parts
    .flatMap((part) => part.split(/[^A-Za-z0-9_\u3400-\u4dbf\u4e00-\u9fff]+/))
    .map((t) => t.trim())
    // 长度门槛按字符类型区分：中文 2 字是**有意义的词**（bigram 本身就是 2 字），
    // 而 ASCII 需要 ≥3 才算词——早年一刀切用 `>= 3` 会把「时区」这种词直接砍掉，
    // 于是查询串只剩半截词表、命中数不足（`MIN_TERMS = 2`）→ 库里有页也判成无关（实测踩到）。
    .filter((t) => t.length >= (CJK_CHAR.test(t) ? 2 : 3) && !HINT_STOPWORDS.has(t.toLowerCase()))
    .slice(0, 8)
    .join(' ')
  return mergeCjkTokens(text).slice(0, HINT_TEXT_LIMIT)
}

/** 中文/日文/韩文字符（判定上面那条按类型区分的长度门槛）。 */
const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/

/**
 * 把相邻的中文词粘回一个连续串（`定时 任务` → `定时任务`）。
 *
 * 为什么必须粘：`matchTaskPages` 对无空格中文走 **2 字滑窗 bigram**。若中文词之间留空格，
 * 查询串会变成一串互不相干的 2 字窗口，只剩个别词与页面重合 → 命中数不足（`MIN_TERMS = 2`）
 * → 明明库里有那页也被判成无关（2026-10-13 实测：hint `cron 定时 任务 时区` 命中数不足）。
 * ASCII 词之间仍保留空格（英文需要分词）。
 */
function mergeCjkTokens(text: string): string {
  // 含中文 → 整体不加空格：`matchTaskPages` 的 bigram 滑窗会覆盖所有相邻字对，
  // 于是「时区」「定时」「任务」各自都能作为 2 字窗口出现（加了空格反而在词边界切断）。
  // 纯 ASCII → 保留空格（英文需要分词）。
  if (/[\u3400-\u4dbf\u4e00-\u9fff]/.test(text)) return text.replace(/\s+/g, '')
  return text
}

/**
 * Failures that deserve a hint: at/over the threshold and not yet hinted this session.
 *
 * @param events - session events
 * @param alreadyHinted - signatures already hinted in this session
 * @returns signatures, most frequent first
 */
export function recurringFailures(
  events: readonly SessionEventLike[],
  alreadyHinted: ReadonlySet<string>,
): string[] {
  const counts = foldFailureFrequency(events)
  const out: string[] = []
  for (const [signature, count] of counts) {
    if (count < RECURRENCE_THRESHOLD) continue
    if (alreadyHinted.has(signature)) continue
    out.push(signature)
  }
  return out.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || (a < b ? -1 : 1))
}

/** L3 每回合最多注入几条（复发通常一次一个；上限只防极端会话刷屏）。 */
export const RECURRENCE_INJECT_LIMIT = 2

/** L2 的摘要（去重键；warn 档每任务每路径最多一次）。 */
export const GATE_SUMMARY = '改动前提示'

/** 写入闸提醒的摘要（去重键；每会话一次）。 */
export const WRITE_GATE_SUMMARY = '写入闸提示'

/** L3 summary prefix; the full signature is folded into a short hash (summaries are redisplayed). */
export const RECURRENCE_SUMMARY_PREFIX = '复发提示'

/**
 * Short deterministic hash (FNV-1a) used to keep the injected summary bounded:
 * failure signatures can be ~140 chars, and the summary is a redisplayed log field.
 *
 * @param value - text to hash
 * @returns 8-char hex digest
 */
function shortHash(value: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** L3 的摘要（去重键；签名折成短哈希，保证摘要字段长度有界）。 */
export function recurrenceSummaryOf(signature: string): string {
  return RECURRENCE_SUMMARY_PREFIX + '#' + shortHash(signature)
}

/** L3 提醒文案：给事实（出现了几次、哪个工具、哪条命令）+ 给出口（查库/说明无关）。 */export function renderRecurrenceReminder(signature: string, count: number): string {
  const parts = signature.split('::')
  const tool = parts[0] || 'tool'
  const command = parts[1] ?? ''
  const error = parts.slice(2).join('::')
  return [
    '[知识库提示] 同一个失败在本会话已出现 ' + count + ' 次：',
    '  工具：' + tool + (command ? '（' + command + '）' : ''),
    '  失败：' + error,
    '上一次的办法显然没生效。建议用 wiki_query / wiki_search_semantic 检索这个错误，或 wiki_read 读相关页；',
    '若确认与知识库无关（是个新问题），照常继续即可。',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// L2: the conjunction gate on tools/pre-execute
//
// Trigger = NOT consulted this task  AND  the target path is high risk.
// It is a conjunction, not a per-edit counter: the rejected first design was
// "query on every edit" (1719 vault mutations vs 151 reads in the baseline).
//
// Where "high risk" comes from (why L2 depends on L0): the most reliable source is the
// vault itself -- a path mentioned by at least two different pages is exactly the kind of
// shared knowledge worth stopping for. With no vault the set degrades to the tiny
// hardcoded list below, and a hardcoded-only gate is what got rejected, so we keep that
// list deliberately minimal. A vault that does not resolve to this session contributes
// NOTHING (this is why L0 had to land first).
//
// Intensity ladder: off (default) / warn (inject a reminder, then allow) / block
// (deny with a reason; the model can retry explicitly). `warn` is the code path we ship
// enabled; `block` exists for the tiny hardcoded set only and stays opt-in.
// ---------------------------------------------------------------------------

/** L2 intensity. */
export type GateMode = 'off' | 'warn' | 'block'

/**
 * L2 开关：`KNJ_OBSIDIAN_GATE=warn` 才启用（默认 off）。
 *
 * 为什么默认 off：L2 是唯一会**打断**的一层。L1 的三层都在解决「库里有货但没查」，
 * L2 解决的是「漏了之后别造成损失」——是兜底，不是主药。兜底的强度必须等 L1 的
 * 实测数据出来再定，否则等于拿拦截去掩盖一个根本没修好的检索问题。
 */
export function gateModeOf(env: Record<string, string | undefined> = process.env): GateMode {
  const raw = (env.KNJ_OBSIDIAN_GATE ?? '').trim().toLowerCase()
  if (raw === 'warn' || raw === 'block') return raw
  return 'off'
}

/**
 * 硬编码的高危集：**刻意极小**。只放「改错了很难回滚、且一定值得先查一查库」的类别。
 * 其余高危判定交给库内路径（见 highRiskPathsFromVault）。
 *
 * 注意字符类里的分隔符必须写成 `[\\/]` 之外的两种显式形式——`[\\/]` 只表示正斜杠，
 * Windows 路径（本插件的主战场）会全部漏判。实测踩过。
 */
const SEP = '[\\\\/]'
const HIGH_RISK_PATTERNS: readonly RegExp[] = [
  new RegExp('(?:^|' + SEP + ')migrations?' + SEP, 'i'), // 数据库迁移
  new RegExp('(?:^|' + SEP + ')\\.github' + SEP + 'workflows' + SEP, 'i'), // CI 流水线
  new RegExp('(?:^|' + SEP + ')(?:Dockerfile|docker-compose\\.ya?ml)$', 'i'),
  new RegExp('(?:^|' + SEP + ')(?:deploy|release|publish)[.\\-_' + '\\\\/]', 'i'), // 部署/发布
  new RegExp('(?:^|' + SEP + ')(?:AGENTS|CLAUDE|SKILL)\\.md$', 'i'), // agent 指令文件
  new RegExp('(?:^|' + SEP + ')auth(?:entication|orization)?[.\\-_' + '\\\\/]', 'i'), // 鉴权
]

/** 一个路径是否命中硬编码高危集。 */
export function isHardcodedHighRisk(target: string): boolean {
  const value = (target ?? '').trim()
  if (value.length === 0) return false
  return HIGH_RISK_PATTERNS.some((p) => p.test(value))
}

/** 库内路径的最低页数门槛：至少两页提到才算「库里公认的高危点」，一页提到太偶然。 */
export const VAULT_PATH_MIN_PAGES = 2
/** 每库最多记住多少条高危路径（防极端库把集合撑大）。 */
const VAULT_PATH_LIMIT = 64

/**
 * 从正文里抽出的候选路径。
 *
 * 第二个模式必须是**字符类 + 贪婪 + 回退**，不能写成 `(?:\.[A-Za-z0-9_-]+[\\/]){1,}` 那种
 * 「固定段重复」：那样 `src/core/` 会被整段吃掉，结尾只剩 `ts`，而结尾要求字母/数字开头 → 匹配失败
 * （实测 `src/core/engine.ts` 一个都抽不出来）。字符类版本会自然回退到最后一个 `/`。
 */
const PATH_PATTERNS: readonly RegExp[] = [
  /[A-Za-z]:\\[^\s:*?"<>|\r\n]+?\.[A-Za-z0-9]{1,8}/g,
  /[A-Za-z0-9_][A-Za-z0-9_.\-\\/]*\/[A-Za-z0-9_.\-]+/g,
]

/**
 * 从库内页面抽取「被多页提到的路径」（高风险集的主要来源）。
 * 纯函数、只读；路径按**小写归一化**后计数，返回规范化集合。
 */
export function highRiskPathsFromVault(store: VaultStore): Set<string> {
  const counts = new Map<string, number>()
  try {
    for (const ref of store.listPagesReadonly()) {
      const page = store.readPage(ref.id, ref.category)
      if (!page) continue
      const seen = new Set<string>()
      for (const pattern of PATH_PATTERNS) {
        for (const match of (page.body ?? '').matchAll(pattern)) {
          const normalized = normalizePathToken(match[0])
          if (normalized === undefined) continue
          seen.add(normalized) // 同一页里重复提及只算一页
        }
      }
      for (const path of seen) counts.set(path, (counts.get(path) ?? 0) + 1)
    }
  } catch {
    return new Set() // 只读失败 → 空集（门就不说话，宁可不说是第一原则）
  }
  const out = new Set<string>()
  for (const [path, count] of counts) {
    if (count < VAULT_PATH_MIN_PAGES) continue
    out.add(path)
    if (out.size >= VAULT_PATH_LIMIT) break
  }
  return out
}

/** 归一化路径 token：统一反斜杠为 `/`、去空白与行尾标点、小写；太短/太泛的丢弃。 */
function normalizePathToken(raw: string): string | undefined {
  const value = raw.trim().replace(/[\\]+/g, '/').replace(/[.,;:）)】\]]+$/g, '').toLowerCase()
  if (value.length < 6) return undefined
  // 至少要有目录分隔（`src/a.ts` 这种），避免把 `readme.md` 这类泛名当高危
  if (!value.includes('/')) return undefined
  return value
}

/** 目标路径是否属于高危集（硬编码 + 库内多页路径；库内按后缀匹配以容忍不同根）。 */
export function isHighRiskTarget(target: string, vaultPaths: ReadonlySet<string>): boolean {
  if (isHardcodedHighRisk(target)) return true
  const normalized = normalizePathToken(target)
  if (normalized === undefined) return false
  for (const candidate of vaultPaths) {
    if (normalized === candidate) return true
    if (normalized.endsWith('/' + candidate) || candidate.endsWith('/' + normalized)) return true
  }
  return false
}

const MUTATION_TOOL_NAMES = new Set(['edit', 'write', 'str_replace_editor'])

/** 该次 tool 调用是不是「改文件的动作」（L2 只看这些）。 */
export function isMutationCall(name: string): boolean {
  return MUTATION_TOOL_NAMES.has(name)
}

/** L2 提醒文案：说清「为什么现在说」+ 给两个出口（先查 / 直接继续）。 */
export function renderGateReminder(target: string): string {
  return [
    `[知识库提示] 本任务还没查过知识库，而 ${target} 属于高危改动面（迁移/鉴权/部署/公共契约，或库内多页提到的路径）。`,
    '建议先用 wiki_query 或 wiki_search_semantic 检索它，再动手；确认库里没有相关内容就直接继续——这条提醒不阻断你。',
  ].join('\n')
}

/**
 * 写入闸模式。**默认 off**（2026-10-13 用户决策：沉淀完全交给 UI 蒸馏通道）。
 *
 * 为什么默认关，而不是默认 ask：UI 蒸馏（边栏启动器 → wiki-distill skill）走的就是
 * **`wiki_ingest`** ——与模型自行写库是同一个工具名。钩子看不到"这次调用是谁授权的"，
 * 所以任何默认开启的写入闸都会**误伤用户自己点的蒸馏**。既然正规通道已经存在且由用户触发，
 * 写入侧就不该再加拦截；这道闸只作为**显式 opt-in**保留（`=ask` / `=block`）。
 */
export function writeGateModeOf(env: Record<string, string | undefined> = process.env): 'ask' | 'block' | 'off' {
  const raw = (env.KNJ_OBSIDIAN_WRITE_GATE ?? '').trim().toLowerCase()
  if (raw === 'ask') return 'ask'
  if (raw === 'block') return 'block'
  return 'off'
}

/**
 * 知识库的写入型工具（只有这两个会改库；wiki_lint 等是校验/读取，不属于写入）。
 * 与工具注册处（src/tools.ts 的 wiki_capture / wiki_ingest）一一对应。
 */
const VAULT_WRITE_TOOL_NAMES = new Set(['wiki_capture', 'wiki_ingest'])

/**
 * 未经用户授权的写入被拒时的文案（给模型指路：该怎么把决定权交回用户）。
 */
export function renderWriteDeniedReason(): string {
  return [
    '[知识库写入闸] 这次写库被拒绝：知识库的写入必须由**用户决定**。',
    '请不要自行重试。正确做法是问用户一句，例如：',
    '「这次结论要不要沉淀进知识库？（可用 wiki_capture 记一页，或走边栏的会话蒸馏）」',
    '得到用户明确同意后再写入；用户同意后重试同一调用即会放行。',
  ].join('\n')
}

/** 首次未授权写入时注入的提醒（可见、不阻断流程；真正的拦截由拒绝决定完成）。 */
export function renderWriteGateReminder(): string {
  return [
    '[知识库写入闸] 你想写知识库，但本会话还没有用户授权。',
    '不要跳过去写。先问用户是否要沉淀这次结论；用户同意后再写（届时闸门自动放行）。',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 回合边界与「已提醒」判据
//
// 为什么不能靠「进程内的水位线」：进程重启/恢复会话后水位线回到 -1，第一次
// turn-stopping 会把**整份历史**当成一个回合折叠（实测会把几天前的读库+改码史
// 当成当前回合而误报），而且一旦置位就会永久压掉本该出现的那次提醒。
// 现在的边界取宿主的回合号（tool/call 事件自带 data.turn），一次语义取**会话日志**——
// 提醒本身就是一条落盘的 user/message（source.summary 带标记），重启后仍能查到。
// ---------------------------------------------------------------------------

/** 找当前回合：最后一条带 turn 的事件就是本回合（turn/end 若已落盘也同号）。 */
export function currentTurnOf(events: readonly SessionEventLike[]): number | null {
  for (let i = (events?.length ?? 0) - 1; i >= 0; i -= 1) {
    const turn = events[i]?.data?.turn
    if (typeof turn === 'number') return turn
  }
  return null
}

/** 只留本回合的工具调用（foldTurnFacts 的输入必须是「一个回合」，边界由宿主回合号决定）。 */
export function turnToolCalls(events: readonly SessionEventLike[], turn: number): SessionEventLike[] {
  return (events ?? []).filter((e) => e?.type === 'tool/call' && e.data?.turn === turn)
}

/** 本插件已注入的提醒记录（跨进程重启仍有效：它们作为 user/message 落在会话日志里）。 */
export interface InjectedNotice {
  summary: string
  /** 注入所在回合号（宿主在事件上带 turn；拿不到时 undefined）。 */
  turn?: number
  seq: number
}

export function injectedNoticeRecords(events: readonly SessionEventLike[]): InjectedNotice[] {
  const out: InjectedNotice[] = []
  for (const event of events ?? []) {
    if (event?.type !== 'user/message') continue
    const source = event.data?.source
    if (source?.kind !== 'plugin' || source.plugin !== PLUGIN_ID) continue
    if (typeof source.summary !== 'string' || source.summary.length === 0) continue
    out.push({
      summary: source.summary,
      ...(typeof event.data?.turn === 'number' ? { turn: event.data.turn } : {}),
      seq: typeof event.seq === 'number' ? event.seq : 0,
    })
  }
  return out
}

/** 本插件已经注入过的提醒摘要（Set 视图，保持既有调用方与用例的契约）。 */
export function injectedNotices(events: readonly SessionEventLike[]): Set<string> {
  return new Set(injectedNoticeRecords(events).map((n) => n.summary))
}

/** 最近一条匹配前缀的提醒记录（同前缀多条时取最早那条——它就是首次注入）。 */
export function latestNoticeByPrefix(
  events: readonly SessionEventLike[],
  prefix: string,
): InjectedNotice | undefined {
  return injectedNoticeRecords(events).find((n) => n.summary.startsWith(prefix))
}

const PLUGIN_ID = 'dsh-knj-obsidian'
/** L5 的摘要（去重键）。 */
export const CAPTURE_SUMMARY = '沉淀提醒'
/** L1 一档的摘要前缀；真实摘要形如 `知识库提示#123`，尾号是任务 seq（同一任务重启后不再重复注入）。 */
export const TASK_SUMMARY_PREFIX = '知识库提示'
/** L1 二档的摘要前缀（一档被忽略后才注入正文；同样带任务 seq 去重）。 */
export const FULLTEXT_SUMMARY_PREFIX = '知识库提示全文'

/** L1 一档的摘要：把任务 seq 编进去，重启后仍能判定「这个任务已经提过」。 */
export function taskSummaryOf(taskSeq: number): string {
  return `${TASK_SUMMARY_PREFIX}#${taskSeq}`
}

/** L1 二档的摘要。 */
export function fullTextSummaryOf(taskSeq: number): string {
  return `${FULLTEXT_SUMMARY_PREFIX}#${taskSeq}`
}

/** 从摘要尾号取回任务 seq（`知识库提示#123` → 123）；不合法返回 null。 */
export function taskSeqOfSummary(summary: string, prefix: string): number | null {
  if (!summary.startsWith(`${prefix}#`)) return null
  const raw = summary.slice(prefix.length + 1)
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

/**
 * 子代理会话是否也触发：`KNJ_OBSIDIAN_TRIGGER_SUBAGENT=off` 收敛为仅顶层会话。
 * 默认开——子代理同样需要知识（且提醒本身不阻断）；噪声明显时用这个开关收敛。
 */
export function subagentTriggerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.KNJ_OBSIDIAN_TRIGGER_SUBAGENT ?? '').trim().toLowerCase() !== 'off'
}

/** 会话的委派深度（宿主 SessionHeader.delegationDepth；顶层会话为 0）。 */
export function delegationDepthOf(session: unknown): number {
  const header = (session as { header?: { delegationDepth?: number } } | null | undefined)?.header
  const depth = header?.delegationDepth
  return typeof depth === 'number' && Number.isFinite(depth) ? depth : 0
}

/** 会话的工作目录（宿主 SessionHeader.cwd）：L0 按它解析本会话的库。 */
export function sessionCwdOf(session: unknown): string {
  const header = (session as { header?: { cwd?: string } } | null | undefined)?.header
  const cwd = header?.cwd
  return typeof cwd === 'string' ? cwd : ''
}

// ---------------------------------------------------------------------------
// L0：会话级库绑定与身份注入
//
// 为什么必须按会话解析：provider 的「当前库」是宿主进程内存里的**单值**，而磁盘注册表可能已经
// 被边栏改过（实测内存 iobs_pro / 磁盘 tap-taste 不一致）。于是「在 A 工作区问 A 的事」会被 B 库
// 命中——提示答偏，模型学会忽略，表现为「这个插件根本不查库」。
//
// 只读契约：只调 provider 的只读方法，绝不 ensure()/mkdir、绝不写注册表。
// ---------------------------------------------------------------------------

/** L0 身份块开关：`KNJ_OBSIDIAN_VAULT_IDENTITY=off` 关闭（注入量极小的增益层，默认开）。 */
export function vaultIdentityEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.KNJ_OBSIDIAN_VAULT_IDENTITY ?? '').trim().toLowerCase() !== 'off'
}

/**
 * L0 身份块文案：只给「库在哪、有几页、索引在哪」——让模型知道库存在且可查，
 * 不再把一次空结果误读成「这个库没用」。
 */
export function renderVaultIdentity(input: { name: string; root: string; pageCount: number; indexPath: string }): string {
  return [
    `[知识库] 本工作区的知识库：${input.name}（${input.pageCount} 页）`,
    `根目录：${input.root}`,
    `索引：${input.indexPath}`,
    '需要既有结论或踩过的坑时，可 wiki_query（词面）/ wiki_search_semantic（语义）/ wiki_read（读整页）检索。',
  ].join('\n')
}

/** 库身份解析结果（只读）。 */
export interface VaultIdentity {
  name: string
  root: string
  pageCount: number
  indexPath: string
}

/** L0 的只读依赖面：provider 的当前库 + 只读的按根解析。 */
export interface VaultProviderLike {
  currentReadonly?: () => VaultStore
  /** 按根取只读库（不回退 ensure()；未注册/无 .wiki 的根返回 undefined）。 */
  readonlyVaultForRoot?: (root: string) => { store: VaultStore; name: string } | undefined
  /** 注册表里按根查库（用于拿展示名）。 */
  recordForRoot?: (root: string) => { name: string } | undefined
  listVaults?: () => Array<{ root: string; name: string }>
}

/**
 * 解析「本会话该用哪个库」：
 *   1) 会话 cwd 命中的库（L0 的正解）——只读解析，不写盘、不建库；
 *   2) **只在会话没给 cwd 时**才回退 provider 的当前库（旧行为，兼容没有 header 的宿主/测试）。
 *      给了 cwd 却解析不出库 → 返回 undefined（这是「宁可不说是第一原则」的落点：
 *      回退全局库正是「在 A 项目里问 A 的事、被 B 库答偏」的来源，实测必现）。
 */
export function resolveSessionVault(
  provider: VaultProviderLike,
  cwd: string,
): { store: VaultStore; identity: VaultIdentity } | undefined {
  const root = cwd.trim() ? resolve(cwd) : ''
  if (root) {
    let hit: { store: VaultStore; name: string } | undefined
    try {
      hit = provider.readonlyVaultForRoot?.(root)
    } catch {
      hit = undefined // 解析失败不阻断：按「无库」处理，绝不放宽到全局库
    }
    if (!hit) return undefined
    try {
      return {
        store: hit.store,
        identity: {
          name: hit.name,
          root: hit.store.wikiRoot,
          pageCount: hit.store.listPagesReadonly().length,
          indexPath: join(hit.store.wikiRoot, 'index.md'),
        },
      }
    } catch {
      return undefined
    }
  }
  try {
    const store = provider.currentReadonly?.()
    if (!store) return undefined
    const record = provider.recordForRoot?.(store.wikiRoot)
    const fallbackName = provider.listVaults?.().find((v) => resolve(v.root) === resolve(store.wikiRoot))?.name
    return {
      store,
      identity: {
        name: record?.name ?? fallbackName ?? store.wikiRoot,
        root: store.wikiRoot,
        pageCount: store.listPagesReadonly().length,
        indexPath: join(store.wikiRoot, 'index.md'),
      },
    }
  } catch {
    return undefined
  }
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

export interface TriggerHost {
  on(event: 'agent/session-start', handler: (payload: { agent?: AgentLike }) => void): unknown
  on(event: 'agent/pre-step', handler: (
    payload: { agent?: AgentLike },
    next: () => Promise<unknown>,
  ) => Promise<unknown>): unknown
  on(event: 'agent/turn-stopping', handler: (payload: { agent?: AgentLike }) => Promise<void>): unknown
  on(event: 'tools/pre-execute', handler: (
    exec: ToolExecutionLike,
    next: () => Promise<unknown>,
  ) => Promise<unknown>): unknown
}

/** `tools/pre-execute` 的入参（宿主 ToolExecution 里我们真正用到的字段）。 */
export interface ToolExecutionLike {
  name?: string
  arguments?: unknown
  agent?: AgentLike
}

interface SessionLike {
  snapshotEvents?: () => SessionEventLike[] | undefined
  events?: SessionEventLike[]
}

interface AgentLike {
  session?: unknown
  inject?: (input: unknown) => void
}

interface TriggerState {
  /** 已处理过的直接用户任务 seq（同一个任务只匹配一次，任务内后续步骤不再重复匹配）。 */
  lastTaskSeq: number
  /** L1 一档已注入的任务记录（供二档判「模型看过没有」）。 */
  stageOne?: { seq: number; turn: number | null; top: { id: string; category: WikiCategory } }
  /** L3 已提示过的失败签名（每会话每个签名只提示一次）。 */
  hintedFailures: Set<string>
  /** L2：本任务是否已经查过库（新任务时重置）。 */
  consultedThisTask: boolean
  /** L2：本任务已提醒过哪些高危路径（同一路径不反复说）。 */
  gateWarnedFor: Set<string>
  /** L2：被拦截过的高危路径（模型显式重试时放行——拦截不该变成死路）。 */
  gateDeniedFor: Set<string>
  /** 写入闸：本会话是否已获批写库（首次未授权写入被拒后置位；重试即放行）。 */
  writeAuthorized: boolean
  /** 写入闸：本会话是否已提示过一次（避免反复注入）。 */
  writeGateWarned: boolean
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
    const created: TriggerState = {
      lastTaskSeq: -1,
      hintedFailures: new Set(),
      consultedThisTask: false,
      gateWarnedFor: new Set(),
      gateDeniedFor: new Set(),
      writeAuthorized: false,
      writeGateWarned: false,
    }
    states.set(key, created)
    return created
  }

  /**
   * 本会话该用的库（L0）。只读取；不可用时返回 undefined（触发层是增益，不是依赖）。
   */
  function currentVault(session: unknown): VaultStore | undefined {
    try {
      return resolveSessionVault(provider, sessionCwdOf(session))?.store
    } catch {
      return undefined
    }
  }

  /** 子代理策略 + 开关：两条都在最外层判定，关了就连事件都不读。 */
  function shutdownCheck(agent: AgentLike | undefined): boolean {
    if (!triggerEnabled()) return true
    if (agent?.inject === undefined) return true
    if (!subagentTriggerEnabled() && delegationDepthOf(agent.session) > 0) return true
    return false
  }

  /** 注册监听；单条注册失败不得冒泡（否则会打断插件 apply 之后的链路）。 */
  function register(event: string, handler: unknown): void {
    try {
      ctx.on(event as never, handler as never)
    } catch {
      // 宿主拒绝注册：触发层缺席，插件其余能力照常
    }
  }

  // ---- L0：会话开始注入库身份（只读；库为空则不注入——宁可不说是第一原则） ----
  //
  // ⚠️ 必须 await createNotice：它是 async 的（默认实现要动态 import 宿主 llm 包）。
  // 漏了 await 会把**一个 Promise**当作消息注入——宿主签名是同步 `=> void`，不会报错，
  // 表现为「注入了一条空消息」，是那种只会在端到端才暴露的静默失败（已由用例钉死）。
  register('agent/session-start', async ({ agent }: { agent?: AgentLike }) => {
    if (shutdownCheck(agent)) return
    if (!vaultIdentityEnabled()) return
    try {
      const events = sessionEventsOf(agent!.session)
      // 跨重启去重：身份块也是一条落盘的 user/message（resume 时不重复注入）
      if (injectedNotices(events).has(VAULT_IDENTITY_SUMMARY)) return
      const resolved = resolveSessionVault(provider, sessionCwdOf(agent!.session))
      if (!resolved || resolved.identity.pageCount === 0) return
      agent!.inject?.(await createNotice(renderVaultIdentity(resolved.identity), VAULT_IDENTITY_SUMMARY))
    } catch {
      // L0 任何异常都不得影响主流程
    }
  })

  // ---- L1 一档：新任务 → 命中或语义兜底 → 提示；二档：被忽略 → 追投正文（见 turn-stopping） ----
  register('agent/pre-step', async ({ agent }: { agent?: AgentLike }, next: () => Promise<unknown>) => {
    const decision = await next()
    if (shutdownCheck(agent)) return decision
    try {
      const events = sessionEventsOf(agent!.session)
      const task = latestDirectUserTask(events)
      if (!task) return decision
      const state = stateOf(agent!.session)
      if (state.lastTaskSeq === task.seq) return decision
      state.lastTaskSeq = task.seq // 同一任务只匹配一次（无论是否有命中）
      // 新任务：重置 L2 的「本任务查过库吗」与一次性提醒（同一路径在旧任务里提醒过不算数）
      state.consultedThisTask = false
      state.gateWarnedFor.clear()
      state.gateDeniedFor.clear()
      // 跨重启去重：提醒本身作为 user/message 落在会话日志里，摘要带任务 seq
      if (injectedNotices(events).has(taskSummaryOf(task.seq))) return decision
      const store = currentVault(agent!.session)
      if (!store) return decision
      let hits = matchTaskPages(store, task.text)
      // 字面 0 命中 → 语义兜底（只接受已热的运行时；未热/无模型/无索引一律静默）
      if (hits.length === 0) hits = await semanticFallbackCandidates(store, task.text)
      if (hits.length === 0) return decision
      state.stageOne = { seq: task.seq, turn: currentTurnOf(events), top: { id: hits[0]!.id, category: hits[0]!.category } }
      agent!.inject?.(await createNotice(renderTaskReminder(hits), taskSummaryOf(task.seq)))
    } catch {
      // 触发层任何异常都不得影响主流程
    }
    return decision
  })

  register('agent/turn-stopping', async ({ agent }: { agent?: AgentLike }) => {
    if (shutdownCheck(agent)) return
    try {
      const state = stateOf(agent!.session)
      const events = sessionEventsOf(agent!.session)
      const turn = currentTurnOf(events)

      // ---- L2 状态：本任务是否已查过库（门据此自动开；也在二档判据里复用） ----
      const task = latestDirectUserTask(events)
      if (task && consultedVaultSince(events, task.seq)) state.consultedThisTask = true

      // ---- L1 二档：一档被忽略 → 追投正文（每任务至多一次，跨重启按摘要去重） ----
      if (fullTextStageEnabled()) await stageTwo(agent!, state, events, turn)

      // ---- L3：同一个失败第二次出现 → 这次一定要查库 ----
      //
      // 两道前置：① 会话有库（没库时提示「去查库」毫无意义）；② **库里有相关页**（方案 A，
      // 2026-10-13 用户决策）——实测复发多为开发流程的正常试错（`edit` 未先读、测试失败），
      // 库里并没有对应页面，此时提示"去查库"是无效建议。判据是事实不用猜：用失败指纹检索一次库。
      const store = currentVault(agent!.session)
      if (recurrenceEnabled() && store) {
        const signatures = recurringFailures(events, state.hintedFailures)
        if (signatures.length > 0) {
          const counts = foldFailureFrequency(events)
          let injected = 0
          for (const signature of signatures) {
            // 库帮不上的签名也记住：否则每个回合都会为它重扫一遍全库
            if (!vaultCanHelp(store, signature)) { state.hintedFailures.add(signature); continue }
            if (injected >= RECURRENCE_INJECT_LIMIT) break
            injected += 1
            state.hintedFailures.add(signature)
            agent!.inject?.(await createNotice(
              renderRecurrenceReminder(signature, counts.get(signature) ?? RECURRENCE_THRESHOLD),
              recurrenceSummaryOf(signature),
            ))
          }
        }
      }

      // ---- L5 已移除（2026-10-13，用户决策）：沉淀完全交给 UI 蒸馏通道 ----
      //
      // 为什么删掉而不是改文案：真实会话日志（iobs_pro）显示 L5「沉淀提醒」注入之后，模型
      // **自主**调用 wiki_capture（随后还 wiki_lint 自检，白花 38s）。用户的判断是：没有经过
      // 用户决定的内容不该进知识库，而**会话蒸馏（边栏启动器）本来就是那条由用户触发的正规通道**。
      // 于是本插件不再做任何写入侧的推动——不提醒、不闸门，写入只由用户显式触发。
      // 相关导出（shouldRemindCapture / foldTurnFacts / renderCaptureReminder / CAPTURE_SUMMARY）
      // 保留为纯函数与兼容面，但不再有任何调用点。
    } catch {
      // 触发层任何异常都不得影响主流程
    }
  })

  /**
   * 二档：一档提示在**下一回合**仍未被采纳（整个回合没碰过库）时，直接把正文投给模型。
   * 只在「注入所在回合已结束」后判定——同回合追投等于没给模型机会，那是噪声不是补救。
   */
  async function stageTwo(
    agent: AgentLike,
    state: TriggerState,
    events: readonly SessionEventLike[],
    turn: number | null,
  ): Promise<void> {
    const stageOne = state.stageOne
    if (!stageOne) return
    if (turn === null) return
    const notice = latestNoticeByPrefix(events, `${TASK_SUMMARY_PREFIX}#`)
    if (!notice) return
    // 一档与二档必须是一对：注入回合已过去（严格大于），当回合未碰库
    const injectedTurn = notice.turn ?? stageOne.turn
    if (injectedTurn === null || injectedTurn === undefined) return
    if (turn <= injectedTurn) return
    if (injectedNotices(events).has(fullTextSummaryOf(stageOne.seq))) return
    if (foldHintOutcome(turnToolCalls(events, turn)).consultedVault) return // 模型这回合查了库 → 不必追投
    const store = currentVault(agent.session)
    if (!store) return
    // 追投一档的 top-1（候选在一档时已定，随状态带着，避免重算一遍词表）
    const page = store.readPage(stageOne.top.id, stageOne.top.category)
    if (!page) return
    const text = renderStageTwoReminder(page, stageOne.top.category, stageOne.top.id)
    if (text.trim().length === 0) return
    agent.inject?.(await createNotice(text, fullTextSummaryOf(stageOne.seq)))
    state.stageOne = undefined
  }

  // ---- 写入闸 + L2 合取门（同在 tools/pre-execute 上，口径不同） ----
  //
  // ⚠️ 必须先调用宿主自己的 next()：这是 waterfall，直接返回 deny/allow 会跳过宿主既有的
  // 权限/沙箱策略。这里只在宿主**允许**之后追加我们这一层。
  //
  // 写入闸先判：它管的是「知识库写入必须由用户决定」这条原则（不受 KNJ_OBSIDIAN_GATE 影响），
  // 而 L2 管的是「改高危文件前先查库」。
  register('tools/pre-execute', async (exec: ToolExecutionLike, next: () => Promise<unknown>) => {
    const decision = await next()
    if (shutdownCheck(exec.agent)) return decision
    try {
      const writeGuard = await wikiWriteDecision(exec)
      if (writeGuard) return writeGuard
      const mode = gateModeOf()
      if (mode === 'off') return decision
      const guard = await gateDecision(exec, mode)
      if (!guard) return decision
      return guard
    } catch {
      return decision // 门禁任何异常都不得阻断工具（触发层是增益，不是依赖）
    }
  })

  /**
   * 写入闸：未经用户授权的知识库写入被拒（每会话一次；重试即放行）。
   *
   * 为什么放在工具层而不是只改 L5 文案：文案只是"劝"，而真实日志证明模型会自行写库
   * （L5 提醒之后紧跟一次 wiki_capture）。用户要求「写入必须由用户决定」，所以需要硬约束。
   *
   * @returns 需要覆盖的 decision（deny），或 undefined 表示放行
   */
  async function wikiWriteDecision(exec: ToolExecutionLike): Promise<unknown | undefined> {
    const mode = writeGateModeOf()
    if (mode === 'off') return undefined
    if (!VAULT_WRITE_TOOL_NAMES.has(exec.name ?? '')) return undefined
    const store = currentVault(exec.agent?.session)
    if (!store) return undefined // 没有库的会话：没有"写进库"这回事
    const session = exec.agent?.session
    const state = stateOf(session)
    if (state.writeAuthorized) return undefined
    state.writeAuthorized = true // 放行一次即视为本次授权（之后不再拦，避免反复打断）
    if (mode === 'ask' && !state.writeGateWarned) {
      state.writeGateWarned = true
      exec.agent?.inject?.(await createNotice(renderWriteGateReminder(), WRITE_GATE_SUMMARY))
    }
    return { kind: 'deny', reason: renderWriteDeniedReason() }
  }

  /**
   * L2 判定：只对「改文件的动作 + 高危路径 + 本任务未查过库」说话。
   *
   * @returns 需要覆盖的 decision（block 档），或 undefined 表示放行
   */
  async function gateDecision(exec: ToolExecutionLike, mode: GateMode): Promise<unknown | undefined> {
    if (!isMutationCall(exec.name ?? '')) return undefined
    const target = pathOf({ data: { name: exec.name, arguments: exec.arguments } })
    if (target.length === 0) return undefined
    const store = currentVault(exec.agent?.session)
    if (!store) return undefined // 无库：门不说话（硬编码集单独判也太粗，L0 没落地前尤其如此）
    const state = stateOf(exec.agent?.session)
    if (state.consultedThisTask) return undefined // 本任务查过库 → 门自动开
    if (!isHighRiskTarget(target, highRiskPathsFromVault(store))) return undefined
    if (state.gateWarnedFor.has(target)) return undefined // 同一路径本任务不反复说
    state.gateWarnedFor.add(target)
    if (mode === 'block' && !state.gateDeniedFor.has(target)) {
      // 拦一次；模型显式重试同一路径即放行——拦截的目的是让它先查库，不是堵死它
      state.gateDeniedFor.add(target)
      return { kind: 'deny', reason: renderGateReminder(target) }
    }
    exec.agent?.inject?.(await createNotice(renderGateReminder(target), GATE_SUMMARY))
    return undefined
  }

  // 监听随 ctx 生命周期卸载，无需额外清理
  return () => {}
}

/** L0 身份块的摘要（去重键；每会话一次足以，重启后日志里已有就不再注入）。 */
export const VAULT_IDENTITY_SUMMARY = '知识库身份'
