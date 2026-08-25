// src/vault-store.ts
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { WikiCategory, WikiPage, ManifestEntry, VaultManifest } from './types.ts'

const WIKI_DIR = '.wiki'
const MANIFEST_FILE = '.manifest.json'
const CATEGORIES: WikiCategory[] = ['concepts', 'entities', 'references', 'synthesis', 'projects']

/**
 * 页面 id 的严格 kebab-case 模式（允许 CJK 字符，中文标题页保留语义文件名）：
 * 仍拒绝所有路径穿越字符（. / \ 等均不在字符集内）。id 直接用作文件名，
 * resolve() 包含性检查作为第二道防线。
 */
const SAFE_ID_RE = /^[a-z0-9\u4e00-\u9fff][a-z0-9\u4e00-\u9fff-]*$/

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

  /**
   * 校验 id 并返回受控路径：id 必须匹配严格 kebab-case，且解析后必须落在 wikiRoot 之内。
   * 不合法返回 null（writePage 抛错、readPage 返回 null），绝不静默截断或放行。
   */
  private safePagePath(id: string, category: WikiCategory): string | null {
    if (!SAFE_ID_RE.test(id)) return null
    const file = join(this.wikiRoot, category, `${id}.md`)
    const resolved = resolve(file)
    const root = resolve(this.wikiRoot)
    if (resolved !== root && !resolved.startsWith(root + sep)) return null
    return file
  }

  writePage(page: WikiPage): { created: boolean } {
    this.ensure()
    const file = this.safePagePath(page.id, page.category)
    if (!file) {
      throw new Error(`invalid page id "${page.id}": ids must match /^[a-z0-9\u4e00-\u9fff][a-z0-9\u4e00-\u9fff-]*$/ and stay inside the vault`)
    }
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
    const file = this.safePagePath(id, category)
    if (!file) return null
    if (!existsSync(file)) return null
    // 统一换行为 \n：CRLF 文件（Windows 编辑器 / git core.autocrlf）也能解析 frontmatter
    const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
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
        const id = f.slice(0, -3)
        const page = this.readPage(id, c)
        // 无 frontmatter 的页面 readPage 返回 null，也要列入清单（lint 才能标记缺 frontmatter）
        if (page) out.push({ id: page.id, category: c, title: page.title })
        else out.push({ id, category: c, title: id })
      }
    }
    return out
  }
}
