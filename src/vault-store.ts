// src/vault-store.ts
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, renameSync, rmSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { vaultIdOf } from './types.ts'
import type { WikiCategory, WikiPage, WikiTier, ManifestEntry, VaultManifest, VaultProvider, VaultRecord, VaultListEntry } from './types.ts'

const WIKI_DIR = '.wiki'
const MANIFEST_FILE = '.manifest.json'
const CATEGORIES: WikiCategory[] = ['concepts', 'entities', 'references', 'synthesis', 'projects', 'dictionaries', 'tables']
/** 暂存区目录名（原始材料；不在 CATEGORIES 里，因此天然不被检索）。 */
export const RAW_DIR = '_raw'

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

/** 合法 tier 取值（缺省 supporting）。 */
export const TIERS: readonly WikiTier[] = ['core', 'supporting', 'peripheral']

/**
 * tier 归一化：无法识别的值（拼错、空、未来新增值）一律回退 supporting。
 * 读取宽容——frontmatter 是用户/agent 手写的，不能因为一个错拼就让整页读不出来。
 */
export function normalizeTier(value: unknown): WikiTier {
  const v = String(value ?? '').trim().toLowerCase()
  return (TIERS as readonly string[]).includes(v) ? (v as WikiTier) : 'supporting'
}

/** 摘要规则：正文首个非空、非标题、非表格、非分隔线的行，截 60 字。
 *  写入 frontmatter 的 `summary:` 与写 index.md 必须是同一条规则，故放在这里由
 *  index-builder 复用（否则两个派生工件会给出不一致的摘要）。 */
