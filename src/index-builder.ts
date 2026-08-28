// src/index-builder.ts
// 从当前全部页面重生成 index.md（派生工件：自定义注释会被覆盖，README 已注明）。
// 行格式 `- [[id]] 标题 — 摘要`，与手工索引及 retriever L1 的 [[wikilink]] 行匹配保持兼容。
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VaultStore } from './vault-store.ts'
import type { WikiCategory } from './types.ts'

const SECTION_TITLES: Array<{ category: WikiCategory; title: string }> = [
  { category: 'concepts', title: '## 概念页' },
  { category: 'entities', title: '## 实体页' },
  { category: 'references', title: '## 参考资料' },
  { category: 'synthesis', title: '## 综合' },
  { category: 'projects', title: '## 项目知识' },
]

/** 摘要：正文首个非空、非标题、非表格、非分隔线的行，截 60 字。导出供测试。 */
export function summarize(body: string): string {
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#')) continue
    if (line.startsWith('|')) continue
    if (line.startsWith('---')) continue
    return [...line].slice(0, 60).join('')
  }
  return ''
}

/** 幂等重建 index.md；返回 { pageCount }。 */
export function rebuildIndex(store: VaultStore): { pageCount: number } {
  const pages = store.listPages()
    .map((p) => ({ summary: p, page: store.readPage(p.id, p.category) }))
    .filter((x) => x.page !== null)

  const lines: string[] = [
    '# Wiki Index',
    '',
    '> 由 dsh-knj-obsidian 维护。概念页 / 实体页 / 参考 / 综合 / 项目知识。',
    '',
  ]
  for (const section of SECTION_TITLES) {
    const inSection = pages.filter((x) => x.summary.category === section.category)
    lines.push(section.title, '')
    for (const { summary, page } of inSection) {
      const s = summarize(page!.body)
      lines.push(s ? `- [[${summary.id}]] ${page!.title} — ${s}` : `- [[${summary.id}]] ${page!.title}`)
    }
    lines.push('')
  }
  writeFileSync(join(store.wikiRoot, 'index.md'), lines.join('\n'), 'utf8')
  return { pageCount: pages.length }
}
