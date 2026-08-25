// src/lint.ts
import type { VaultStore } from './vault-store.ts'

export interface LintReport {
  orphans: string[]
  brokenLinks: { from: string; target: string }[]
  missingFrontmatter: string[]
  pageCount: number
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g

export function lintVault(store: VaultStore): LintReport {
  const pages = store.listPages()
  const ids = new Set(pages.map((p) => p.id))
  const incoming = new Map<string, string[]>()
  const brokenLinks: { from: string; target: string }[] = []
  const missingFrontmatter: string[] = []

  for (const p of pages) {
    const page = store.readPage(p.id, p.category)
    if (!page) continue
    if (!page.created || !page.source || !page.confidence) {
      missingFrontmatter.push(p.id)
    }
    const body = page.body
    for (const m of body.matchAll(WIKILINK_RE)) {
      const target = m[1].trim()
      if (!ids.has(target)) {
        brokenLinks.push({ from: p.id, target })
      } else {
        const list = incoming.get(target) ?? []
        list.push(p.id)
        incoming.set(target, list)
      }
    }
  }

  // 孤儿定义：双向链接未织好的页面都算孤儿（有出无入、有入无出、完全无链接），
  // 即只有「既有出链又有入链」的页面才算真正织入图谱。
  const orphans = pages
    .filter((p) => {
      const hasOut = /\[\[[^\]|#]+\]\]/.test(store.readPage(p.id, p.category)?.body ?? '')
      const hasIn = (incoming.get(p.id) ?? []).length > 0
      return !hasOut || !hasIn
    })
    .map((p) => p.id)

  return { orphans, brokenLinks, missingFrontmatter, pageCount: pages.length }
}
