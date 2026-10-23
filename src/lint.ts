// src/lint.ts
import type { VaultStore } from './vault-store.ts'
import { loadTaxonomy, isSystemTag, TAG_LIMIT, TYPE_SECTION, type Taxonomy, type LoadTaxonomyOptions } from './taxonomy.ts'

/** 标签审计结果（对齐上游 tag-taxonomy Mode 1 的四类问题 + 分层词表带来的两项提示）。 */
export interface TagAudit {
  /** 是否存在可用词表（基础层或本库层任一有效）。false 时 unknown/aliasUsed/promote 恒为空 */
  taxonomyPresent: boolean
  /** 是否存在有效的**本库**词表文件（_meta/taxonomy.md）。false 表示只靠基础层的 Type 轴 */
  vaultTaxonomyPresent: boolean
  /** 不在词表里的标签（≥1 页）*/
  unknown: { tag: string; pages: string[] }[]
  /** 用了别名而非规范词 */
  aliasUsed: { tag: string; canonical: string; pages: string[] }[]
  /** 超过每页上限的页（系统标签不计入）*/
  overTagged: { id: string; count: number; tags: string[] }[]
  /** 零标签页（系统标签不算「有标签」）*/
  untagged: string[]
  /**
   * 升表候选：出现 **≥2 页**的未知词。按词表自己的门槛，只有这些才值得进库级词表——
   * 只出现 1 页的应当换成更宽的规范词，而不是新增。
   */
  promote: { tag: string; pages: string[] }[]
  /**
   * 「上游候选」：本库词表里新增的 Type 词（基础层没有）。Type 轴影响跨项目可比性，
   * 所以新 Type 词先在库级用一阵，确认在 ≥2 个项目都要用后再提到基础层随插件发布。
   */
  localTypeTags: string[]
  /**
   * 「遮蔽」：库级词表**重复登记了基础层已有的词**。因为合并规则是「库级覆盖基础层」，
   * 这些重复项会让基础层对该词的后续更新永远到不了这个库。库级文件只该管 Domain/Project。
   */
  shadowedBaseTags: string[]
}

