// src/retriever.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeTier } from './vault-store.ts'
import type { VaultStore } from './vault-store.ts'
import type { WikiCategory, WikiTier, WikiPage, Confidence } from './types.ts'

/** 正式分类全量清单（L1 索引命中后逐类回读；此前漏了 dictionaries/tables，导致字典/表结构页在 index-only 模式检索不到）。
 *  同时作为语义命中的分类白名单：_system/ 与 wiki-export/ 不在其中，故永不可被语义层命中。 */
export const RETRIEVAL_CATEGORIES: readonly WikiCategory[] = ['concepts', 'entities', 'references', 'synthesis', 'projects', 'dictionaries', 'tables']

/**
 * 基础匹配分。10/6/4/2 四项与上游 obsidian-wiki 的 graphrag 打分逐项对齐
 * （精确标题 / 标题 / 标签 / 摘要），使两套检索引擎对同一个库给出方向一致的排序。
 * index/body/graph 是本地扩展：上游 graph-query 压根不读正文，没有正文与
 * 图谱层，故这三项取较低的基础分，保证既有「前置层优先」语义在分数上也可读。
 *
 * **语义层不在这张表里**：它的分值由 SEMANTIC_RANK_BASE 按通道内名次给出
 * （曾经这里是 `semantic: 3` 的扁平常数，实测会把正确的词面 Top1 顶掉，已移除）。
 */
export const MATCH_SCORE = {
  exactTitle: 10,
  title: 6,
  /** 问法层：正文 ```queries 块（能力页显式声明的「这页回答什么问题」）。介于标题与标签之间。 */
  queries: 5,
  tag: 4,
  summary: 2,
  index: 2,
  body: 1,
  graph: 0.5,
} as const

/**
 * 语义层的分值基准：**只由语义通道自身的名次决定**（第 1 名 = 该值，第 n 名 = 该值 / n）。
 *
 * 这里原先是 `MATCH_SCORE.semantic = 3`（一个扁平常数，整层高于 body/summary/graph），
 * 2026-10-17 实测证明那样会**把正确的词面 Top1 顶掉**，故改为按名次递减且整层垫底：
 *
 * 1. **扁平 base 丢掉了通道内的名次**。案例：语义通道自己把期望页排第 1、把另一页排第 5（最低），
 *    融合后第 5 名成了 Top1——通道内的相关性排序被完全丢弃。
 * 2. **度加权（最高 +2）与 tier 权重（×1.3）又用「连接度」覆盖了「语义相关性」**，
 *    于是 hub/core 页稳定压过语义上更相关的页。
 * 3. 这两点叠加的后果是 `wiki_query` 可能比纯词面**更差**（实测 Top1 精度 6/10 → 4/10）。
 *
 * 因此语义只补召回，不参与词面之上的排序：基准 0.3 严格小于词面最低层
 * （graph 层、零度、peripheral tier = 0.5 × 0.7 = 0.35），名次越高分越低，
 * 且**不乘 tier 权重、不加度加权**——否则相邻名次会被 ±30% 的 tier 权重翻转。
 */
export const SEMANTIC_RANK_BASE = 0.3

/** 第 rank 名（从 1 开始）的语义候选分值：严格递减，恒 < 0.35。 */
function semanticScore(rank: number): number {
  return SEMANTIC_RANK_BASE / Math.max(1, rank)
}

/** tier 权重（与上游一致）：core 1.3 / supporting 1.0 / peripheral 0.7。 */
export const TIER_WEIGHT: Record<WikiTier, number> = { core: 1.3, supporting: 1, peripheral: 0.7 }

/** 度加权：min(度 × 0.1, 2)，度 = 出链 + 入链（与上游 degree bonus 同式）。 */
const DEGREE_STEP = 0.1
const MAX_DEGREE_BONUS = 2
/** 空度表：语义候选刻意不做度加权（否则 hub 页会用连接度覆盖语义相关性）。 */
const NO_DEGREE: Map<string, number> = new Map()

export interface RetrievalCandidate {
  page: string
  id: string
  category: WikiCategory
  title: string
  confidence: Confidence
  snippet: string
  matchedBy: 'title' | 'queries' | 'tag' | 'summary' | 'body' | 'graph' | 'index' | 'semantic'
  /** 相关性分数（越大越相关）= 基础匹配分 + 度加权，再乘 tier 权重。候选恒按此降序返回。 */
  score: number
  /** 归一化后的分层（core/supporting/peripheral），即打分所用的权重档位。 */
  tier: WikiTier
  /** 页面 frontmatter 的 source（原始出处标识）：候选一路带着它，合成答案才追得回源头。 */
  source: string
}

