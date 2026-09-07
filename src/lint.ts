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
    const body = page.body
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
      const hasOut = (outCount.get(p.id) ?? 0) > 0
      const hasIn = (incoming.get(p.id) ?? []).length > 0
      return !hasOut || !hasIn
    })
    .map((p) => p.id)

  return { orphans, brokenLinks, missingFrontmatter, pageCount: pages.length }
}