export interface LintReport {
  orphans: string[]
  brokenLinks: { from: string; target: string }[]
  missingFrontmatter: string[]
  pageCount: number
  /** 标签审计（对齐上游 tag-taxonomy；无有效词表时仍给出 overTagged/untagged） */
  tags: TagAudit
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g

/**
 * 剥掉 Markdown 的代码区域（围栏代码块 + 行内代码），返回仅剩「正文」的文本。
 *
 * 为什么必须剥（2026-10-24 实测）：知识页正文里会用 `[[wikilink]]` 这种**示例字面量**
 * 讲"链接长什么样"，直接对正文跑 WIKILINK_RE 会把它当成真链接，于是 lint 报出
 * 不存在的断链（本库当时报 3 条，全是同一个假目标）。诊断工具撒谎比不报更贵——
 * 它会让人去修一个不存在的问题。
 *
 * 取舍：只处理围栏代码块与行内代码，**不**处理四空格缩进代码块——宁少剥不多剥，
 * 剥过头会把真断链藏起来。未闭合的围栏视为「其后全是代码」。
 */
export function stripCodeRegions(body: string): string {
  const kept: string[] = []
  let fenceChar: string | null = null
  for (const line of body.split('\n')) {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fenceChar === null) {
      if (fence) {
        fenceChar = fence[1][0]
        continue
      }
      // 行内代码：去除 `…` 段；不跨行匹配
      kept.push(line.replace(/`[^`]*`/g, ''))
    } else if (fence && fence[1][0] === fenceChar) {
      fenceChar = null // 闭合围栏，该行本身也是围栏标记，丢弃
    }
  }
  return kept.join('\n')
}

/** 库根索引页的 id：它天然没有入链，不是「没织好」，不计孤儿。 */
const INDEX_PAGE_ID = 'index'

/** 业务标签：排除系统标签组（visibility/*）——它们不计上限、不参与别名映射、不算未知。 */
function domainTags(tags: readonly string[]): string[] {
  return tags.filter((t) => !isSystemTag(t))
}

/**
 * 标签审计。四类问题与上游一致：未知 / 别名 / 超上限 / 零标签；另加两项分层带来的提示：
 * 升表候选（≥2 页的未知词）与上游候选（库级新增的 Type 词）。
 *
 * 设计取舍（对齐上游）：
 * - 没有**任何**有效词表时**不报**未知/别名/升表——没有「规范」可言，把整库标签报成未知只会是噪声。
 *   超上限与零标签不依赖词表，照报。
 * - 系统标签 visibility/* 全部豁免：不计上限、不查别名、不算未知，也不算「这页有标签」。
 * - 判定优先级：规范词 > 别名 > 未知。
 */
export function auditTags(store: VaultStore, taxonomy: Taxonomy | null = loadTaxonomy(store)): TagAudit {
  // listPagesReadonly：lint 是**只读**诊断，不能因为跑一次检查就给空壳库建出脚手架
  // （listPages() 内部会 ensure()，这正是"看一眼就建库"的来源之一）。
  const pages = store.listPagesReadonly()
  const unknownPages = new Map<string, string[]>()
  const aliasPages = new Map<string, { canonical: string; pages: string[] }>()
  const overTagged: TagAudit['overTagged'] = []
  const untagged: string[] = []

  for (const p of pages) {
    const page = store.readPage(p.id, p.category)
    if (!page) continue // 无 frontmatter 的页已由 missingFrontmatter 报，这里不重复报
    const tags = domainTags(page.tags)
    if (tags.length === 0) untagged.push(p.id)
    if (tags.length > TAG_LIMIT) overTagged.push({ id: p.id, count: tags.length, tags })
    if (!taxonomy) continue
    for (const t of tags) {
      const canonical = taxonomy.aliases.get(t)
      if (canonical) {
        const hit = aliasPages.get(t) ?? { canonical, pages: [] }
        hit.pages.push(p.id)
        aliasPages.set(t, hit)
      } else if (!taxonomy.canonical.has(t)) {
        const list = unknownPages.get(t) ?? []
        list.push(p.id)
        unknownPages.set(t, list)
      }
    }
  }

  const byTag = (a: { tag: string }, b: { tag: string }) => (a.tag < b.tag ? -1 : 1)
  const unknown = [...unknownPages.entries()].map(([tag, pgs]) => ({ tag, pages: pgs })).sort(byTag)

  return {
    taxonomyPresent: taxonomy !== null,
    vaultTaxonomyPresent: taxonomy?.hasVaultFile ?? false,
    unknown,
    aliasUsed: [...aliasPages.entries()].map(([tag, v]) => ({ tag, canonical: v.canonical, pages: v.pages })).sort(byTag),
    overTagged,
    untagged,
    // 升表门槛就是词表自己写的那条：≥2 页才值得新增
    promote: unknown.filter((u) => u.pages.length >= 2),
    localTypeTags: taxonomy
      ? taxonomy.entries
        .filter((e) => e.origin === 'vault' && e.section === TYPE_SECTION && !taxonomy.baseTags.has(e.tag))
        .map((e) => e.tag)
        .sort()
      : [],
    // 库级重复登记基础层已有的词 → 会遮蔽基础层的后续更新
    shadowedBaseTags: taxonomy
      ? taxonomy.entries
        .filter((e) => e.origin === 'vault' && taxonomy.baseTags.has(e.tag))
        .map((e) => e.tag)
        .sort()
      : [],
  }
}

export function lintVault(store: VaultStore, opts: LoadTaxonomyOptions = {}): LintReport {
  const pages = store.listPagesReadonly()
  const ids = new Set(pages.map((p) => p.id))
  const incoming = new Map<string, string[]>()
  const outCount = new Map<string, number>()
  const brokenLinks: { from: string; target: string }[] = []
  const missingFrontmatter: string[] = []

  for (const p of pages) {
    const page = store.readPage(p.id, p.category)
    if (!page) {
      // 读不出来（无 frontmatter）的页面：标记缺 frontmatter，正文不可解析，无出链
      missingFrontmatter.push(p.id)
      continue
    }
    if (!page.created || !page.source || !page.confidence) {
      missingFrontmatter.push(p.id)
    }
    const body = stripCodeRegions(page.body)
    let out = 0
    for (const m of body.matchAll(WIKILINK_RE)) {
      out += 1
      const target = m[1].trim()
      if (!ids.has(target)) {
        brokenLinks.push({ from: p.id, target })
      } else {
        const list = incoming.get(target) ?? []
        list.push(p.id)
        incoming.set(target, list)
      }
    }
    outCount.set(p.id, out)
  }

  // 孤儿定义（有意与 graph-engine.ts 不同，双语义并存，勿"统一"）：
  // - lint 此处为「宽语义」：双向链接未织好的页面都算孤儿（有出无入、有入无出、完全无链接），
  //   即只有「既有出链又有入链」的页面才算真正织入图谱——服务检查清单；
  // - graph-engine 为「严格语义」（!hasOut && !hasIn 才灰显）——服务视觉呈现，仅有入链的页不是视觉孤点。
  const orphans = pages
    .filter((p) => {
      // 索引页天然无入链，它是库的入口而不是图谱里的节点，报成孤儿只会是噪声。
      if (p.id === INDEX_PAGE_ID) return false
      const hasOut = (outCount.get(p.id) ?? 0) > 0
      const hasIn = (incoming.get(p.id) ?? []).length > 0
      return !hasOut || !hasIn
    })
    .map((p) => p.id)

  return { orphans, brokenLinks, missingFrontmatter, pageCount: pages.length, tags: auditTags(store, loadTaxonomy(store, opts)) }
}