export interface RetrievalResult {
  candidates: RetrievalCandidate[]
  strategy: string
  totalPages: number
}

/** 语义召回命中（由调用方预先取好并已做边界过滤，保持 retrieve 为同步纯函数） */
export interface SemanticPageHit {
  id: string
  category: WikiCategory
  /** 后端给出的片段；缺省时按正文头部生成 */
  snippet?: string
}

export interface RetrievalOptions {
  mode?: 'auto' | 'index-only'
  maxCandidates?: number
  /** 为空/未提供时，下面所有分支与不含语义层时逐字节一致 */
  semanticHits?: SemanticPageHit[]
}

const MAX_SNIPPET = 200

/**
 * 查询拆词：按空白与常见分隔符切分（中英文标点都算），只保留非空片段；
 * **纯 CJK 长片段再按 2 字滑窗拆 bigram**——没有空格的中文句子上面拆不开，2 字滑窗
 * 是唯一确定性的廉价拆法（「知识库怎么触发检索」→ 知识/识库/库怎/…/检索）。
 *
 * 为什么必须拆：改动前整个查询被当成**单一子串**做 `includes` / `indexOf`，于是任何
 * 词组式写法（「knj-workflow 流程实例 运行 变量」）与任何中文自然语言句子
 * （「知识库怎么触发检索」）都必然 0 命中——而这两种恰恰是最自然的提问方式。
 *
 * 兼容性：单 token 查询返回 `[q]`，占比恒为 1，与改动前**逐字节等价**；
 * 2 字中文 = 1 个 bigram，同样与整串等价。只有 ≥3 字 CJK 与多 token 查询才走占比加权。
 */
export function tokenizeQuery(query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const parts = q.split(/[\s,，、;；:：|/\\]+/).filter((s) => s.length > 0)
  const tokens: string[] = []
  for (const part of parts) {
    if (isCjkRun(part) && [...part].length >= 3) {
      const chars = [...part]
      for (let i = 0; i + 1 < chars.length; i += 1) tokens.push(chars[i] + chars[i + 1])
      continue
    }
    tokens.push(part)
  }
  // 去重：避免同一个词在大分母里灌水（bigram 尤甚）
  const unique = [...new Set(tokens)]
  return unique.length > 0 ? unique : [q]
}

