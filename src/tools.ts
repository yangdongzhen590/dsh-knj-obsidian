// src/tools.ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { VaultStore } from './vault-store.ts'
import type { VaultProvider } from './types.ts'
import type { WikiCategory, WikiTier, Confidence, WikiPage } from './types.ts'
import { lintVault, auditTags } from './lint.ts'
import { loadTaxonomy, SYSTEM_TAG_PREFIX } from './taxonomy.ts'
import { retrieve, RETRIEVAL_CATEGORIES } from './retriever.ts'
import type { SemanticPageHit } from './retriever.ts'
import { recordQueryMiss, missLogEnabled } from './miss-log.ts'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { buildGraph, exportGraphHtml } from './graph-engine.ts'
import { mineEnums, mineTables } from './code-miner.ts'
import { readProgress, markModule, pendingModules, progressFileFor } from './mining-progress.ts'
import { relatedHits } from './related-check.ts'
import { createCheckpoint, listCheckpoints } from './checkpoint.ts'
import { rebuildIndex } from './index-builder.ts'
import {
  createSemanticRuntime, runOfflineSearch, notReadyMessage, resolveStateHome, DEFAULT_MODEL_FILENAME, collectionIdOf,
  type SemanticHit, type SemanticRuntime,
} from './semantic-index.ts'
import {
  semanticFallbackEnabled, semanticRuntimeFor, semanticRuntimeError, disposeSemanticRuntimes, workspaceNameOf,
  clampLimit, semanticRawHits, type SemanticRuntimeFactory,
} from './semantic-hits.ts'
import { refresherFor, vaultRootOf } from './semantic-refresh.ts'
import {
  drillQuery, drillPage, readPageDetail, drillEnabled,
  type DrillSemanticBackend, type DrillSemanticStatus,
} from './drill.ts'

/** wiki_mine 输出的表候选 items（dbNew/dbChanged/dbUnchanged/tables 共用）。 */
const TABLE_ITEM_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    table: { type: 'string' }, module: { type: 'string' }, file: { type: 'string' },
    line: { type: 'number' }, hash: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' } },
    columns: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string' }, type: { type: 'string' },
          nullable: { type: 'boolean' }, comment: { type: 'string' },
          primaryKey: { type: 'boolean' }, line: { type: 'number' },
        },
      },
    },
    indexes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string' }, columns: { type: 'array', items: { type: 'string' } },
          unique: { type: 'boolean' }, line: { type: 'number' },
        },
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          from: { type: 'string' }, toTable: { type: 'string' },
          toColumn: { type: 'string' }, line: { type: 'number' },
        },
      },
    },
    comment: { type: 'string' },
  },
} as const

/** 每个工具执行时解析当前库（v7：agent 工具跟随 UI 切换的当前库）。写路径必须 ensure 脚手架。 */
function currentStore(provider: VaultProvider): VaultStore {
  return provider.current() as VaultStore
}

/**
 * 写页后主动回报的标签现状（**全库口径**，不是本批次口径）——把标签维护从「拉」变「推」：
 * 不主动报，词表就永远不会演化（没人会想起来调 wiki_lint）。
 * 只报，不改：新增规范词是知识分类判断，必须由人/agent 决定。
 */
export interface TagHint {
  taxonomyPresent: boolean
  unknownCount: number
  aliasCount: number
  untaggedCount: number
  /** 出现 ≥2 页的未知词 —— 达到词表自己的升表门槛，可直接粘进库级词表 */
  promote: { tag: string; pages: string[] }[]
  localTypeTags: string[]
  shadowedBaseTags: string[]
}

function tagHintOf(store: VaultStore): TagHint {
  const t = auditTags(store)
  return {
    taxonomyPresent: t.taxonomyPresent,
    unknownCount: t.unknown.length,
    aliasCount: t.aliasUsed.length,
    untaggedCount: t.untagged.length,
    promote: t.promote,
    localTypeTags: t.localTypeTags,
    shadowedBaseTags: t.shadowedBaseTags,
  }
}

