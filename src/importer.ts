// src/importer.ts
// 路径导入：递归收集 .md → frontmatter 判定/补全 → 幂等写入 vault。
// 安全模型：源文件只读；写入落点经 SAFE_ID_RE 净化 + vault 包含性双重校验（writePage 内建）。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, basename } from 'node:path'
import type { VaultStore } from './vault-store.ts'
import { parsePageText, SAFE_ID_RE, SaveError } from './vault-store.ts'
import type { WikiCategory, WikiPage } from './types.ts'

export interface ImportFileResult {
  source: string
  id: string
  category: WikiCategory
  status: 'imported' | 'updated' | 'skipped'
  renamed?: boolean
}

export interface ImportReport {
  imported: number
  updated: number
  skipped: number
  files: ImportFileResult[]
}

export interface ImportLimits {
  maxFiles: number
  maxBytes: number
  maxDepth: number
}

const DEFAULT_LIMITS: ImportLimits = { maxFiles: 500, maxBytes: 1024 * 1024, maxDepth: 12 }
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'target', 'dist', '__pycache__', '.wiki'])

/** 文件名 → 合法 id：小写、非法字符折叠为 -、去首尾 -；空则回退 untitled。导出供测试。 */
export function sanitizeId(name: string): string {
  const base = name.toLowerCase()
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return base || 'untitled'
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

interface Collected { path: string; relName: string }

function collect(root: string, limits: ImportLimits): Collected[] {
  const out: Collected[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > limits.maxDepth) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(entry.name)) continue
        walk(join(dir, entry.name), depth + 1)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push({ path: join(dir, entry.name), relName: entry.name })
      }
    }
  }
  const st = statSync(root)
  if (st.isFile()) {
    if (!root.toLowerCase().endsWith('.md')) throw new Error(`仅支持 .md 文件：${root}`)
    out.push({ path: root, relName: basename(root) })
  } else if (st.isDirectory()) {
    walk(root, 0)
  }
  if (out.length === 0) throw new Error(`路径下没有 .md 文件：${root}`)
  if (out.length > limits.maxFiles) {
    throw new Error(`文件数超上限：${out.length} > ${limits.maxFiles}，请分批导入`)
  }
  return out
}

/** 标题：正文首个 # 行（去掉前缀 #）；无则用文件名净化前的原名。 */
function titleFrom(body: string, fallback: string): string {
  for (const line of body.split('\n')) {
    const m = line.match(/^#\s+(.+)$/)
    if (m) return m[1].trim()
  }
  return fallback
}

/** 剥离首个 # 标题行（title 已提取进 frontmatter，正文不再重复）。 */
function stripFirstHeading(body: string): string {
  const idx = body.split('\n').findIndex((l) => /^#\s+/.test(l))
  if (idx === -1) return body
  const lines = body.split('\n')
  lines.splice(idx, 1)
  return lines.join('\n').trim()
}

export function importPath(
  store: VaultStore,
  root: string,
  category: WikiCategory,
  limits: ImportLimits = DEFAULT_LIMITS,
): ImportReport {
  let rootStat
  try {
    rootStat = statSync(root)
  } catch {
    throw new SaveError(404, `路径不存在：${root}`)
  }
  if (!rootStat.isFile() && !rootStat.isDirectory()) throw new SaveError(400, `路径既非文件也非目录：${root}`)

  const collected = collect(root, limits)
  // 先全部读入并校验大小（超限整体失败，不做部分写入）
  const sources: Array<{ path: string; name: string; text: string }> = []
  for (const c of collected) {
    const st = statSync(c.path)
    if (st.size > limits.maxBytes) {
      throw new Error(`文件超过 ${Math.floor(limits.maxBytes / 1024)}KB 上限：${c.path}（${Math.floor(st.size / 1024)}KB）`)
    }
    sources.push({ path: c.path, name: c.relName, text: readFileSync(c.path, 'utf8').replace(/\r\n/g, '\n') })
  }

  const report: ImportReport = { imported: 0, updated: 0, skipped: 0, files: [] }
  const now = new Date().toISOString()

  for (const src of sources) {
    const parsed = parsePageText(src.text, sanitizeId(src.name), category)
    // 显式 frontmatter 判定：围栏块存在且其中声明了 id 与 category
    const fmBlock = src.text.match(/^---\n([\s\S]*?)\n---/)
    const hasExplicitFm = fmBlock !== null
      && /^id:\s*\S/m.test(fmBlock[1])
      && /^category:\s*\S/m.test(fmBlock[1])

    let id: string
    let cat: WikiCategory
    let page: WikiPage
    if (parsed && hasExplicitFm) {
      // 已有合法 frontmatter：按声明原样入库
      id = parsed.id
      cat = parsed.category
      page = parsed
      if (!SAFE_ID_RE.test(id)) {
        report.files.push({ source: src.path, id: sanitizeId(src.name), category, status: 'skipped' })
        report.skipped++
        continue
      }
    } else {
      id = sanitizeId(src.name)
      cat = category
      const rawBody = (src.text.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)?.[1] ?? src.text).trim()
      const body = stripFirstHeading(rawBody)
      page = {
        id,
        title: titleFrom(rawBody, src.name.replace(/\.md$/i, '')),
        category: cat,
        tags: [],
        source: `import:${src.path}`,
        confidence: 'inferred',
        created: now,
        updated: now,
        body,
      }
    }

    // id 冲突避让：库内已有且来源不同（重导判定见下）则加后缀
    const existing = store.readPage(id, cat)
    if (existing && existing.source !== page.source && existing.source !== `import:${src.path}`) {
      let suffix = 2
      while (store.readPage(`${id}-${suffix}`, cat)) suffix++
      const renamed = true
      id = `${id}-${suffix}`
      page = { ...page, id }
      const res: ImportFileResult = { source: src.path, id, category: cat, status: 'imported', renamed }
      store.writePage(page)
      report.imported++
      report.files.push(res)
      continue
    }

    if (existing) {
      const sameContent = sha256(existing.body) === sha256(page.body)
      if (sameContent) {
        report.files.push({ source: src.path, id, category: cat, status: 'skipped' })
        report.skipped++
        continue
      }
      store.writePage({ ...page, created: existing.created })
      report.updated++
      report.files.push({ source: src.path, id, category: cat, status: 'updated' })
      continue
    }

    store.writePage(page)
    report.imported++
    report.files.push({ source: src.path, id, category: cat, status: 'imported' })
  }
  return report
}