export function summarizeBody(body: string): string {
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

/** 解析整份文件文本（统一 \n 后）为 WikiPage；无合法 frontmatter 返回 null。
 *  字段回退语义与 v4 readPage 一致（缺省用 fallbackId/fallbackCategory），读取宽容。
 *  剥离开头 UTF-8 BOM（\uFEFF）：带 BOM 的文件（Windows 编辑器常见）同样可解析。 */
export function parsePageText(raw: string, fallbackId = '', fallbackCategory: WikiCategory = 'concepts'): WikiPage | null {
  const m = raw.replace(/^\uFEFF/, '').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return null
  const fm: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    // [^\n]+ 而非 (.+)：JS 的 `.` 不匹配 U+2028/U+2029，用 `.` 会让含这类字符的值整行失配、
    // 字段被静默丢弃（文件里明明写着，读出来却没有）。这里按 \n 切行，行内已无 \n。
    const kv = line.match(/^([\w-]+):\s*([^\n]+)$/)
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
    // 读取端不派生摘要：磁盘上没有该字段就按「无摘要」处理，与外部读者（obsidian-wiki
    // graph-query）看到的一致；派生只发生在写入端。
    summary: fm.summary ?? '',
    tier: normalizeTier(fm.tier),
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

// ---------------------------------------------------------------------------
// Windows 上的 rename 重试。
//
// tmp+rename 是原子写的核心，但 Windows 里「rename 覆盖一个正被打开的文件」会返回
// EPERM/EACCES/EBUSY：当目标刚被创建时，Defender/索引器的瞬时扫描就足以触发。
// 实测证据（2026-09-20）：全量并发跑测试时 saveManifest 偶发
//   EPERM: operation not permitted, rename '<…>.manifest.json.tmp-…' -> '.manifest.json'
// 而隔离跑同一条用例 40 次全绿；Linux 的 rename 不会这样。
//
// 这类竞争通常只持续几十毫秒 → 退避重试几次即可。不可重试的错误码立即抛出，绝不吞错：
// 三处调用点（writePage / saveRawPage / saveManifest）原本一次瞬时 EPERM 就会
// 让 wiki_capture / 页面保存整体抛错丢操作，且看起来像"随机失败"。
// ---------------------------------------------------------------------------
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_ATTEMPTS = 5

/** 同步退避：Atomics.wait 是 Node 里可用的同步 sleep（不忙等）。 */
function syncSleep(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    // 环境不支持时退化为不等待：重试仍然发生，只是没有退避
  }
}

export interface RenameDeps {
  /** 测试注入点：替换 rename 实现。 */
  rename?: (from: string, to: string) => void
  /** 测试注入点：替换退避。 */
  sleep?: (ms: number) => void
  /** 最多尝试次数（含首次）。 */
  attempts?: number
}

/** rename 的退避重试（原因见上方注释）。 */
export function renameWithRetry(from: string, to: string, deps: RenameDeps = {}): void {
  const rename = deps.rename ?? renameSync
  const sleep = deps.sleep ?? syncSleep
  const attempts = Math.max(1, deps.attempts ?? RENAME_ATTEMPTS)
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      rename(from, to)
      return
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      // 不可重试（如 ENOENT）：不是竞争，重试无意义
      if (code === undefined || !RETRYABLE_RENAME_CODES.has(code)) throw error
      if (attempt < attempts) sleep(attempt * 5)
    }
  }
  throw lastError
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
    return [{ ...this.currentRecord()!, pageCount: this.listPagesReadonly().length, initialized: existsSync(this.wikiRoot) }]
  }

  ensure(): void {
    mkdirSync(this.wikiRoot, { recursive: true })
    for (const c of CATEGORIES) mkdirSync(join(this.wikiRoot, c), { recursive: true })
    mkdirSync(join(this.wikiRoot, '_system', 'tools'), { recursive: true })
    // _meta/：治理元数据（受控标签词表等）。与上游 obsidian-wiki 的 _meta/taxonomy.md 同路径，
    // 便于将来直接复用上游 skill；上游 CLI 的 SKIP_DIRS 也已包含 _meta，不会把词表当知识页。
    mkdirSync(join(this.wikiRoot, '_meta'), { recursive: true })
    // _raw/：原始材料暂存区（保真搬运进来的 md 等，**不参与检索**）。
    // 上游 obsidian-wiki 同路径同语义（Staging → next ingest promotes them）；
    // .obsidian 的忽略清单里早已登记 `_raw/`，但 ensure 之前没建它。
    mkdirSync(this.rawDir(), { recursive: true })
    this.ensureObsidianIgnore()
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

  /**
   * 单行化：frontmatter 值里的换行会注入伪造的 `key: value` 行（改写 id/category），写入前必须拍平。
   * 必须覆盖**全部 Unicode 行终止符**（\r \n U+2028 U+2029），不能只处理 \r\n：
   * U+2028/U+2029 同样能截断一行，而下面的读取正则跨不过它们——只处理 \r\n 会让这类值
   * 写得出去却读不回来（writePage 成功、readPage 的 summary 却是空串）。
   */
  private static flatField(value: string): string {
    return String(value ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ')
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
    // 摘要取值优先级：调用方显式给出 > 沿用磁盘上已有的 > 从正文派生。
    // 「沿用已有」是为了不毁掉人工撰写的摘要：writePage 会整份重建 frontmatter，若无条件
    // 重派生，agent 经 wiki_ingest 重写一次就会把人工摘要换成正文首行（静默数据丢失）。
    // 但派生摘要必须跟着正文走——若磁盘上的摘要恰好等于「上一版正文」的派生值，说明它是
    // 机器派生的，此时才重派生（正文可能已变）。判断失手的方向是安全的：把派生误判成人工
    // 只会留下一个略旧的摘要，而不会删掉人工内容。
    const prior = this.readPage(page.id, page.category)
    const priorSummary = (prior?.summary ?? '').trim()
    const priorWasDerived = priorSummary !== '' && priorSummary === summarizeBody(prior?.body ?? '').trim()
    const summary = VaultStore.flatField(
      page.summary?.trim() || (priorSummary !== '' && !priorWasDerived ? priorSummary : summarizeBody(page.body)),
    )
    const fm = [
      '---',
      `id: ${page.id}`,
      `title: ${safeTitle}`,
      `category: ${page.category}`,
      `tags: [${safeTags.join(', ')}]`,
      // 摘要仍为空则**不写该行**：解析器要求 key 后至少有 1 个字符，写出空值行会让字段回读时消失。
      ...(summary ? [`summary: ${summary}`] : []),
      `tier: ${normalizeTier(page.tier)}`,
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
    // 原子写（tmp + rename）：崩溃/并发下不会留下半截页面文件（与 saveRawPage 同策略）
    const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
    writeFileSync(tmp, text, 'utf8')
    try {
      renameWithRetry(tmp, file)
    } catch (e) {
      try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
      throw e
    }
    this.cache.delete(this.cacheKey(page.id, page.category))
    return { created }
  }

  /**
   * Obsidian 适配：把 .wiki 当 vault 打开时，隔离内部目录与派生工件——
   * _system/（会话归档/进度/还原点）、_meta/（治理元数据：标签词表）、_raw/（废弃区）、
   * wiki-export/（导出产物）、.manifest.json。
   * 幂等 + 不覆盖用户自定义：已有 app.json 只做 userIgnoreFilters 并集合并。
   */
  private ensureObsidianIgnore(): void {
    const dir = join(this.wikiRoot, '.obsidian')
    const file = join(dir, 'app.json')
    const REQUIRED = ['_system/', '_meta/', '_raw/', 'wiki-export/', '.manifest.json']
    try {
      mkdirSync(dir, { recursive: true })
      if (existsSync(file)) {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
        const current = Array.isArray(raw.userIgnoreFilters) ? raw.userIgnoreFilters.filter((x): x is string => typeof x === 'string') : []
        const merged = [...current]
        for (const f of REQUIRED) if (!merged.includes(f)) merged.push(f)
        if (merged.length === current.length) return // 已包含全部内部忽略项：保持字节不变
        writeFileSync(file, JSON.stringify({ ...raw, userIgnoreFilters: merged }, null, 2), 'utf8')
        return
      }
      writeFileSync(file, JSON.stringify({ userIgnoreFilters: REQUIRED }, null, 2), 'utf8')
    } catch { /* Obsidian 配置写入失败不影响库可用性 */ }
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
    if (!existsSync(file)) throw new SaveError(404, `页面不存在：${category}/${id}。此接口只编辑已有页面，不能新建；新建请用 wiki_ingest / wiki_capture。`)
    const text = rawText.replace(/\r\n/g, '\n')
    const page = parsePageText(text, id, category)
    assertSaveablePage(page, id, category)
    const tmp = file + '.tmp-' + Date.now()
    writeFileSync(tmp, text, 'utf8')
    try {
      renameWithRetry(tmp, file)
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

  /** `_raw/` 暂存区绝对路径：保真搬运的落点，不参与任何检索（白名单只有 7 个正式分类）。 */
  rawDir(): string {
    return join(this.wikiRoot, RAW_DIR)
  }

  /**
   * 把原始材料落进 `_raw/`：**保真**——调用方给什么就写什么，不解析 frontmatter、不改写正文、
   * 不判定分类。幂等：同名同内容 → skipped；同名不同内容 → 覆盖（updated）。
   *
   * 为什么这条路径不写正式分类：它做的是搬运而不是提炼（无 confidence 判定、无去重织链），
   * 直接进知识层会稀释检索质量。正式页一律由 wiki_ingest / wiki_capture 产生。
   */
  stageRawFile(name: string, text: string): { relPath: string; status: 'imported' | 'updated' | 'skipped' } {
    if (!SAFE_ID_RE.test(name)) throw new SaveError(400, `invalid raw file name "${name}"`)
    const relPath = `${RAW_DIR}/${name}.md`
    const dir = this.rawDir()
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${name}.md`)
    const next = text.replace(/\r\n/g, '\n')
    if (existsSync(file)) {
      const prior = readFileSync(file, 'utf8')
      if (prior === next) return { relPath, status: 'skipped' }
      writeFileSync(file, next, 'utf8')
      return { relPath, status: 'updated' }
    }
    writeFileSync(file, next, 'utf8')
    return { relPath, status: 'imported' }
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
    // 原子写：manifest 是增量跳过的主信号，半截 JSON 会让所有 contentHash 失效（重摄入抖动）
    const file = this.manifestFile()
    const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
    writeFileSync(tmp, JSON.stringify(m, null, 2), 'utf8')
    try {
      renameWithRetry(tmp, file)
    } catch (e) {
      try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
      throw e
    }
  }

  /**
   * manifest 的 read-modify-write 合并写：每次写入前重读磁盘再合并本次条目，
   * 避免跨进程（两个 DSH 进程共用同一库）互相覆盖丢失 entries。
   */
  updateManifestMerged(entries: Record<string, ManifestEntry>): void {
    const m = this.loadManifest()
    Object.assign(m.sources, entries)
    this.saveManifest(m)
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