/** 标签提示的统一文案。promote 给成可粘贴形式，让维护动作退化成复制粘贴。 */
function renderTagHint(h: TagHint): string {
  if (!h.taxonomyPresent) return '标签：无有效词表'
  const bits = [`未知 ${h.unknownCount}`, `别名 ${h.aliasCount}`, `零标签 ${h.untaggedCount}`]
  const tail: string[] = []
  if (h.promote.length > 0) tail.push(`建议升表（≥2 页，粘进 _meta/taxonomy.md）：${h.promote.map((p) => `\`${p.tag}\`(${p.pages.length}页)`).join('、')}`)
  if (h.localTypeTags.length > 0) tail.push(`上游候选 Type 词：${h.localTypeTags.map((x) => `\`${x}\``).join('、')}`)
  if (h.shadowedBaseTags.length > 0) tail.push(`⚠ 库级词表重复登记了基础层已有的词（会遮蔽基础层更新，建议删掉）：${h.shadowedBaseTags.map((x) => `\`${x}\``).join('、')}`)
  return `标签（全库）：${bits.join('，')}${tail.length > 0 ? '；' + tail.join('；') : ''}`
}

/** wiki_ingest / wiki_capture 共用的 tagAudit 输出 schema 片段。
 *  注意两点：
 *  1) **不加外层 `required: true`** —— ingest 的 contentHash 命中会走「跳过」快路径，那条路
 *     不该为了报标签而多跑一遍全库审计，所以 tagAudit 是可选的。
 *  2) `as const` 不可省：抽成常量后失去字面量上下文，TS 会把 `type: 'object'` 拓宽成 string，
 *     不再满足 schema 的判别联合类型。 */
const TAG_HINT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    taxonomyPresent: { type: 'boolean', required: true },
    unknownCount: { type: 'number', required: true },
    aliasCount: { type: 'number', required: true },
    untaggedCount: { type: 'number', required: true },
    promote: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
        properties: { tag: { type: 'string', required: true }, pages: { type: 'array', items: { type: 'string' }, required: true } },
      },
    },
    localTypeTags: { type: 'array', items: { type: 'string' }, required: true },
    shadowedBaseTags: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

/** 只读工具用：零写副作用（不 ensure/mkdir），避免“查询即建库”把未初始化库标记成已初始化。
 *  防御式：真实 provider（VaultStore/VaultManager）都实现 currentReadonly；测试替身只有 current()
 *  时回退，保证只读语义不因替身缺方法而崩溃。 */
function currentReadonlyStore(provider: VaultProvider): VaultStore {
  const p = provider as VaultProvider & { currentReadonly?: () => unknown }
  if (typeof p.currentReadonly === 'function') return p.currentReadonly() as VaultStore
  return provider.current() as VaultStore
}

/**
 * wiki_query 的语义兜底阈值：词面候选少于该数时才启用语义层（省算力——嵌入调用只在词面几乎无果时发生）。
 *
 * **不要再放宽这道门。** 2026-10-17 实测否掉了「Top1 分低也兜底」的改法（证据见
 * `.wiki/concepts/语义融合会顶掉正确的词面-top1.md`）：10 条改写式查询上，纯词面 Top1 命中 6/10，
 * 加上「Top1 < 4 也兜底」后掉到 4/10（2 个退步、0 个改进），平均耗时 5ms → 1791ms。
 * 机制是**结构性**的而非噪声：`MATCH_SCORE.semantic`(3) 无条件高于 body(1)/summary(2)/graph(0.5)，
 * 而「Top1 < 4」恰好等价于「Top1 来自 body/summary/graph」——新门一开，语义候选必然压过
 * 那个（正确的）弱 Top1。要改进召回，该修的是语义融合的打分（见同一知识页），不是这道门。
 */
export const SEMANTIC_FALLBACK_MIN_CANDIDATES = 2

export interface MountToolsOptions {
  /** 测试注入点：替换语义运行时创建（默认按当前库创建进程内 QMD 运行时）。 */
  semanticRuntimeFactory?: (vaultRoot: string) => Promise<SemanticRuntime>
}

/** 语义命中 → retriever 的 SemanticPageHit（分类白名单在这里与 retriever 内部各校验一次）。 */
function toSemanticPageHits(results: readonly SemanticHit[]): SemanticPageHit[] {
  const out: SemanticPageHit[] = []
  for (const r of results) {
    if (!RETRIEVAL_CATEGORIES.includes(r.category as WikiCategory)) continue
    out.push({ id: r.id, category: r.category as WikiCategory, ...(r.snippet ? { snippet: r.snippet } : {}) })
  }
  return out
}

// ---------- 语义运行时：按库缓存与开关已抽到 src/semantic-hits.ts ----------
//
// 为什么抽出去：L1 任务级触发的字面兜底（trigger.ts）需要复用**同一个**按库根缓存的运行时——
// 模型只加载一次，且触发层只接受「已热」的运行时（冷启动几十秒，不能挂住 pre-step）。
// 此处只留工具侧的接线，语义语义（只读、降级、白名单）不变。

export function mountTools(ctx: Context, provider: VaultProvider, opts: MountToolsOptions = {}): () => void {
  const runtimeFactory: SemanticRuntimeFactory =
    opts.semanticRuntimeFactory ?? ((root: string) => createSemanticRuntime({ vaultRoot: root }))

  /**
   * 零候选时记一条未命中（诊断用）。**绝不影响检索结果**：只读、失败静默、开关可关。
   * 这是「库缺什么」的原始数据来源，也是命中率的原生埋点。
   */
  function recordMissIfEmpty(
    result: { candidates: readonly unknown[]; totalPages: number },
    query: string,
    mode: string,
    semanticTried: boolean,
  ): void {
    if (result.candidates.length > 0 || !missLogEnabled()) return
    try {
      const vaultRoot = provider.currentRecord()?.root ?? vaultRootOf(currentReadonlyStore(provider))
      recordQueryMiss({
        at: new Date().toISOString(),
        vaultRoot,
        workspace: workspaceNameOf(vaultRoot),
        query,
        mode,
        totalPages: result.totalPages,
        semanticTried,
      })
    } catch {
      // 诊断日志绝不打断检索
    }
  }

  /**
   * wiki_query 的语义兜底：词面几乎无果时调一次语义运行时，把命中交给 retrieve() 融合。
   * 任何不可用/失败（模型缺失、库缺失、索引为空、后端抛错）都返回空数组 → 调用方保持纯词面结果，
   * 绝不抛错、不联网、不建索引。（本函数**允许**惰性加载运行时；触发层用 requireWarm 那一路。）
   */
  async function semanticFallbackHits(query: string, limit: number): Promise<SemanticPageHit[]> {
    const vaultRoot = provider.currentRecord()?.root ?? vaultRootOf(currentReadonlyStore(provider))
    const hits = await semanticRawHits({ vaultRoot, query, limit, factory: runtimeFactory })
    return toSemanticPageHits(hits)
  }

  ctx.tools.register(defineTool({
    name: 'wiki_ingest',
    description: '把 agent 提取好的知识页写入项目 wiki（.wiki/）。入参 pages 为页面数组；source 为源材料标识。同一 source 重新导入时覆盖更新（保留 frontmatter 的 created，更新 updated）；库内已有同 id 页面但来自不同 source 时不覆盖，自动加 -2/-3 后缀新建（防止跨源静默丢失旧内容）。传入 contentHash（源内容 SHA-256）且与 manifest 记录一致时整体跳过本次 ingest。',
    parameters: {
      source: { type: 'string', required: true, description: '源材料标识：文件路径 / URL / agent:<source>' },
      contentHash: { type: 'string', description: '源内容 SHA-256；与 manifest 记录一致时跳过本次 ingest' },
      pages: {
        type: 'array', required: true, description: '提取出的页面',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', required: true, description: 'kebab-case 稳定 id' },
            title: { type: 'string', required: true },
            category: { type: 'string', required: true, enum: ['concepts', 'entities', 'references', 'synthesis', 'projects', 'dictionaries', 'tables'] },
            tags: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'string', enum: ['extracted', 'inferred', 'ambiguous'] },
            // 人工摘要与分层：给了就落进 frontmatter。摘要必须与正文不同的措辞才有检索价值
            // （摘要层只在正文不命中时才产生候选），故这里只透传、不代写。
            summary: { type: 'string', description: '一句话摘要（写入 frontmatter summary:）；缺省时沿用页面已有摘要，仍无则从正文首行派生' },
            tier: { type: 'string', enum: ['core', 'supporting', 'peripheral'], description: '重要性分层（写入 frontmatter tier:）；缺省 supporting' },
            body: { type: 'string', required: true, description: 'markdown 正文，不含 frontmatter' },
          },
          additionalProperties: false,
        },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          created: { type: 'array', items: { type: 'string' }, required: true },
          updated: { type: 'array', items: { type: 'string' }, required: true },
          skipped: { type: 'boolean', required: true },
          // v12：写入前自动创建的还原点 id（缺省表示快照创建失败）——批次级回滚凭据
          checkpointId: { type: 'string' },
          // v9：每页库内相关已有页对账（agent 据此补链/去重）
          relatedCheck: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string' }, title: { type: 'string' }, category: { type: 'string' },
                related: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      id: { type: 'string' }, title: { type: 'string' }, category: { type: 'string' },
                      matchedBy: { type: 'string' }, linked: { type: 'boolean' }, strong: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
          // 写页后主动回报全库标签现状（把标签维护从「拉」变「推」）
          tagAudit: TAG_HINT_SCHEMA,
        },
      },
      render: (_args, value) => {
        if (value.skipped) return [{ type: 'text', text: '内容未变化，跳过本次 ingest' }]
        const rel = value.relatedCheck ?? []
        const relSafe = rel.map((e) => ({ ...e, related: e.related ?? [] }))
        const open = relSafe.flatMap((e) => e.related.filter((r) => !r.linked).map((r) => `${e.id} ↔ [[${r.id}]]`))
        const dup = relSafe.flatMap((e) => e.related.filter((r) => r.strong).map((r) => `${e.id} 疑似与 [[${r.id}]] 重复`))
        const tip = open.length + dup.length > 0
          ? `；对账提示：${[...dup, ...open].slice(0, 6).join('；')}（未链可补链，重复建议并入已有页后重导）`
          : ''
        const ckpt = value.checkpointId ? `；还原点 ${value.checkpointId}（不满意可回滚）` : '；⚠ 本次未能创建还原点'
        const tagTip = value.tagAudit ? `；${renderTagHint(value.tagAudit)}` : ''
        return [{ type: 'text', text: `写入 wiki：新建 ${value.created.length} 页，更新 ${value.updated.length} 页${ckpt}${tagTip}${tip}` }]
      },
    },
    async execute(args) {
      const store = currentStore(provider)
      if (args.contentHash) {
        const prev = store.manifestEntry(args.source)
        if (prev && prev.content_hash === args.contentHash) {
          return { created: [], updated: [], skipped: true }
        }
      }
      const created: string[] = []
      const updated: string[] = []
      const now = new Date().toISOString()
      const produced: string[] = []
      const createdPages: Array<{ id: string; title: string; category: WikiCategory; body: string }> = []
      // 结构性保证（信任优先）：真正写入前**自动创建还原点**，不再只靠提示词要求。
      // 调用方仍可在报告里引用返回的 checkpointId 做批次级回滚。
      let checkpointId: string | undefined
      try { checkpointId = createCheckpoint(store).id } catch { /* 快照失败不阻塞写入，但会在返回里体现为 undefined */ }
      for (const p of args.pages) {
        const cat = p.category as WikiCategory
        const conf = (p.confidence ?? 'extracted') as Confidence
        const existing = store.readPage(p.id, cat)
        // 跨源同 id 冲突避让（与 importer.ts 语义一致）：旧页来自别的 source 时不覆盖——
        // 覆盖会让旧源内容静默丢失，且旧源在 manifest 里的 content_hash 仍匹配，重导被 skip，无恢复路径。
        let id = p.id
        let reused = existing // 用于保留 created 的已有页（同源原 id，或本源的 -N 页）
        if (existing && existing.source !== args.source) {
          // 先复用「本 source 已建立的 -N 页」更新，找不到才在第一个空后缀新建。
          // 否则本 source 每次重导都再避让一次 → -3/-4/-5… 无限膨胀、旧页陈旧。
          let own: WikiPage | null = null
          let free = ''
          for (let suffix = 2; !own && !free; suffix++) {
            const candidate = store.readPage(`${p.id}-${suffix}`, cat)
            if (!candidate) free = `${p.id}-${suffix}`
            else if (candidate.source === args.source) own = candidate
          }
          if (own) { id = own.id; reused = own }
          else id = free
        }
        const page: WikiPage = {
          id,
          title: p.title,
          category: cat,
          tags: p.tags ?? [],
          source: args.source,
          confidence: conf,
          created: reused && reused.source === args.source ? reused.created : now,
          updated: now,
          // 只透传调用方显式给出的值：不给就交给 writePage（沿用页面已有摘要，否则从正文派生），
          // 避免这里塞 undefined 覆盖掉磁盘上的人工摘要。
          ...(p.summary?.trim() ? { summary: p.summary } : {}),
          // 未显式给 tier 时沿用页面已有分层，同样不覆盖成缺省值。
          ...(p.tier ? { tier: p.tier as WikiTier } : reused?.tier ? { tier: reused.tier } : {}),
          body: p.body,
        }
        const res = store.writePage(page)
        if (res.created) { created.push(id); createdPages.push({ id, title: p.title, category: cat, body: p.body }) }
        else updated.push(id)
        produced.push(id)
      }
      const hash = args.contentHash ?? store.sha256(args.source + JSON.stringify(args.pages))
      store.updateManifest(args.source, {
        content_hash: hash,
        last_ingested: now,
        pages_produced: produced,
      })
      // v9：对本次新建的页检索库内相关已有页（排除同批产出），驱动 agent 补链/去重
      const producedSet = new Set(produced)
      const relatedCheck = createdPages
        .map((cp) => ({ id: cp.id, title: cp.title, category: cp.category, related: relatedHits(store, producedSet, cp) }))
        .filter((e) => e.related.length > 0)
      // 索引是派生工件：写完立即重建，避免 L1 检索/索引页在用户手动重建前看不到新页
      try { rebuildIndex(store) } catch { /* 索引重建失败不影响入库结果 */ }
      // 语义索引（v8）：落盘后安排一次 debounce 后台刷新（模型未就位时只会如实记录，不联网）
      try {
        const root = provider.currentRecord()?.root ?? vaultRootOf(store)
        refresherFor(root).schedule('wiki_ingest')
      } catch { /* 刷新调度失败不影响入库结果 */ }
      return { created, updated, skipped: false, relatedCheck, checkpointId, tagAudit: tagHintOf(store) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_capture',
    description: '把当前讨论沉淀成一条知识页（quick 模式写入 references/ 单页）。',
    parameters: {
      title: { type: 'string', required: true },
      body: { type: 'string', required: true, description: '声明式知识内容（非对话记录）' },
      category: { type: 'string', enum: ['concepts', 'entities', 'references', 'synthesis', 'projects', 'dictionaries', 'tables'] },
      tags: { type: 'array', items: { type: 'string' }, description: '标签数组；缺省为空数组（quick 捕获常来不及定标签，可稍后补）' },
      summary: { type: 'string', description: '一句话摘要（写入 frontmatter summary:）；缺省时沿用页面已有摘要，仍无则从正文首行派生' },
      tier: { type: 'string', enum: ['core', 'supporting', 'peripheral'], description: '重要性分层（写入 frontmatter tier:）；缺省 supporting' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          page: { type: 'string', required: true },
          // v9：库内相关已有页（防重复沉淀 / 提示补链）
          related: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string' }, title: { type: 'string' }, category: { type: 'string' },
                matchedBy: { type: 'string' }, linked: { type: 'boolean' }, strong: { type: 'boolean' },
              },
            },
          },
          // 写页后主动回报全库标签现状
          tagAudit: TAG_HINT_SCHEMA,
        },
      },
      render: (_args, value) => {
        const dup = (value.related ?? []).filter((r) => r.strong)
        const tip = dup.length > 0 ? `；⚠ 库内已有同名页 [[${dup[0].id}]]，建议并入或改名` : ''
        const tagTip = value.tagAudit ? `；${renderTagHint(value.tagAudit)}` : ''
        return [{ type: 'text', text: `已沉淀到 ${value.page}${tip}${tagTip}` }]
      },
    },
    async execute(args) {
      const store = currentStore(provider)
      const now = new Date().toISOString()
      // kebab-case（保留 CJK 字符）：id 直接用作文件名，VaultStore 校验通过即可
      const baseId = args.title.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '') || `note-${Date.now()}`
      const cat = (args.category ?? 'references') as WikiCategory
      // 跨源防覆盖 + 防 -N 膨胀（与 importer/wiki_ingest 同语义）：
      // ① 同名页来自其他 source → 不覆盖；② 先找自己（agent:capture）的 -N 页更新，
      // 只有确实没有才取第一个空闲后缀新建（否则每次重捕都再避让一次，堆 -3/-4…）。
      let id = baseId
      let priorCreated: string | undefined
      const base = store.readPage(baseId, cat)
      if (base && base.source === 'agent:capture') {
        priorCreated = base.created
      } else if (base) {
        let own: string | undefined
        let free: string | undefined
        for (let suffix = 2; !own && !free; suffix++) {
          const candidate = store.readPage(`${baseId}-${suffix}`, cat)
          if (!candidate) free = `${baseId}-${suffix}`
          else if (candidate.source === 'agent:capture') own = `${baseId}-${suffix}`
        }
        id = own ?? free ?? baseId
        const target = store.readPage(id, cat)
        if (target?.source === 'agent:capture') priorCreated = target.created
      }
      // 标签：以前硬编码空数组，导致「快速捕获」这条路径结构上不可能有标签。
      // 现在接受调用方显式给出的标签；不给仍为空数组（保持既有行为，不回归）。
      const tags = Array.isArray(args.tags)
        ? args.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim())
        : []
      store.writePage({
        id, title: args.title, category: cat, tags, source: 'agent:capture',
        confidence: 'inferred', created: priorCreated ?? now, updated: now, body: args.body,
        // 只在显式给出时透传；否则交给 writePage 沿用已有摘要 / 从正文派生。
        ...(args.summary?.trim() ? { summary: args.summary } : {}),
        ...(args.tier ? { tier: args.tier as WikiTier } : {}),
      })
      const related = relatedHits(store, new Set<string>(), { id, title: args.title, category: cat, body: args.body })
      // 索引是派生工件：写完必须立即重建。否则新页在 index.md 里看不到，而 index.md 正是
      // L1 / index-only 检索的唯一来源——实测曾有一个 capture 出来的页面滞后 12 天不可检索。
      try { rebuildIndex(store) } catch { /* 索引重建失败不影响沉淀结果 */ }
      // 语义索引同样要跟上：capture 是本库当前的主力写路径（实测 21 页里 8 页来自 agent:capture），
      // 而它原先没有 schedule——即"词面层搜得到、语义层搜不到"。debounce + 单飞会把连续 capture 合并成一次。
      try {
        const root = provider.currentRecord()?.root ?? vaultRootOf(store)
        refresherFor(root).schedule('wiki_capture')
      } catch { /* 刷新调度失败不影响沉淀结果 */ }
      return { page: `${cat}/${id}.md`, related, tagAudit: tagHintOf(store) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_normalize_tags',
    description: '按词表把页面标签收敛到规范词。默认只做**确定性**的别名映射（pitfalls→pitfall、plugins→dsh）；若要处理词表未登记的未知词（词表规则第 7 条：1 页的换成更宽的规范词），用 mapping 把人工判断显式传进来——本工具自己绝不发明映射。默认 dryRun=true 只报告不改；真要改时先建还原点再改写，返回 checkpointId 可整批回滚。执行完会重建索引。',
    parameters: {
      dryRun: { type: 'boolean', description: 'true（默认）= 只报告将改哪些页，不落盘；false = 真实改写（会先建还原点）' },
      mapping: {
        type: 'array',
        description: '显式替换表（承载人工判断）：{from, to} 把 from 收敛成规范词 to；省略 to 表示删除该标签。别名映射自动进行，无需在此重复。',
        items: {
          type: 'object', additionalProperties: false,
          properties: { from: { type: 'string', required: true }, to: { type: 'string' } },
        },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          dryRun: { type: 'boolean', required: true },
          checkpointId: { type: 'string' },
          checkpointFailed: { type: 'boolean' },
          // 每页改动明细：from/to 为标签数组，便于人工核对
          changed: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                category: { type: 'string', required: true },
                from: { type: 'array', items: { type: 'string' }, required: true },
                to: { type: 'array', items: { type: 'string' }, required: true },
              },
            },
          },
          skipped: { type: 'number', required: true },
          // 改写后仍不是规范词的标签（多为 mapping 里写错目标词）——用来兜住人工判断的手滑
          stillUnknown: { type: 'array', items: { type: 'string' }, required: true },
          // 被改到「一个标签都不剩」的页：可能是 mapping 把某页的标签全删了，值得核对
          becameUntagged: { type: 'array', items: { type: 'string' }, required: true },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const n = value.changed.length
        const head = value.dryRun
          ? `试运行：将改写 ${n} 页`
          : n === 0
            ? '无需改写：0 页（标签已符合词表）'
            : `已改写 ${n} 页`
        // 只在**确实有改动**时才谈还原点：0 改动时不建还原点是正确行为，不能报成失败
        // （实测踩到过：幂等重跑第二次会误报「未能创建还原点」）。
        const ckpt = value.dryRun || n === 0
          ? ''
          : value.checkpointFailed
            ? '；⚠ 未能创建还原点，本次改动不可整批回滚'
            : value.checkpointId
              ? `；还原点 ${value.checkpointId}（不满意可整批回滚）`
              : '；⚠ 未创建还原点，本次改动不可整批回滚'
        const sample = value.changed.slice(0, 5).map((c) => `${c.id}: ${c.from.join('/')} → ${c.to.join('/')}`)
        const more = value.changed.length > 5 ? `；…其余 ${value.changed.length - 5} 页` : ''
        const body = sample.length > 0 ? `；${sample.join('；')}${more}` : ''
        const warn: string[] = []
        if (value.stillUnknown.length > 0) warn.push(`⚠ 改写后仍非规范词（检查 mapping 目标词）：${value.stillUnknown.map((x) => `\`${x}\``).join('、')}`)
        if (value.becameUntagged.length > 0) warn.push(`⚠ 这些页被改到一个标签都不剩，请核对：${value.becameUntagged.join('、')}`)
        const note = value.note ? `；${value.note}` : ''
        const warnText = warn.length > 0 ? `；${warn.join('；')}` : ''
        return [{ type: 'text', text: `${head}（跳过 ${value.skipped} 页）${ckpt}${body}${warnText}${note}` }]
      },
    },
    async execute(args) {
      const dryRun = args.dryRun !== false // 默认 dryRun：写操作必须显式传 false
      const store = currentStore(provider)
      const taxonomy = loadTaxonomy(store)

      // 显式替换表：承载**人工判断**（词表规则第 7 条）。本工具不发明映射，只执行给进来的。
      const explicit = new Map<string, string | null>()
      for (const m of (args.mapping ?? []) as { from?: unknown; to?: unknown }[]) {
        const from = typeof m?.from === 'string' ? m.from.trim() : ''
        if (!from) continue
        const to = typeof m?.to === 'string' && m.to.trim() !== '' ? m.to.trim() : null
        explicit.set(from, to)
      }

      if ((!taxonomy || taxonomy.aliases.size === 0) && explicit.size === 0) {
        return { dryRun, changed: [], skipped: 0, stillUnknown: [], becameUntagged: [], note: '无有效词表且未提供 mapping，无可归一化的内容' }
      }

      // 先别名映射（确定性），再显式替换（人工判断），最后同页去重并保持原顺序。
      const plans: { id: string; category: WikiCategory; from: string[]; to: string[]; page: ReturnType<typeof store.readPage> }[] = []
      let skipped = 0
      for (const p of store.listPages()) {
        const page = store.readPage(p.id, p.category)
        if (!page) { skipped++; continue } // 无 frontmatter 的页跳过，不抛错
        const to: string[] = []
        for (const t of page.tags) {
          let mapped = taxonomy?.aliases.get(t) ?? t
          if (explicit.has(mapped)) {
            const target = explicit.get(mapped)!
            if (target === null) continue // 显式删除该标签
            mapped = target
          }
          if (!to.includes(mapped)) to.push(mapped)
        }
        const same = to.length === page.tags.length && to.every((t, i) => t === page.tags[i])
        if (same) continue
        plans.push({ id: p.id, category: p.category, from: [...page.tags], to, page })
      }

      // 人工判断的手滑兜底：改写后仍非规范词的标签；以及被改空的页
      const isKnown = (t: string) => t.startsWith(SYSTEM_TAG_PREFIX) || (taxonomy?.canonical.has(t) ?? false)
      const stillUnknown = [...new Set(plans.flatMap((pl) => pl.to.filter((t) => !isKnown(t))))].sort()
      const becameUntagged = plans.filter((pl) => pl.from.length > 0 && pl.to.length === 0).map((pl) => pl.id)

      if (dryRun || plans.length === 0) {
        return {
          dryRun,
          changed: plans.map(({ id, category, from, to }) => ({ id, category, from, to })),
          skipped, stillUnknown, becameUntagged,
        }
      }

      // 真实写入：先建还原点（失败不阻塞，但要如实告知不可整批回滚）
      let checkpointId: string | undefined
      let checkpointFailed = false
      try {
        checkpointId = createCheckpoint(store).id
      } catch {
        checkpointFailed = true
      }

      const now = new Date().toISOString()
      for (const plan of plans) {
        const page = plan.page!
        store.writePage({
          id: page.id,
          title: page.title,
          category: page.category,
          tags: plan.to,
          source: page.source,
          confidence: page.confidence,
          created: page.created, // 保留创建时间
          updated: now,
          body: page.body,
          // 显式透传摘要与分层，保证 writePage 不会重派生、也不丢字段
          ...(page.summary ? { summary: page.summary } : {}),
          ...(page.tier ? { tier: page.tier } : {}),
        })
      }
      try { rebuildIndex(store) } catch { /* 索引重建失败不影响归一化结果 */ }

      return {
        dryRun: false,
        ...(checkpointId ? { checkpointId } : {}),
        ...(checkpointFailed ? { checkpointFailed: true } : {}),
        changed: plans.map(({ id, category, from, to }) => ({ id, category, from, to })),
        skipped, stillUnknown, becameUntagged,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_lint',
    description: '检查 wiki 健康度：孤儿页、断链（[[wikilink]] 指向不存在页）、缺 frontmatter，以及标签审计（未知标签 / 用了别名 / 超每页上限 / 零标签页，对齐上游 tag-taxonomy）。',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          orphans: { type: 'array', items: { type: 'string' }, required: true },
          brokenLinks: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                from: { type: 'string', required: true },
                target: { type: 'string', required: true },
              },
            },
          },
          missingFrontmatter: { type: 'array', items: { type: 'string' }, required: true },
          pageCount: { type: 'number', required: true },
          tags: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              taxonomyPresent: { type: 'boolean', required: true },
              vaultTaxonomyPresent: { type: 'boolean', required: true },
              unknown: {
                type: 'array', required: true,
                items: {
                  type: 'object', additionalProperties: false,
                  properties: { tag: { type: 'string', required: true }, pages: { type: 'array', items: { type: 'string' }, required: true } },
                },
              },
              aliasUsed: {
                type: 'array', required: true,
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    tag: { type: 'string', required: true }, canonical: { type: 'string', required: true },
                    pages: { type: 'array', items: { type: 'string' }, required: true },
                  },
                },
              },
              overTagged: {
                type: 'array', required: true,
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true }, count: { type: 'number', required: true },
                    tags: { type: 'array', items: { type: 'string' }, required: true },
                  },
                },
              },
              untagged: { type: 'array', items: { type: 'string' }, required: true },
              // 遮蔽：库级词表重复登记了基础层已有的词，会让基础层对该词的后续更新失效
              shadowedBaseTags: { type: 'array', items: { type: 'string' }, required: true },
              // 升表候选：出现 ≥2 页的未知词（词表自己的门槛）
              promote: {
                type: 'array', required: true,
                items: {
                  type: 'object', additionalProperties: false,
                  properties: { tag: { type: 'string', required: true }, pages: { type: 'array', items: { type: 'string' }, required: true } },
                },
              },
              // 上游候选：本库新增的 Type 词（基础层没有）
              localTypeTags: { type: 'array', items: { type: 'string' }, required: true },
            },
          },
        },
      },
      render: (_args, value) => {
        const t = value.tags
        const base = `lint：${value.pageCount} 页，孤儿 ${value.orphans.length}，断链 ${value.brokenLinks.length}，缺 frontmatter ${value.missingFrontmatter.length}`
        if (!t.taxonomyPresent) return [{ type: 'text', text: `${base}；标签：无有效词表（基础词表缺失且本库无 _meta/taxonomy.md），仅报超上限 ${t.overTagged.length} / 零标签 ${t.untagged.length}` }]
        const scope = t.vaultTaxonomyPresent ? '基础层+本库' : '仅基础层（Type 轴）'
        const parts = [`词表 ${scope}`, `未知 ${t.unknown.length}`, `别名 ${t.aliasUsed.length}`, `超上限 ${t.overTagged.length}`, `零标签 ${t.untagged.length}`]
        const hint: string[] = []
        if (t.promote.length > 0) hint.push(`建议升表（≥2 页，粘进 _meta/taxonomy.md 的 Domain/Project 小节）：${t.promote.map((p) => `\`${p.tag}\`(${p.pages.length}页)`).join('、')}`)
        if (t.localTypeTags.length > 0) hint.push(`上游候选 Type 词（基础层没有，先在本库用着）：${t.localTypeTags.map((x) => `\`${x}\``).join('、')}`)
        if (t.shadowedBaseTags.length > 0) hint.push(`⚠ 库级词表重复登记了基础层已有的词（会遮蔽基础层更新，建议从库级文件删掉）：${t.shadowedBaseTags.map((x) => `\`${x}\``).join('、')}`)
        const tail = hint.length > 0 ? `；${hint.join('；')}` : ''
        return [{ type: 'text', text: `${base}；标签：${parts.join('，')}${tail}` }]
      },
    },
    async execute() {
      return lintVault(currentReadonlyStore(provider))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_query',
    description: '从项目 wiki（.wiki/）检索知识。分层：L1 index 快速层（index-only 模式）→ L2 标题/标签/摘要 → L3 正文 → L4 wikilink 图谱邻居。候选带相关性 score 并按分降序返回（title 精确10/标题6/标签4/摘要2 + 度加权 × tier 权重），因此第 1 条就是最该先看的页面。只读，不修改任何页面。答案由调用者基于候选合成。',
    parameters: {
      query: { type: 'string', required: true, description: '检索词' },
      mode: { type: 'string', enum: ['auto', 'index-only'], description: 'auto=分层检索；index-only=只查 index.md（快速，不建全图）' },
      maxCandidates: { type: 'number', description: '最多返回候选数（默认 10）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          candidates: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                page: { type: 'string', required: true },
                id: { type: 'string', required: true },
                category: { type: 'string', required: true },
                title: { type: 'string', required: true },
                confidence: { type: 'string', required: true },
                snippet: { type: 'string', required: true },
                matchedBy: { type: 'string', required: true },
                score: { type: 'number', required: true },
                tier: { type: 'string', required: true },
                source: { type: 'string', required: true },
              },
            },
          },
          strategy: { type: 'string', required: true },
          totalPages: { type: 'number', required: true },
        },
      },
      render: (args, value) => value.candidates.length === 0
        ? [{ type: 'text', text: `wiki 无匹配（${value.totalPages} 页）。可以说「把 XX 吸收进 wiki」来添加知识。` }]
        // index-only 刻意保持 index.md 的人工目录顺序、不按分重排，这里就不能声称「按分降序」
        : [{ type: 'text', text: `检索到 ${value.candidates.length} 条候选（${value.strategy}${args.mode === 'index-only' ? '，按 index.md 目录顺序' : '，按分降序'}）：${value.candidates.map((c) => `${c.id}(${c.score.toFixed(1)})`).join('、')}` }],
    },
    async execute(args) {
      const store = currentReadonlyStore(provider)
      const mode = args.mode === 'index-only' ? 'index-only' : 'auto'
      const maxCandidates = args.maxCandidates ?? 10
      const wordFace = retrieve(store, args.query, { mode, maxCandidates })
      // index-only 是「只读 index.md」的快速路径契约，不掺语义层；
      // 词面候选够多时也不打扰语义层（嵌入调用只在词面几乎无果时发生）。
      // 这道门**只有候选数一个条件**：2026-10-17 实测证明再叠一条「Top1 分低也兜底」会让 Top1 精度
      // 从 6/10 掉到 4/10（机制见 SEMANTIC_FALLBACK_MIN_CANDIDATES 的注释），不要加回来。
      if (mode === 'index-only' || wordFace.candidates.length >= SEMANTIC_FALLBACK_MIN_CANDIDATES) {
        recordMissIfEmpty(wordFace, args.query, mode, false)
        return wordFace
      }
      const semanticHits = await semanticFallbackHits(args.query, maxCandidates)
      const semanticTried = semanticFallbackEnabled()
      if (semanticHits.length === 0) {
        recordMissIfEmpty(wordFace, args.query, mode, semanticTried)
        return wordFace
      }
      const merged = retrieve(store, args.query, { mode, maxCandidates, semanticHits })
      recordMissIfEmpty(merged, args.query, mode, semanticTried)
      return merged
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_export',
    description: '把 wiki 的 wikilink 图谱导出为 graph.json（结构化数据）或 graph.html（单文件交互可视化，浏览器可开）。写入 <项目根>/.wiki/wiki-export/，返回路径相对 .wiki/。',
    parameters: {
      format: { type: 'string', enum: ['html', 'json'], description: 'html=交互图谱；json=结构化图数据' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          file: { type: 'string', required: true },
          nodeCount: { type: 'number', required: true },
          edgeCount: { type: 'number', required: true },
        },
      },
      render: (_args, value) => {
        const base = `图谱已导出：${value.nodeCount} 节点 / ${value.edgeCount} 边 → ${value.file}`
        // FM1：空 vault / <2 页 → 导出仍成功，但附加图谱过小提示（spec 失败模式承诺）
        const hint = value.nodeCount < 2 ? ' 图谱过小（<2 页），图谱意义有限——先吸收几份文档再导出' : ''
        return [{ type: 'text', text: base + hint }]
      },
    },
    async execute(args) {
      const store = currentStore(provider)
      const format = args.format === 'json' ? 'json' : 'html'
      const graph = buildGraph(store)
      const exportDir = join(store.wikiRoot, 'wiki-export')
      mkdirSync(exportDir, { recursive: true })
      const file = format === 'json' ? 'graph.json' : 'graph.html'
      const content = format === 'json' ? JSON.stringify(graph, null, 2) : exportGraphHtml(graph)
      writeFileSync(join(exportDir, file), content, 'utf8')
      return { file: `wiki-export/${file}`, nodeCount: graph.nodes.length, edgeCount: graph.edges.length }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_mine',
    description: '从当前工作区项目静态挖掘代码结构候选（枚举字典/表结构），供蒸馏后经 wiki_ingest 入库。大纲→细节两阶段；每次运行输出枚举级对账报告（new/changed/unchanged/deleted）：未挖=new、挖过无变=unchanged、有变化=changed、代码已删=deleted。resume 时按 progress.json 只处理未完成模块，断点续传。',
    parameters: {
      kind: { type: 'string', enum: ['enum', 'db', 'both'], description: '挖掘类型：enum=枚举字典；db=表结构（M2 实现）；both=两者' },
      module: { type: 'string', description: '模块过滤（可选）：只挖指定模块' },
      resume: { type: 'boolean', description: '断点续传：读 progress.json 只处理 pending/partial 模块' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          enums: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string' }, module: { type: 'string' }, file: { type: 'string' },
                line: { type: 'number' }, kind: { type: 'string' }, hash: { type: 'string' },
                values: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      name: { type: 'string' }, code: { type: 'string' },
                      label: { type: 'string' }, line: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
          new: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string' }, module: { type: 'string' }, file: { type: 'string' },
                line: { type: 'number' }, kind: { type: 'string' }, hash: { type: 'string' },
                values: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      name: { type: 'string' }, code: { type: 'string' },
                      label: { type: 'string' }, line: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
          changed: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string' }, module: { type: 'string' }, file: { type: 'string' },
                line: { type: 'number' }, kind: { type: 'string' }, hash: { type: 'string' },
                values: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      name: { type: 'string' }, code: { type: 'string' },
                      label: { type: 'string' }, line: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
          unchanged: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string' }, module: { type: 'string' }, file: { type: 'string' },
                line: { type: 'number' }, kind: { type: 'string' }, hash: { type: 'string' },
                values: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      name: { type: 'string' }, code: { type: 'string' },
                      label: { type: 'string' }, line: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
          deleted: { type: 'array', items: { type: 'string' }, required: true },
          tables: { type: 'array', required: true, items: TABLE_ITEM_SCHEMA },
          dbNew: { type: 'array', required: true, items: TABLE_ITEM_SCHEMA },
          dbChanged: { type: 'array', required: true, items: TABLE_ITEM_SCHEMA },
          dbUnchanged: { type: 'array', required: true, items: TABLE_ITEM_SCHEMA },
          dbDeleted: { type: 'array', items: { type: 'string' }, required: true },
          outline: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                module: { type: 'string' }, fileCount: { type: 'number' }, enumEstimate: { type: 'number' },
                tableEstimate: { type: 'number' },
              },
            },
          },
          modules: { type: 'array', items: { type: 'string' }, required: true },
          remaining: { type: 'number', required: true },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const enumPart = value.enums.length > 0 ? `枚举 ${value.new.length} 新 · ${value.changed.length} 变 · ${value.unchanged.length} 无变 · ${value.deleted.length} 删` : ''
        const dbPart = value.tables.length > 0 ? `表 ${value.dbNew.length} 新 · ${value.dbChanged.length} 变 · ${value.dbUnchanged.length} 无变 · ${value.dbDeleted.length} 删` : ''
        const base = `挖掘：${value.modules.length} 模块 / ${[enumPart, dbPart].filter(Boolean).join('；')}，剩 ${value.remaining} 模块待挖`
        return [{ type: 'text', text: value.enums.length === 0 && value.tables.length === 0 && value.deleted.length === 0 && value.dbDeleted.length === 0 ? `${base}（${value.note ?? ''}）` : base }]
      },
    },
    async execute(args) {
      // 挖掘是只读扫描（不建库）；进度只写已初始化库的 _system，避免“挖掘即建库”
      const store = currentReadonlyStore(provider)
      const canPersistProgress = existsSync(store.wikiRoot)
      const projectRoot = join(store.wikiRoot, '..') // .wiki 的父目录 = 项目根
      const kind = args.kind ?? 'both'
      const progressFile = progressFileFor(store.wikiRoot, 'enum')
      const progress = readProgress(progressFile, 'enum')
      const dbProgressFile = progressFileFor(store.wikiRoot, 'db')
      const dbProgress = readProgress(dbProgressFile, 'db')
      const resumeOnly = args.resume
        ? (() => {
            const pending = new Set([...pendingModules(progress), ...pendingModules(dbProgress)])
            // 无 pending 记录（首次挖 / 已全部 done）时不做过滤，否则 resume 会把结果全滤空
            return pending.size > 0 ? pending : null
          })()
        : null
      // deleted 对账只在「未过滤的完整扫描」下才有意义：带 module/resume 过滤时，
      // 过滤范围之外的文件本来就不会被扫到，不能据此判删（否则对账报告系统性误报）。
      const isFullScan = !args.module && !args.resume

      // ---- 枚举分支 ----
      const enumResult = (kind === 'enum' || kind === 'both')
        ? mineEnums(projectRoot, args.module)
        : { enums: [], outline: [], modules: [] }
      let enums = enumResult.enums
      if (resumeOnly && enums.length > 0) enums = enums.filter((e) => resumeOnly.has(e.module))
      const newE: typeof enums = []
      const changedE: typeof enums = []
      const unchangedE: typeof enums = []
      for (const e of enums) {
        const prev = store.manifestEntry(`mine:enum:${e.file}`)
        if (!prev) newE.push(e)
        else if (prev.content_hash === e.hash) unchangedE.push(e)
        else changedE.push(e)
      }
      const deleted: string[] = []
      if (isFullScan) {
        const scannedFiles = new Set(mineEnums(projectRoot).enums.map((e) => e.file))
        for (const src of store.manifestSources()) {
          if (src.startsWith('mine:enum:') && !scannedFiles.has(src.slice('mine:enum:'.length))) {
            deleted.push(src.slice('mine:enum:'.length))
          }
        }
      }

      // ---- 表结构分支（M2） ----
      const tableResult = (kind === 'db' || kind === 'both')
        ? mineTables(projectRoot, args.module)
        : { tables: [], outline: [], modules: [] }
      let tables = tableResult.tables
      if (resumeOnly && tables.length > 0) tables = tables.filter((t) => resumeOnly.has(t.module))
      const dbNew: typeof tables = []
      const dbChanged: typeof tables = []
      const dbUnchanged: typeof tables = []
      for (const t of tables) {
        const prev = store.manifestEntry(`mine:db:${t.file}`)
        if (!prev) dbNew.push(t)
        else if (prev.content_hash === t.hash) dbUnchanged.push(t)
        else dbChanged.push(t)
      }
      const dbDeleted: string[] = []
      if (isFullScan && (kind === 'db' || kind === 'both')) {
        const scannedDbFiles = new Set(mineTables(projectRoot).tables.map((t) => t.file))
        for (const src of store.manifestSources()) {
          if (src.startsWith('mine:db:') && !scannedDbFiles.has(src.slice('mine:db:'.length))) {
            dbDeleted.push(src.slice('mine:db:'.length))
          }
        }
      }

      const note = enums.length === 0 && deleted.length === 0 && tables.length === 0 && dbDeleted.length === 0
        ? '当前项目未发现枚举/常量类或数据库表结构' : undefined

      // 断点续传进度落盘（严重修复）：本次「扫描并对账」覆盖到的模块标记为 done，
      // 未出现在本次结果里的模块（resume 时被过滤掉的）保持原状态。
      // 这样 wiki_mine { resume: true } 才真正只处理 pending/partial 模块。
      try {
        if (!canPersistProgress) throw new Error('vault not initialized; skip progress persistence')
        if (kind === 'enum' || kind === 'both') {
          const covered = new Set([...newE, ...changedE, ...unchangedE].map((e) => e.module))
          for (const m of covered) markModule(progress, m, 'done', progressFile)
        }
        if (kind === 'db' || kind === 'both') {
          const covered = new Set([...dbNew, ...dbChanged, ...dbUnchanged].map((t) => t.module))
          for (const m of covered) markModule(dbProgress, m, 'done', dbProgressFile)
        }
      } catch { /* 进度写失败不影响本次结果 */ }

      // lossless JSON：execute 返回值会跨进程序列化，undefined 字段（EnumValue.code/label 等 optional）会被拒绝。
      return JSON.parse(JSON.stringify({
        enums, new: newE, changed: changedE, unchanged: unchangedE, deleted,
        tables, dbNew, dbChanged, dbUnchanged, dbDeleted,
        outline: [...enumResult.outline, ...tableResult.outline],
        modules: [...enumResult.modules, ...tableResult.modules],
        remaining: resumeOnly ? resumeOnly.size : (enumResult.modules.length + tableResult.modules.length), note,
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_init',
    description: '初始化知识库：为【当前库】创建 .wiki 脚手架（index.md / .manifest.json / 概念·实体·参考资料·综合·项目知识·字典·数据结构 七个分类目录）。幂等：已存在时只补缺失结构并返回 created=false。工作区里还没有知识库时先用它，再用 wiki-collect/wiki_ingest 写入。要初始化别的库，请先在边栏切到该库。',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          wikiRoot: { type: 'string', required: true },
          created: { type: 'boolean', required: true },
          pageCount: { type: 'number', required: true },
        },
      },
      render: (_args, value) => {
        const action = value.created ? '已初始化' : '已存在（幂等，无需重复初始化）'
        return [{ type: 'text', text: `${action}知识库：${value.wikiRoot}（当前 ${value.pageCount} 页）。可继续用 wiki-collect 采集代码结构，或用 wiki_ingest/wiki_capture 写入知识页。` }]
      },
    },
    async execute() {
      const store = currentStore(provider)
      const wikiRoot = store.wikiRoot
      const existed = existsSync(wikiRoot)
      store.ensure()
      return { root: (provider.currentRecord()?.root ?? ''), wikiRoot, created: !existed, pageCount: store.listPagesReadonly().length }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_checkpoint',
    description: '创建知识库还原点：把当前全部知识页 + index.md + .manifest.json 快照到 <vault>/_system/checkpoints/。批量蒸馏/采集入库【之前】必须先调用它拿还原点 id；用户对批次质量不满意时可凭该 id 在边栏一键回滚。恢复操作在 GUI 完成（工具只建快照、不恢复）。',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true, description: '还原点 id（时间戳派生）' },
          createdAt: { type: 'string', required: true },
          pageCount: { type: 'number', required: true, description: '快照时的页面总数' },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `还原点已创建：${value.id}（快照 ${value.pageCount} 页）。请在质量评估报告中引用该 id，用户可凭它回滚本批次。` },
      ],
    },
    async execute() {
      return createCheckpoint(currentStore(provider))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_checkpoints',
    description: '列出当前知识库的全部还原点（新→旧），含 id / createdAt / pageCount。用于回答“有哪些还原点可回滚”。',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          checkpoints: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: { id: { type: 'string' }, createdAt: { type: 'string' }, pageCount: { type: 'number' } },
            },
          },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: value.checkpoints.length === 0
          ? '当前没有还原点。批量入库前请先调用 wiki_checkpoint 创建一个。'
          : `共 ${value.checkpoints.length} 个还原点：${value.checkpoints.map((c) => `${c.id}(${c.pageCount}页)`).join('、')}` },
      ],
    },
    async execute() {
      return { checkpoints: listCheckpoints(currentReadonlyStore(provider)) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_search_semantic',
    description: '对知识库做【本地语义检索】（进程内集成 QMD 库 + 本地 300M 嵌入模型，不需要单独安装/启动 QMD，也不需要 QMD 插件）。只启用两条离线通道——本地嵌入向量 + BM25 关键词，并在本地 RRF 融合；云端查询扩展/精排模型被显式禁用，任何情况下都不联网下载。返回有界结果（默认 8 条、上限 20）含页面 id/分类/标题/片段/相关度（融合分数，非概率）。模型缺失、索引为空或陈旧时会如实说明并指向更新动作；纯关键词检索请继续用 wiki_query（本工具不假装关键词结果=语义结果）。',
    parameters: {
      query: { type: 'string', required: true, description: '自然语言问题或关键词' },
      limit: { type: 'number', description: '返回条数（默认 8，硬上限 20）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, description: 'ready | index-empty | index-stale | model-missing | library-missing' },
          limit: { type: 'number', required: true },
          count: { type: 'number', required: true },
          stale: { type: 'boolean' },
          message: { type: 'string' },
          results: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string' }, category: { type: 'string' }, title: { type: 'string' },
                snippet: { type: 'string' }, score: { type: 'number' },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value.status === 'model-missing' || value.status === 'library-missing') {
          return [{ type: 'text', text: value.message ?? '语义检索未就绪' }]
        }
        const head = value.count === 0
          ? `语义检索无命中（模板 ${value.status}）`
          : `语义检索命中 ${value.count} 条（模板 ${value.status}）：${value.results.map((r) => `${r.id}(${r.category})`).join('、')}`
        const note = value.message ? `；${value.message}` : ''
        return [{ type: 'text', text: head + note }]
      },
    },
    async execute(args) {
      const limit = clampLimit(args.limit)
      const store = currentReadonlyStore(provider)
      const vaultRoot = provider.currentRecord()?.root ?? join(store.wikiRoot, '..')
      // 复用按库缓存的语义运行时（与 wiki_query 的兜底、wiki_drill 同一条缓存）：
      // 旧实现在这里**每次调用**自建 store 再 close，等于每次都重新加载 300M 嵌入模型
      // —— 2026-10-17 实测 7–10 秒/次，而缓存路径首次之后只要 28–83ms（差 100 倍以上）。
      // 注意这**不受 KNJ_OBSIDIAN_SEMANTIC_FALLBACK 影响**：那个开关关的是「兜底」，
      // 本工具是用户显式要求的语义检索，必须照常可用（与 wiki_drill 的开关口径一致）。
      const runtime = await semanticRuntimeFor(vaultRoot, runtimeFactory)

      // 严格离线：模型缺失时只给可执行信息，不联网、不报错
      // 缓存路径可能返回 null（工厂抛错）——这类失败没有 runtime.loadError，
      // 原因由 semanticRuntimeError 单独记着，照样如实带出，不退回「猜一个原因」。
      if (!runtime) {
        return {
          status: 'library-missing' as const, limit, count: 0, results: [],
          message: notReadyMessage('library-missing', undefined, undefined, semanticRuntimeError(vaultRoot)),
        }
      }
      if (!runtime.modelPresent) {
        const paths = resolveStateHome()
        return {
          status: 'model-missing' as const, limit, count: 0, results: [],
          message: notReadyMessage('model-missing', paths.modelsDir, DEFAULT_MODEL_FILENAME),
        }
      }
      if (!runtime.store) {
        return {
          status: 'library-missing' as const, limit, count: 0, results: [],
          message: notReadyMessage('library-missing', undefined, undefined, runtime.loadError),
        }
      }

      const semantic = runtime.store
      if (runtime.status === 'index-empty') {
        return {
          status: 'index-empty' as const, limit, count: 0, results: [],
          message: '语义索引为空：请先在边栏点「更新索引」（或让 agent 触发更新），首次全量嵌入约 1–2 分钟。',
        }
      }

      // 严格离线：只用「本地嵌入模型向量通道 + BM25 关键词通道」并在本地融合。
      // 刻意不调用 store.search()——QMD 的混合检索会拉起查询扩展(1.7B)与精排(0.6B)两个云端模型，
      // 缺失时 node-llama-cpp 会自动去 HuggingFace 下载，与「绝不联网」冲突。
      //
      // 这里**不能**再 close store：运行时是按库缓存、与其它消费者共用的，
      // 关掉它会让后续调用（含 wiki_drill 与触发层）拿到失效句柄。句柄由
      // disposeSemanticRuntimes() 在插件卸载时统一释放。
      const outcome = await runOfflineSearch(semantic, args.query, limit, collectionIdOf(vaultRoot))
      const staleNote = runtime.status === 'index-stale'
        ? `索引有 ${runtime.index.pendingEmbedding} 篇未嵌入（结果可能不含最新页）：建议点「更新索引」或在边栏查看语义索引状态。`
        : ''
      const note = [outcome.degraded, staleNote].filter(Boolean).join('；')
      return {
        status: runtime.status, limit, count: outcome.results.length, results: outcome.results,
        ...(runtime.status === 'index-stale' ? { stale: true } : {}),
        ...(note ? { message: note } : {}),
      }
    },
  }))

  // ---------- wiki_drill / wiki_read：语义种子 + 一跳双链下钻（设计 docs/2026-09-27-wiki-drill-design.md） ----------
  //
  // 与 wiki_query 的关系：wiki_query 一字不改（它的词面优先语义与打分公式被 60+ 例测试锁着，
  // 且语义层 spec 首条优先级是「零行为变更」）。新语义只在新工具里长。

  /**
   * 为 wiki_drill 组装语义后端。任何不可用都返回 null + 如实状态，绝不抛错：
   * 复用按库缓存的语义运行时（模型只加载一次），通道失败由 runOfflineSearch 如实回报。
   * 注意：KNJ_OBSIDIAN_SEMANTIC_FALLBACK=off 一并关掉下钻的语义通道——用户设这个开关的意图
   * 就是「别加载 300M 模型」，新消费者不该偷偷绕开它。
   */
  async function drillSemanticProbe(): Promise<{
    backend: DrillSemanticBackend | null
    status: DrillSemanticStatus
    holder: { degraded?: string }
  }> {
    const holder: { degraded?: string } = {}
    if (!semanticFallbackEnabled()) {
      return { backend: null, status: 'disabled', holder: { degraded: '语义层已被 KNJ_OBSIDIAN_SEMANTIC_FALLBACK=off 关闭。' } }
    }
    const base = currentReadonlyStore(provider)
    const vaultRoot = provider.currentRecord()?.root ?? vaultRootOf(base)
    const runtime = await semanticRuntimeFor(vaultRoot, runtimeFactory)
    if (!runtime) return { backend: null, status: 'library-missing', holder }
    if (!runtime.modelPresent) return { backend: null, status: 'model-missing', holder }
    if (!runtime.store) return { backend: null, status: 'library-missing', holder }
    const qmd = runtime.store
    const backend: DrillSemanticBackend = {
      name: 'qmd-offline',
      async search(query, searchOpts) {
        // 严格离线：只用本地向量 + BM25 两通道并在本地融合，绝不调 store.search()（会拉起云端模型）
        // 限定本库 collection：否则下钻会种进别库的页（见 runOfflineSearch）。
        const outcome = await runOfflineSearch(qmd, query, searchOpts?.limit ?? 5, collectionIdOf(vaultRoot))
        if (outcome.degraded) holder.degraded = outcome.degraded
        return outcome.results.map((r) => ({ id: r.id, category: r.category as WikiCategory, snippet: r.snippet }))
      },
    }
    return { backend, status: runtime.status, holder }
  }

  function recordDrillMiss(res: { seeds: readonly unknown[]; totalPages: number }, query: string, semanticTried: boolean): void {
    if (res.seeds.length > 0 || !missLogEnabled()) return
    try {
      const vaultRoot = provider.currentRecord()?.root ?? vaultRootOf(currentReadonlyStore(provider))
      recordQueryMiss({ at: new Date().toISOString(), vaultRoot, workspace: basename(vaultRoot), query, mode: 'drill', totalPages: res.totalPages, semanticTried })
    } catch {
      // 诊断日志绝不打断检索
    }
  }

  const DRILL_NEIGHBOR_SCHEMA = {
    type: 'object', additionalProperties: false,
    properties: {
      id: { type: 'string', required: true }, category: { type: 'string', required: true },
      title: { type: 'string', required: true }, tier: { type: 'string', required: true },
      direction: { type: 'string', required: true }, broken: { type: 'boolean', required: true },
      degree: { type: 'number', required: true }, via: { type: 'string', required: true },
      matchedBy: { type: 'string', required: true }, score: { type: 'number', required: true },
    },
  } as const

  const DRILL_SEED_SCHEMA = {
    type: 'object', additionalProperties: false,
    properties: {
      page: { type: 'string', required: true }, id: { type: 'string', required: true },
      category: { type: 'string', required: true }, title: { type: 'string', required: true },
      confidence: { type: 'string', required: true }, tier: { type: 'string', required: true },
      source: { type: 'string', required: true }, snippet: { type: 'string', required: true },
      score: { type: 'number', required: true }, matchedBy: { type: 'string', required: true },
      sources: { type: 'array', required: true, items: { type: 'string' } },
      neighbors: { type: 'array', required: true, items: DRILL_NEIGHBOR_SCHEMA },
    },
  } as const

  ctx.tools.register(defineTool({
    name: 'wiki_drill',
    description: '语义种子 + 一跳双链下钻。模式 A（给 query）：QMD 语义（本地向量+BM25，离线）与词面两路按名次 RRF 融合出种子页，每个种子附带【一跳】wikilink 邻居（带方向 out/in、断链标记 broken、来源 via）。模式 B（给 page）：已知页 id 时做纯图下钻（毫秒级、不跑嵌入）。刻意只给一跳——实测库内两跳即覆盖全库 40%–60%，更深请用 page 模式逐跳迭代。邻居的 matchedBy 恒为 graph-neighbor，属「顺链到达」，证据强度低于直接命中。只读，零写入。',
    parameters: {
      query: { type: 'string', description: '模式 A：自然语言问题或关键词（走语义 + 词面融合）' },
      page: { type: 'string', description: '模式 B：页面 id（纯图下钻，不跑嵌入）' },
      limit: { type: 'number', description: '模式 A 种子数，默认 5、上限 10' },
      neighbors: { type: 'number', description: '每个种子/页面附带的邻居数，默认 8、上限 20' },
      direction: { type: 'string', enum: ['out', 'in', 'both'], description: '模式 B 的邻接方向，默认 both' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          mode: { type: 'string', required: true },
          strategy: { type: 'string', required: true },
          totalPages: { type: 'number', required: true },
          seeds: { type: 'array', required: true, items: DRILL_SEED_SCHEMA },
          truncated: {
            type: 'object', additionalProperties: false,
            properties: { seeds: { type: 'boolean', required: true }, neighbors: { type: 'boolean', required: true } },
          },
          message: { type: 'string' },
          semantic: {
            type: 'object', additionalProperties: false,
            properties: { status: { type: 'string', required: true }, degraded: { type: 'string' } },
          },
        },
      },
      render: (_args, value) => {
        if (value.seeds.length === 0) {
          return [{ type: 'text', text: value.message ?? `下钻无结果（${value.totalPages} 页）。` }]
        }
        const parts = value.seeds.map((s) => {
          const nb = s.neighbors.length > 0
            ? ` → 邻居：${s.neighbors.map((n) => `${n.id}${n.broken ? '(断链)' : n.direction === 'in' ? '(入)' : '(出)'}`).join('、')}`
            : ' → 无库内双链'
          return `${s.id}[${s.matchedBy}]${nb}`
        })
        const note = value.message ? `；${value.message}` : ''
        const cut = value.truncated ? '（已截断）' : ''
        return [{ type: 'text', text: `下钻 ${value.seeds.length} 个种子（${value.strategy}）${cut}：${parts.join('｜')}${note}` }]
      },
    },
    async execute(args) {
      const store = currentReadonlyStore(provider)
      if (!drillEnabled()) {
        return {
          mode: 'query' as const, strategy: 'disabled', seeds: [], totalPages: store.listPagesReadonly().length,
          message: 'wiki_drill 已由 KNJ_OBSIDIAN_DRILL=off 关闭（wiki_query 与 wiki_search_semantic 不受影响）。',
        }
      }
      if (args.page) {
        return drillPage(store, args.page, { neighbors: args.neighbors, direction: args.direction })
      }
      if (!args.query) {
        return {
          mode: 'query' as const, strategy: 'empty-query', seeds: [], totalPages: store.listPagesReadonly().length,
          message: '请给出 query（语义种子 + 一跳邻居）或 page（已知 id 的纯图下钻）之一。',
        }
      }
      const probe = await drillSemanticProbe()
      const res = await drillQuery(store, args.query, {
        semantic: probe.backend,
        semanticStatus: probe.status,
        ...(probe.holder.degraded ? { semanticDegraded: probe.holder.degraded } : {}),
        limit: args.limit,
        neighbors: args.neighbors,
      })
      recordDrillMiss(res, args.query, probe.status !== 'disabled')
      return res
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_read',
    description: '读取 wiki 页面的整页正文（含 frontmatter 摘要、tier、confidence）以及出链/入链清单（含断链）。用于「引用前读原文」——只用检索返回的 snippet 合成答案会产生「有引用格式、没读原文」的伪知识。只读，零写入。',
    parameters: {
      id: { type: 'string', required: true, description: '页面 id（kebab-case，与 frontmatter/filename 一致）' },
      category: { type: 'string', description: '可选：同 id 跨分类歧义时显式指定分类' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          message: { type: 'string' },
          page: { type: 'string' }, id: { type: 'string' }, category: { type: 'string' },
          title: { type: 'string' }, tier: { type: 'string' }, confidence: { type: 'string' },
          summary: { type: 'string' }, body: { type: 'string' },
          outLinks: { type: 'array', items: { type: 'string' } },
          brokenLinks: { type: 'array', items: { type: 'string' } },
          inLinks: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        if (!value.found) return [{ type: 'text', text: value.message ?? '页面不存在。' }]
        const out = value.outLinks?.length ? `出链 ${value.outLinks.length}（断链 ${value.brokenLinks?.length ?? 0}）` : '无出链'
        const inc = value.inLinks?.length ? `入链 ${value.inLinks.length}` : '无入链'
        return [{
          type: 'text',
          text: `${value.page}（${value.title}，tier=${value.tier}，confidence=${value.confidence}）｜${out}｜${inc}\n\n${value.body ?? ''}`,
        }]
      },
    },
    async execute(args) {
      const store = currentReadonlyStore(provider)
      const detail = readPageDetail(store, args.id, args.category as WikiCategory | undefined)
      if (!detail) {
        return { found: false as const, message: `页面 id 不存在：${args.id}。可先用 wiki_query 或 wiki_drill 找到真实 id。` }
      }
      return { found: true as const, ...detail }
    },
  }))

  return () => { disposeSemanticRuntimes() }
}
