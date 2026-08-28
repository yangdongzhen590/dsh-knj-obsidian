// src/vault-store.ts
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, renameSync, rmSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { vaultIdOf } from './types.ts'
import type { WikiCategory, WikiPage, ManifestEntry, VaultManifest, VaultProvider, VaultRecord, VaultListEntry } from './types.ts'

const WIKI_DIR = '.wiki'
const MANIFEST_FILE = '.manifest.json'
const CATEGORIES: WikiCategory[] = ['concepts', 'entities', 'references', 'synthesis', 'projects']

/**
 * 页面 id 的严格 kebab-case 模式（允许 CJK 字符，中文标题页保留语义文件名）：
 * 仍拒绝所有路径穿越字符（. / \ 等均不在字符集内）。id 直接用作文件名，
 * resolve() 包含性检查作为第二道防线。
 */
const SAFE_ID_RE = /^[a-z0-9\u4e00-\u9fff][a-z0-9\u4e00-\u9fff-]*$/
export { SAFE_ID_RE }

/** saveRawPage 的校验失败：携带建议的 HTTP status。 */
export class SaveError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'SaveError'
  }
}

/** 解析整份文件文本（统一 \n 后）为 WikiPage；无合法 frontmatter 返回 null。
 *  字段回退语义与 v4 readPage 一致（缺省用 fallbackId/fallbackCategory），读取宽容。 */
export function parsePageText(raw: string, fallbackId = '', fallbackCategory: WikiCategory = 'concepts'): WikiPage | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return null
  const fm: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.+)$/)
    if (kv) fm[kv[1]] = kv[2]
  }
  return {
    id: fm.id ?? fallbackId,
    title: fm.title ?? fallbackId,
    category: (fm.category as WikiCategory) ?? fallbackCategory,
    tags: (fm.tags ?? '[]').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean),
    source: fm.source ?? '',
    confidence: (fm.confidence as WikiPage['confidence']) ?? 'extracted',
    created: fm.created ?? '',
    updated: fm.updated ?? '',
    body: (m[2] ?? '').trim(),
  }
}

/** 保存时的强校验：id/title/category 必须齐且与目标一致。 */
function assertSaveablePage(page: WikiPage | null, id: string, category: WikiCategory): asserts page is WikiPage {
  if (!page || !page.id || !page.title || !page.category) {
    throw new SaveError(422, 'frontmatter 无法解析：需要合法的 `---` 围栏块且含 id/title/category')
  }
  if (page.id !== id || page.category !== category) {
    throw new SaveError(422, `frontmatter 与目标不符：期望 id=${id} category=${category}，实际 id=${page.id} category=${page.category}`)
  }
}

export class VaultStore implements VaultProvider {
  constructor(private readonly vaultRoot: string) {}

  /** 只读暴露 wiki 根目录（<vaultRoot>/.wiki），供检索器读 index.md */
  get wikiRoot(): string {
    return join(this.vaultRoot, WIKI_DIR)
  }

  // ---------- VaultProvider 单库实现（多库时由 VaultManager 提供） ----------

  /** 单库模式：当前库就是自身。 */
  current(): VaultStore {
    return this
  }

  currentRecord(): VaultRecord | null {
    return { id: vaultIdOf(this.vaultRoot), name: basename(this.vaultRoot) || this.vaultRoot, root: this.vaultRoot, source: 'cwd' }
  }

  listVaults(): VaultListEntry[] {
    return [{ ...this.currentRecord()!, pageCount: this.listPagesReadonly().length }]
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
    return parsePageText(raw, id, category)
  }

  /** 读磁盘原文（含 frontmatter，逐字节）；v5 源码视图用。 */
  readRawPage(id: string, category: WikiCategory): string | null {
    const file = this.safePagePath(id, category)
    if (!file || !existsSync(file)) return null
    return readFileSync(file, 'utf8')
  }

  /**
   * 保存整份文件原文（v5 全文编辑）：
   * - 路径必须通过 safePagePath（防穿越）
   * - frontmatter 必须可解析且 id/category 与目标一致（防「编辑 A 存成 B」）
   * - 目标必须已存在（v5 只做编辑，不做新建/改名）
   * - 原子写：先写临时文件再 rename
   * 返回解析后的页面；任何校验失败抛 SaveError（含 status 提示），磁盘不动。
   */
  saveRawPage(id: string, category: WikiCategory, rawText: string): WikiPage {
    const file = this.safePagePath(id, category)
    if (!file) throw new SaveError(400, `invalid page id "${id}"`)
    if (!existsSync(file)) throw new SaveError(404, `page not found: ${category}/${id}`)
    const text = rawText.replace(/\r\n/g, '\n')
    const page = parsePageText(text, id, category)
    assertSaveablePage(page, id, category)
    const tmp = file + '.tmp-' + Date.now()
    writeFileSync(tmp, text, 'utf8')
    try {
      renameSync(tmp, file)
    } catch (e) {
      try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
      throw e
    }
    return page
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

  /**
   * 只读列出页面清单：不调用 ensure()，不创建任何目录/文件。
   * 分类目录缺失时跳过（全新 vault 上检索仍是零写入）。条目语义与 listPages()
   * 完全一致，区别仅在于不触发 ensure()——供检索这类只读路径使用。
   */
  listPagesReadonly(): { id: string; category: WikiCategory; title: string }[] {
    const out: { id: string; category: WikiCategory; title: string }[] = []
    for (const c of CATEGORIES) {
      const dir = join(this.wikiRoot, c)
      if (!existsSync(dir)) continue
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.md')) continue
        const full = join(dir, f)
        if (!statSync(full).isFile()) continue
        const id = f.slice(0, -3)
        const page = this.readPage(id, c)
        if (page) out.push({ id: page.id, category: c, title: page.title })
        else out.push({ id, category: c, title: id })
      }
    }
    return out
  }
}
