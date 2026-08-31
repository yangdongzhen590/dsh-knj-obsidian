// src/vault-store.ts
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, renameSync, rmSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { vaultIdOf } from './types.ts'
import type { WikiCategory, WikiPage, ManifestEntry, VaultManifest, VaultProvider, VaultRecord, VaultListEntry } from './types.ts'

const WIKI_DIR = '.wiki'
const MANIFEST_FILE = '.manifest.json'
const CATEGORIES: WikiCategory[] = ['concepts', 'entities', 'references', 'synthesis', 'projects', 'dictionaries', 'tables']

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
 *  字段回退语义与 v4 readPage 一致（缺省用 fallbackId/fallbackCategory），读取宽容。
 *  剥离开头 UTF-8 BOM（\uFEFF）：带 BOM 的文件（Windows 编辑器常见）同样可解析。 */
export function parsePageText(raw: string, fallbackId = '', fallbackCategory: WikiCategory = 'concepts'): WikiPage | null {
  const m = raw.replace(/^\uFEFF/, '').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
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

  /** 单库模式只读视图同样是自身（readPageCached 等读路径本身零写入）。 */
  currentReadonly(): VaultStore {
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

  /** 单行化：frontmatter 值里的换行会注入伪造的 `key: value` 行（改写 id/category），写入前必须拍平。 */
  private static flatField(value: string): string {
    return String(value ?? '').replace(/[\r\n]+/g, ' ')
  }

  writePage(page: WikiPage): { created: boolean } {
    this.ensure()
    const file = this.safePagePath(page.id, page.category)
    if (!file) {
      throw new Error(`invalid page id "${page.id}": ids must match /^[a-z0-9\u4e00-\u9fff][a-z0-9\u4e00-\u9fff-]*$/ and stay inside the vault`)
    }
    const created = !existsSync(file)
    const safeTitle = VaultStore.flatField(page.title)
    const safeSource = VaultStore.flatField(page.source)
    const safeTags = page.tags.map((t) => VaultStore.flatField(t))
    const fm = [
      '---',
      `id: ${page.id}`,
      `title: ${safeTitle}`,
      `category: ${page.category}`,
      `tags: [${safeTags.join(', ')}]`,
      `source: ${safeSource}`,
      `confidence: ${page.confidence}`,
      `created: ${page.created}`,
      `updated: ${page.updated}`,
      '---',
    ].join('\n')
    const text = `${fm}\n\n${page.body}\n`
    // round-trip 校验：写出的 frontmatter 必须解析回同一 id/category（注入防御的第二道防线）
    const roundTrip = parsePageText(text, page.id, page.category)
    if (!roundTrip || roundTrip.id !== page.id || roundTrip.category !== page.category) {
      throw new Error(`frontmatter round-trip 校验失败：页面 "${page.id}" 的字段含无法安全写出的字符`)
    }
    writeFileSync(file, text, 'utf8')
    this.cache.delete(this.cacheKey(page.id, page.category))
    return { created }
  }

  readPage(id: string, category: WikiCategory): WikiPage | null {
    return this.readPageCached(id, category)
  }

  /** mtime 页缓存：stat 命中即免读盘免解析（磁盘外部编辑通过 mtime 变化自动失效）。 */
  private cache = new Map<string, { mtimeMs: number; page: WikiPage | null }>()

  private cacheKey(id: string, category: WikiCategory): string {
    return `${category}/${id}`
  }

  private readPageCached(id: string, category: WikiCategory, presetStat?: { mtimeMs: number }): WikiPage | null {
    const file = this.safePagePath(id, category)
    if (!file) return null
    const key = this.cacheKey(id, category)
    let mtimeMs: number
    if (presetStat) {
      mtimeMs = presetStat.mtimeMs
    } else {
      let st: { mtimeMs: number } | null = null
      try { st = statSync(file) } catch { st = null }
      if (!st) {
        this.cache.delete(key)
        return null
      }
      mtimeMs = st.mtimeMs
    }
    const hit = this.cache.get(key)
    if (hit && hit.mtimeMs === mtimeMs) return hit.page ? { ...hit.page, tags: [...hit.page.tags] } : null
    let page: WikiPage | null = null
    try {
      // 统一换行为 \n 并剥 BOM：CRLF 文件（Windows 编辑器 / git core.autocrlf）也能解析 frontmatter
      const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
      page = parsePageText(raw, id, category)
    } catch {
      page = null
    }
    this.cache.set(key, { mtimeMs, page })
    return page ? { ...page, tags: [...page.tags] } : null
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
    this.cache.delete(this.cacheKey(id, category))
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

  /** 全部已记录来源 key 列表（对账 deleted 判定用）。 */
  manifestSources(): string[] {
    return Object.keys(this.loadManifest().sources)
  }

  updateManifest(source: string, entry: ManifestEntry): void {
    const m = this.loadManifest()
    m.sources[source] = entry
    this.saveManifest(m)
  }

  listPages(): { id: string; category: WikiCategory; title: string }[] {
    this.ensure()
    return this.listPagesReadonly()
  }

  /**
   * 只读列出页面清单：不调用 ensure()，不创建任何目录/文件。
   * 分类目录缺失时跳过（全新 vault 上检索仍是零写入）。
   * stat 与页缓存复用：每文件一次 stat，mtime 未变则免读盘免解析。
   */
  listPagesReadonly(): { id: string; category: WikiCategory; title: string }[] {
    const out: { id: string; category: WikiCategory; title: string }[] = []
    for (const c of CATEGORIES) {
      const dir = join(this.wikiRoot, c)
      let files: string[]
      try { files = readdirSync(dir) } catch { continue }
      for (const f of files) {
        if (!f.endsWith('.md')) continue
        const full = join(dir, f)
        let mtimeMs: number
        try {
          const st = statSync(full)
          if (!st.isFile()) continue
          mtimeMs = st.mtimeMs
        } catch { continue }
        const id = f.slice(0, -3)
        const page = this.readPageCached(id, c, { mtimeMs })
        if (page) out.push({ id: page.id, category: c, title: page.title })
        else out.push({ id, category: c, title: id })
      }
    }
    return out
  }
}