/** 纯 CJK 连续串（汉字/假名/谚文；排除 ASCII、数字与标点）。 */
function isCjkRun(value: string): boolean {
  return /^[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+$/.test(value)
}

/** 命中词数 / 总词数（分母恒为查询词数；0 词返回 0）。任一 token 命中即为 > 0，即 OR 语义。 */
function matchRatio(haystack: string, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0
  let matched = 0
  for (const token of tokens) if (haystack.includes(token)) matched += 1
  return matched / tokens.length
}

/** 首个命中 token 在 haystack 中的位置（无命中返回 -1），供 L3 的居中 snippet 使用。 */
function firstTokenIndex(haystack: string, tokens: readonly string[]): number {
  let best = -1
  for (const token of tokens) {
    const idx = haystack.indexOf(token)
    if (idx < 0) continue
    if (best < 0 || idx < best) best = idx
  }
  return best
}

/** 解析 [[wikilink]]：剥离锚点（#…）与别名（|…），与 lint.ts 保持一致 */
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g

/** 已解析页面 + 其所属分类（分类由目录决定，不用页面 frontmatter 自称的值）。 */
interface PageEntry {
  id: string
  category: WikiCategory
  page: WikiPage
}

export function retrieve(
  store: VaultStore,
  query: string,
  opts: RetrievalOptions = {},
): RetrievalResult {
  const mode = opts.mode ?? 'auto'
  const maxCandidates = opts.maxCandidates ?? 10
  const q = query.trim().toLowerCase()
  // 拆词只在多 token 查询上生效；单 token 时 tokens = [q]，占比恒为 1 → 与改动前逐字节等价
  const tokens = tokenizeQuery(q)
  // 只读列举：检索不得触发 ensure()（零写入，全新 vault 也可直接检索）
  const pages = store.listPagesReadonly()
  const totalPages = pages.length

  if (!q) return { candidates: [], strategy: 'empty-query', totalPages }

  if (mode === 'index-only') {
    return { candidates: indexOnly(store, q, tokens, maxCandidates), strategy: 'index-only', totalPages }
  }

  // 单次装载：前置层匹配、正文匹配、度计算共用同一份已解析页面（readPage 自带 mtime 缓存）
  const entries: PageEntry[] = []
  for (const p of pages) {
    const page = store.readPage(p.id, p.category)
    if (page) entries.push({ id: p.id, category: p.category, page })
  }
  const degree = degreeMap(entries)

  // 语义召回：仅接受库内真实页面（幽灵/越界命中在此被剔除）
  const semanticHits = semanticCandidates(store, opts.semanticHits, pages, degree)
  const hasSemantic = semanticHits.length > 0

  // 前置层（frontmatter 级，均无需读正文）：标题 / 标签
  const frontHits: RetrievalCandidate[] = []
  let guardTriggered = false
  for (const e of entries) {
    const m = frontMatch(e, q, tokens)
    if (!m) continue
    if (m.guards) guardTriggered = true
    frontHits.push(candidate(e, m.layer, m.base, degree))
  }
  const frontIds = new Set(frontHits.map((c) => c.id))

  /**
   * 前置层命中的构成标签（供 `strategy` 如实披露）。
   *
   * 问法层是独立于 title/tag 的**匹配位置**：能力页的标题与提问往往没有共同 bigram
   * （「知识检索」vs「词面检索和语义检索什么区别」），命中来自页内 ```queries 块。
   * 若不写进 strategy，agent 只能看到 'title+tag'，无法判断这页为什么被召回——
   * 排查「关键词没出现在标题也没出现在标签，却进了结果」时会误以为是脏匹配。
   */
  const frontLabel = frontHits.some((c) => c.matchedBy === 'queries') ? 'title+queries+tag' : 'title+tag'

  // 摘要层：**严格低于正文层的回退层**——只有当查询出现在摘要里、却不出现在该页正文里
  // （也不在标题/标签里）时才产生候选。
  //
  // 这条规则的意义在于它让「判断摘要是人工撰写还是机器派生」这件事**根本不必要**：
  // 派生摘要就是正文首行的副本，其内容必然也在正文里，因此永远走不到这里——既不会凭空
  // 多出候选，也不可能把本该标 body 的命中改判成 summary（连带换掉 L3 的居中 snippet）。
  // 而人工摘要可能含有正文里根本没有的措辞，那才是摘要层真正新增的召回。
  //
  // 早先的写法是拿磁盘上的摘要与 summarizeBody(正文) 比字符串来判断「是否人工撰写」，
  // 那是靠内容推断来源，会在两种情况下失效：正文首行含孤立 \r 时写入端会把它拍平成空格
  // 而比较用的是未拍平的原文（把机器派生误判成人工）；正文被编辑器改过之后旧摘要与正文
  // 不再相等（同样误判成人工）。改成「低于正文层」后这类误判不再影响匹配结果。
  const summaryHits: RetrievalCandidate[] = []
  for (const e of entries) {
    if (frontIds.has(e.id)) continue
    if (matchRatio(e.page.body.toLowerCase(), tokens) > 0) continue // 正文能命中：交给正文层，别抢标签
    const summary = e.page.summary ?? ''
    const ratio = matchRatio(summary.toLowerCase(), tokens)
    if (ratio <= 0) continue
    // snippet 同样受 MAX_SNIPPET 约束：摘要是外部输入，长度不受控
    summaryHits.push(candidate(e, 'summary', MATCH_SCORE.summary * ratio, degree, summary.slice(0, MAX_SNIPPET)))
  }

  // 成本护栏（既有契约，retriever.test.mjs 断言 strategy === 'title+tag'）：前置层出现
  // 标题/标签命中就不再下探正文。护栏的触发条件与改动前逐字一致，精确匹配与摘要命中只
  // 追加候选，因此这条路径上召回只增不减。
  if (!hasSemantic && guardTriggered) {
    return {
      candidates: rank([...frontHits, ...summaryHits], degree, maxCandidates),
      strategy: summaryHits.length > 0 ? `${frontLabel}+summary` : frontLabel,
      totalPages,
    }
  }

  // 正文层：与改动前一致地扫全部页面（不排除前置层已命中的页）。这一点是必需的——
  // bodyHits 同时充当 L4 的种子集合，若把前置层命中页从这里剔除，那些页的一跳邻居就会
  // 整体消失（差分实测：query="版本号铁律" 时 dsh-knj-plugins 转入摘要命中后，它的邻居
  // dsh-agent-orchestration 被一并丢掉）。重复候选由下面的融合去重处理。
  const bodyHits: RetrievalCandidate[] = []
  for (const e of entries) {
    const body = e.page.body.toLowerCase()
    const ratio = matchRatio(body, tokens)
    if (ratio > 0) bodyHits.push(candidate(e, 'body', MATCH_SCORE.body * ratio, degree, undefined, firstTokenIndex(body, tokens)))
  }

  // L4：对 L3 命中的每个页面，取其出链邻居作为关联候选（matchedBy: 'graph'）
  const bodyIds = new Set(bodyHits.map((h) => h.id))
  const byId = new Map(entries.map((e) => [e.id, e]))
  const graphHits: RetrievalCandidate[] = []
  const seen = new Set<string>() // 多个正文命中共享同一邻居时只保留一份
  for (const hit of bodyHits) {
    for (const target of linkedPages(store, hit.id, hit.category)) {
      const te = byId.get(target)
      if (!te) continue
      if (bodyIds.has(target)) continue // 已命中不重复
      if (seen.has(target)) continue // 重复邻居去重
      seen.add(target)
      graphHits.push(candidate(te, 'graph', MATCH_SCORE.graph, degree))
    }
  }

  // 融合各层，按首次出现去重：既有层优先，故语义层与前置层/正文层命中同一页时，
  // matchedBy 与 score 一律取既有层（与语义层加入前的行为一致）。摘要层同理——它只在
  // 正文层不命中时才产生候选，所以它是天然的最后回退层，不会与正文层抢同一页。
  const merged: RetrievalCandidate[] = []
  const mergedIds = new Set<string>()
  for (const c of [...frontHits, ...bodyHits, ...summaryHits, ...graphHits, ...semanticHits]) {
    if (mergedIds.has(c.id)) continue
    mergedIds.add(c.id)
    merged.push(c)
  }

  const parts = [frontLabel]
  if (summaryHits.length > 0) parts.push('summary')
  if (bodyHits.length > 0) parts.push('body')
  if (graphHits.length > 0) parts.push('graph')
  if (hasSemantic) parts.push('semantic')
  return { candidates: rank(merged, degree, maxCandidates), strategy: parts.join('+'), totalPages }
}

/** 前置层匹配结果：layer 决定 matchedBy，base 是基础分，guards 决定是否触发成本护栏。 */
interface FrontMatch {
  layer: 'title' | 'queries' | 'tag'
  base: number
  /**
   * 是否触发「前置层命中即停、不下探正文」的成本护栏。
   *
   * **只有改动前就存在的两个条件（标题包含 / 标签包含）才算**。新增的「id 精确相等」
   * 只增加候选与分数，绝不能改变护栏触发条件：一个恰好等于某页 id 的查询在改动前是
   * 不命中前置层的（标题里没有这个 id），会正常下探正文、拿到所有引用它的页面；
   * 若让精确匹配触发护栏，这类查询就会提前返回、只给出该页本身，造成召回缩水。
   * （差分实测：query="dsh-agent-orchestration" 改动前返回 4 个引用页，让精确匹配触发
   * 护栏后只剩 1 个。）
   */
  guards: boolean
}

/**
 * 解析正文里的 ```` ```queries ```` 块（「任务问法」，不是 schema 字段）。
 *
 * 为什么放在正文而不用 frontmatter：`wiki_ingest` 的 pages 入参是 additionalProperties:false、
 * `writePage()` 又会整份重建 frontmatter 只写固定 11 键——自定义字段活不过一次更新。
 * 正文 fenced 块是唯一能存活的地方。
 *
 * 为什么检索侧必须消费它：实测（2026-10-20）能力页在「问答式查询」上的 Top3 命中率只有 18%，
 * 因为标题「知识检索」与提问「词面检索和语义检索什么区别」没有共同 bigram。把「这页应该回答
 * 哪些问法」显式写下来并参与前置层匹配，是把改写式查询从语义层救回词面层的唯一办法。
 */
function queriesOf(body: string): string[] {
  const m = /```queries\n([\s\S]*?)```/.exec(body)
  if (!m) return []
  return m[1].split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}

/**
 * 前置层匹配（标题 / 问法 / 标签，均无需读正文）。
 * 与上游一致：一个查询对一页只取**最高**的那一档，不叠加（if/elif 链）。
 */
function frontMatch(e: PageEntry, q: string, tokens: readonly string[]): FrontMatch | null {
  const title = e.page.title.toLowerCase()
  const titleRatio = matchRatio(title, tokens)
  if (titleRatio > 0) {
    // 精确命中（id 或标题与查询词完全相等）拿最高基础分；这是同一档内的分数细化，
    // 不改变「谁命中前置层」这件事。
    const exact = e.id.toLowerCase() === q || title === q
    const base = (exact ? MATCH_SCORE.exactTitle : MATCH_SCORE.title) * titleRatio
    // 护栏只认「全部词命中」：多词查询只命中一个词时不该停手，否则弱前置命中会截断正文层与 L4。
    // 单 token 查询命中即占比 1 → guards 仍为 true，护栏契约与改动前一致。
    return { layer: 'title', base, guards: titleRatio === 1 }
  }
  // 问法层：能力页的 ```queries 块。权重介于标题(6)与标签(4)之间——
  // 它是「人工/挖掘时显式声明的问法」，比标签更接近真实提问，但不该压过标题。
  const declared = queriesOf(e.page.body)
  if (declared.length > 0) {
    let best = 0
    for (const dq of declared) {
      const r = matchRatio(dq.toLowerCase(), tokens)
      if (r > best) best = r
    }
    if (best > 0) return { layer: 'queries', base: MATCH_SCORE.queries * best, guards: best === 1 }
  }
  const tagRatio = e.page.tags.reduce((max, t) => Math.max(max, matchRatio(t.toLowerCase(), tokens)), 0)
  if (tagRatio > 0) return { layer: 'tag', base: MATCH_SCORE.tag * tagRatio, guards: tagRatio === 1 }
  // id 精确相等但标题不含查询词：产生候选并给最高分，但**不**触发护栏（见 guards 说明）。
  if (e.id.toLowerCase() === q) return { layer: 'title', base: MATCH_SCORE.exactTitle, guards: false }
  return null
}

/** 打分：基础分 + 度加权，再乘 tier 权重（与上游 graphrag._score 同式）。 */
function scoreOf(base: number, degree: number, tier: WikiTier): number {
  return (base + Math.min(degree * DEGREE_STEP, MAX_DEGREE_BONUS)) * TIER_WEIGHT[tier]
}

/**
 * 页面的 wikilink 度（出链 + 入链），只统计指向库内真实页的链接；
 * 同一页重复指向同一目标只计一次——否则一个反复引用同一页的文档会虚增双方度数。
 */
function degreeMap(entries: PageEntry[]): Map<string, number> {
  const degree = new Map<string, number>()
  const known = new Set(entries.map((e) => e.id))
  for (const e of entries) degree.set(e.id, 0)
  for (const e of entries) {
    const linked = new Set<string>()
    for (const m of e.page.body.matchAll(WIKILINK_RE)) {
      const target = m[1].trim()
      if (target === e.id || !known.has(target) || linked.has(target)) continue
      linked.add(target)
      degree.set(e.id, (degree.get(e.id) ?? 0) + 1)
      degree.set(target, (degree.get(target) ?? 0) + 1)
    }
  }
  return degree
}

/** 按 score 降序返回前 max 条；同分用度降序、页面路径升序兜底，使结果可复现且不依赖文件遍历顺序。 */
function rank(cands: RetrievalCandidate[], degree: Map<string, number>, max: number): RetrievalCandidate[] {
  return [...cands]
    .sort((a, b) =>
      b.score - a.score
      || (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)
      || (a.page < b.page ? -1 : a.page > b.page ? 1 : 0))
    .slice(0, max)
}

/** 把语义命中映射为候选；只接受库内真实页面，去重后保持后端给出的顺序。 */
function semanticCandidates(
  store: VaultStore,
  hits: SemanticPageHit[] | undefined,
  pages: { id: string; category: WikiCategory }[],
  degree: Map<string, number>,
): RetrievalCandidate[] {
  if (!hits || hits.length === 0) return []
  const known = new Set(pages.map((p) => `${p.category}/${p.id}`))
  const out: RetrievalCandidate[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    const key = `${hit.category}/${hit.id}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!known.has(key)) continue // 库内不存在的页面（含越界路径）直接丢弃
    const page = store.readPage(hit.id, hit.category)
    if (!page) continue
    out.push(semanticCandidate({ id: hit.id, category: hit.category, page }, out.length + 1, hit.snippet))
  }
  return out
}

/**
 * 语义候选：**分值只由语义通道名次决定**，与 tier、度无关（原因见 SEMANTIC_RANK_BASE）。
 * 借用 candidate() 组装其余字段（page/title/tier/source/snippet 的口径与其它层一致），
 * 只把分值替换成名次分——这是「语义层不参与词面之上排序」的实现点。
 */
function semanticCandidate(e: PageEntry, rank: number, snippetOverride?: string): RetrievalCandidate {
  const base = candidate(e, 'semantic', 0, NO_DEGREE, snippetOverride)
  return { ...base, score: semanticScore(rank) }
}

/**
 * L1 快速层：只读 index.md 的命中行，不建全图。
 * 因此这里不做度加权（度为 0），分数只由基础分 × tier 权重构成；也刻意**不重排**——
 * index.md 的顺序是人工维护的目录顺序，比常量分排序更有信息量（见 spec 的「可牺牲」项）。
 */
function indexOnly(store: VaultStore, q: string, tokens: readonly string[], max: number): RetrievalCandidate[] {
  const out: RetrievalCandidate[] = []
  const noDegree = new Map<string, number>()
  const indexPath = join(store.wikiRoot, 'index.md')
  try {
    const lines = readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n').split('\n')
    for (const line of lines) {
      const m = line.match(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/)
      if (m && matchRatio(line.toLowerCase(), tokens) > 0) {
        const id = m[1].trim()
        let page: WikiPage | null = null
        for (const cat of RETRIEVAL_CATEGORIES) {
          page = store.readPage(id, cat)
          if (page) break
        }
        if (page) {
          out.push(candidate({ id, category: page.category, page }, 'index', MATCH_SCORE.index, noDegree, line.trim().slice(0, MAX_SNIPPET)))
          if (out.length >= max) break
        }
      }
    }
  } catch {
    // index.md 缺失时 L1 无候选，降级交给调用方
  }
  return out
}

function candidate(
  e: PageEntry,
  matchedBy: RetrievalCandidate['matchedBy'],
  base: number,
  degree: Map<string, number>,
  snippetOverride?: string,
  matchIndex?: number,
): RetrievalCandidate {
  const tier = normalizeTier(e.page.tier)
  return {
    page: `${e.category}/${e.id}.md`,
    id: e.id,
    category: e.category,
    title: e.page.title,
    confidence: e.page.confidence,
    snippet: snippetOverride ?? snippet(e.page.body, matchedBy, matchIndex),
    matchedBy,
    score: scoreOf(base, degree.get(e.id) ?? 0, tier),
    tier,
    source: e.page.source,
  }
}

function snippet(body: string, matchedBy: RetrievalCandidate['matchedBy'], matchIndex?: number): string {
  if (matchedBy === 'title' || matchedBy === 'tag' || matchedBy === 'summary') {
    const first = body.split('\n').find((l) => l.trim().length > 0) ?? ''
    return first.slice(0, MAX_SNIPPET)
  }
  if (typeof matchIndex === 'number') {
    // L3：以命中位置为中心的窗口（±100，收拢到正文边界，≤200 字符）
    const start = Math.max(0, matchIndex - MAX_SNIPPET / 2)
    return body.slice(start, start + MAX_SNIPPET)
  }
  return body.slice(0, MAX_SNIPPET)
}

/**
 * 返回页面正文中的出链 target 列表（[[b]]、[[c|别名]]、[[d#锚点]] 均归一为 id，
 * 锚点与别名被剥离），供 L4 图谱遍历与跨页关联复用。
 */
export function linkedPages(store: VaultStore, id: string, category: WikiCategory): string[] {
  const page = store.readPage(id, category)
  if (!page) return []
  const out: string[] = []
  for (const m of page.body.matchAll(WIKILINK_RE)) {
    out.push(m[1].trim())
  }
  return out
}
