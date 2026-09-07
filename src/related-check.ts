// src/related-check.ts
// v9 相关页对账：写页后检索库内相关已有页，给 agent 反馈以驱动补链/去重。
// 零宿主依赖（只读 vault-store），可独立单测。匹配策略（按强度排序）：
//   1. strong：标题归一相等（疑似重复，建议并入已有页）
//   2. title：标题互为子串（同主题不同名）
//   3. body：已有页正文提及新页标题（它已在讲这个主题）
//   4. linked：新页正文是否已含 [[已有页 id]]（决定"是否已链"）
import type { VaultStore } from './vault-store.ts'
import type { WikiCategory } from './types.ts'

export interface RelatedHit {
  id: string
  title: string
  category: WikiCategory
  matchedBy: 'title' | 'body'
  /** 新页正文已含 [[id]] 链接 */
  linked: boolean
  /** 标题归一相等 → 疑似重复，建议并入已有页而非新建 */
  strong: boolean
}

const LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g

const normTitle = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** 对单页扫描库内相关已有页（排除自身与同批产出的页）。只读，扫描失败不阻断。 */
export function relatedHits(store: VaultStore, exclude: Set<string>, p: { id: string; title: string; category: string; body: string }): RelatedHit[] {
  const out: RelatedHit[] = []
  const title = p.title.trim()
  if (!title) return out
  try {
    const links = new Set<string>()
    for (const m of p.body.matchAll(LINK_RE)) links.add(m[1].trim())
    const tnorm = normTitle(title)
    const hits: RelatedHit[] = []
    for (const sp of store.listPagesReadonly()) {
      if (sp.id === p.id || exclude.has(sp.id)) continue
      const page = store.readPage(sp.id, sp.category)
      if (!page) continue
      const normT = normTitle(page.title)
      const matchedBy: RelatedHit['matchedBy'] | null =
        normT === tnorm ? 'title'
          : (normT.length >= 2 && tnorm.length >= 2 && (normT.includes(tnorm) || tnorm.includes(normT))) ? 'title'
            : (normT.length >= 2 && page.body.toLowerCase().includes(tnorm)) ? 'body'
              : null
      if (!matchedBy) continue
      hits.push({
        id: sp.id,
        title: page.title,
        category: sp.category,
        matchedBy,
        linked: links.has(sp.id),
        strong: matchedBy === 'title' && normT === tnorm,
      })
    }
    // strong 优先、title 次之、body 最后；同类保持扫描序；截断 5 条
    const rank = (h: RelatedHit): number => (h.strong ? 0 : h.matchedBy === 'title' ? 1 : 2)
    out.push(...hits.sort((a, b) => rank(a) - rank(b)).slice(0, 5))
  } catch {
    /* 扫描失败不阻断写入 */
  }
  return out
}
