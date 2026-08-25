// src/vault-store.ts
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { WikiCategory, WikiPage, ManifestEntry, VaultManifest } from './types.ts'

const WIKI_DIR = '.wiki'
const MANIFEST_FILE = '.manifest.json'
const CATEGORIES: WikiCategory[] = ['concepts', 'entities', 'references', 'synthesis', 'projects']

export class VaultStore {
  private readonly wikiRoot: string

  constructor(private readonly vaultRoot: string) {
    this.wikiRoot = join(vaultRoot, WIKI_DIR)
  }

  ensure(): void {
    mkdirSync(this.wikiRoot, { recursive: true })
    for (const c of CATEGORIES) mkdirSync(join(this.wikiRoot, c), { recursive: true })
    mkdirSync(join(this.wikiRoot, '_raw'), { recursive: true })
    const indexFile = join(this.wikiRoot, 'index.md')
    if (!existsSync(indexFile)) {
      writeFileSync(indexFile, [
        '# Wiki Index',
        '',
        '> 由 dsh-knj-obsidian 维护。概念页 / 实体页 / 参考 / 综合 / 项目知识。',
        '',
        '## 概念页',
        '',
        '## 实体页',
        '',
        '## 参考资料',
        '',
        '## 综合',
        '',
        '## 项目知识',
        '',
      ].join('\n'), 'utf8')
    }
    const manifest = join(this.wikiRoot, MANIFEST_FILE)
    if (!existsSync(manifest)) {
      writeFileSync(manifest, JSON.stringify({ version: 1, sources: {} }, null, 2), 'utf8')
    }
  }

  pagePath(id: string, category: WikiCategory): string {
    return join(this.wikiRoot, category, `${id}.md`)
  }

  writePage(page: WikiPage): { created: boolean } {
    this.ensure()
    const file = this.pagePath(page.id, page.category)
    const created = !existsSync(file)
    const fm = [
      '---',
      `id: ${page.id}`,
      `title: ${page.title}`,
      `category: ${page.category}`,
      `tags: [${page.tags.join(', ')}]`,
      `source: ${page.source}`,
      `confidence: ${page.confidence}`,
      `created: ${page.created}`,
      `updated: ${page.updated}`,
      '---',
    ].join('\n')
    writeFileSync(file, `${fm}\n\n${page.body}\n`, 'utf8')
    return { created }
  }

  readPage(id: string, category: WikiCategory): WikiPage | null {
    const file = this.pagePath(id, category)
    if (!existsSync(file)) return null
    const raw = readFileSync(file, 'utf8')
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!m) return null
    const fm: Record<string, string> = {}
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([\w-]+):\s*(.+)$/)
      if (kv) fm[kv[1]] = kv[2]
    }
    return {
      id: fm.id ?? id,
      title: fm.title ?? id,
      category: (fm.category as WikiCategory) ?? category,
      tags: (fm.tags ?? '[]').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean),
      source: fm.source ?? '',
      confidence: (fm.confidence as WikiPage['confidence']) ?? 'extracted',
      created: fm.created ?? '',
      updated: fm.updated ?? '',
      body: m[2].trim(),
    }
  }

  sha256(text: string): string {
    return createHash('sha256').update(text).digest('hex')
  }

  private manifestFile(): string {
    return join(this.wikiRoot, MANIFEST_FILE)
  }

  private loadManifest(): VaultManifest {
    try {
      if (existsSync(this.manifestFile())) {
        const parsed = JSON.parse(readFileSync(this.manifestFile(), 'utf8')) as VaultManifest
        if (parsed && typeof parsed === 'object' && parsed.sources) return parsed
      }
    } catch {
      // 损坏的 manifest 从空重建，不让插件崩
    }
    return { version: 1, sources: {} }
  }

  private saveManifest(m: VaultManifest): void {
    writeFileSync(this.manifestFile(), JSON.stringify(m, null, 2), 'utf8')
  }

  manifestEntry(source: string): ManifestEntry | undefined {
    return this.loadManifest().sources[source]
  }

  updateManifest(source: string, entry: ManifestEntry): void {
    const m = this.loadManifest()
    m.sources[source] = entry
    this.saveManifest(m)
  }

  listPages(): { id: string; category: WikiCategory; title: string }[] {
    this.ensure()
    const out: { id: string; category: WikiCategory; title: string }[] = []
    for (const c of CATEGORIES) {
      const dir = join(this.wikiRoot, c)
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.md')) continue
        const full = join(dir, f)
        if (!statSync(full).isFile()) continue
        const page = this.readPage(f.slice(0, -3), c)
        if (page) out.push({ id: page.id, category: c, title: page.title })
      }
    }
    return out
  }
}
