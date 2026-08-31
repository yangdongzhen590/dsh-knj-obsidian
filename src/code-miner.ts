// src/code-miner.ts
// 代码结构挖掘：enumMiner（枚举/常量类）+ outline（模块清单）。
// 轻量结构扫描（正则 + 括号匹配），非全量 AST——千级文件秒级、可按文件批并行。
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'

const EXCLUDE_DIRS = new Set(['node_modules', '.git', '.svn', 'target', 'dist', '__pycache__', '.wiki'])

export interface EnumValue { name: string; code?: string; label?: string; line: number }
export interface EnumCandidate {
  name: string
  module: string
  file: string       // 相对 root 路径
  line: number
  values: EnumValue[]
  kind: 'enum' | 'constants'
  hash: string       // 源文件内容 SHA-256（对账用）
}
export interface ModuleOutline { module: string; fileCount: number; enumEstimate: number }

export interface MineResult {
  enums: EnumCandidate[]
  modules: string[]
  outline: ModuleOutline[]
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function moduleOf(pkg: string): string {
  // 包名首段（com.pingan.iobs.order → order）；无包 → core
  const parts = pkg.split('.').filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 1] : (parts[0] ?? 'core')
}

function collectJavaFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (EXCLUDE_DIRS.has(e.name)) continue
        walk(join(dir, e.name))
      } else if (e.isFile() && e.name.endsWith('.java')) {
        out.push(join(dir, e.name))
      }
    }
  }
  walk(root)
  return out
}

function lineOf(text: string, index: number): number {
  let count = 1
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') count++
  return count
}

/** 解析单文件，返回候选（可能 0 个）。 */
export function parseJavaFile(relPath: string, text: string): EnumCandidate[] {
  const out: EnumCandidate[] = []
  const pkgMatch = text.match(/package\s+([\w.]+)\s*;/)
  const pkg = pkgMatch?.[1] ?? ''
  const module = moduleOf(pkg)

  // ---- enum 声明：enum Name { ... }，花括号计数取块 ----
  const enumRe = /\benum\s+([A-Za-z_$][\w$]*)\s*\{/g
  let m: RegExpExecArray | null
  while ((m = enumRe.exec(text)) !== null) {
    const name = m[1]
    const openIdx = text.indexOf('{', m.index)
    let depth = 0
    let closeIdx = -1
    for (let i = openIdx; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') { depth--; if (depth === 0) { closeIdx = i; break } }
    }
    if (closeIdx === -1) continue
    // 枚举常量列表以第一个分号结束（其后是构造器/字段/方法），只解析常量区
    let body = text.slice(openIdx + 1, closeIdx)
    const semi = body.indexOf(';')
    if (semi !== -1) body = body.slice(0, semi)
    const values: EnumValue[] = []
    // 值：NAME 或 NAME("code","label") 或 NAME(code,"label")
    const valRe = /([A-Za-z_$][\w$]*)\s*(?:\(\s*("(?:[^"\\]|\\.)*"|[^,)]+)\s*,\s*("(?:[^"\\]|\\.)*"|[^,)]+)\s*\))?/g
    let vm: RegExpExecArray | null
    let guard = 0
    while ((vm = valRe.exec(body)) !== null && guard++ < 200) {
      const vName = vm[1]
      const vLine = lineOf(text, openIdx + 1 + vm.index)
      if (vm[2] === undefined) { values.push({ name: vName, line: vLine }); continue }
      const codeRaw = vm[2].trim()
      const labelRaw = vm[3].trim()
      const code = (codeRaw.startsWith('"') ? codeRaw.slice(1, -1) : codeRaw)
      const label = (labelRaw.startsWith('"') ? labelRaw.slice(1, -1) : labelRaw)
      values.push({ name: vName, code, label, line: vLine })
    }
    out.push({ name, module, file: relPath, line: lineOf(text, m.index), values, kind: 'enum', hash: '' })
  }

  // ---- 常量类：public static final (String|int|...) NAME = value; 相邻注释为 label ----
  const constRe = /public\s+static\s+final\s+(?:String|Integer|Long|int|long|short|byte)\s+([A-Za-z_$][\w$]*)\s*=\s*("(?:[^"\\]|\\.)*"|\d+)\s*;/g
  const classRe = /public\s+(?:final\s+)?class\s+([A-Za-z_$][\w$]*)/g
  let cmClass: RegExpExecArray | null
  let currentClass = ''
  let constClassLine = 0
  while ((cmClass = classRe.exec(text)) !== null) {
    currentClass = cmClass[1]
    constClassLine = lineOf(text, cmClass.index)
  }
  if (currentClass && /public\s+static\s+final/.test(text)) {
    const constValues: EnumValue[] = []
    let cm: RegExpExecArray | null
    while ((cm = constRe.exec(text)) !== null) {
      const cName = cm[1]
      const rawVal = cm[2]
      const code = rawVal.startsWith('"') ? rawVal.slice(1, -1) : rawVal
      const cLine = lineOf(text, cm.index)
      let label = ''
      for (let i = cLine - 2; i >= 0; i--) {
        const t = text.split('\n')[i]?.trim() ?? ''
        if (t.startsWith('/**') || t.startsWith('*')) {
          label = t.replace(/^\/\*\*?\s*|\*\/?\s*$|\*\s*/g, '').trim()
          break
        }
        if (t === '' || t.startsWith('}')) break
      }
      constValues.push({ name: cName, code, label, line: cLine })
    }
    if (constValues.length > 0) {
      out.push({ name: currentClass, module, file: relPath, line: constClassLine, values: constValues, kind: 'constants', hash: '' })
    }
  }

  return out
}

export function mineEnums(root: string, moduleFilter?: string): MineResult {
  const files = collectJavaFiles(root)
  const byModule = new Map<string, { fileCount: number; enums: EnumCandidate[] }>()
  for (const f of files) {
    let text = ''
    try { text = readFileSync(f, 'utf8').replace(/\r\n/g, '\n') } catch { continue }
    const rel = relative(root, f).replace(/\\/g, '/')
    const candidates = parseJavaFile(rel, text)
    const fileHash = sha256(text)
    for (const c of candidates) {
      const mod = c.module
      if (moduleFilter && mod !== moduleFilter) continue
      if (!byModule.has(mod)) byModule.set(mod, { fileCount: 0, enums: [] })
      byModule.get(mod)!.fileCount++
      byModule.get(mod)!.enums.push({ ...c, hash: fileHash })
    }
  }
  const enums = [...byModule.values()].flatMap((v) => v.enums)
  const outline: ModuleOutline[] = [...byModule.entries()].map(([module, v]) => ({
    module, fileCount: v.fileCount, enumEstimate: v.enums.length,
  }))
  return { enums, modules: outline.map((o) => o.module), outline }
}

// ==================== M2 表结构挖掘 ====================

export interface TableColumn { name: string; type: string; nullable: boolean; comment?: string; primaryKey: boolean; line: number }
export interface TableIndex { name: string; columns: string[]; unique: boolean; line: number }
export interface TableRelation { from: string; toTable: string; toColumn: string; line: number }
export interface TableCandidate {
  table: string
  module: string
  file: string
  line: number
  columns: TableColumn[]
  indexes: TableIndex[]
  relations: TableRelation[]
  comment?: string
  hash: string
  sources: string[]
}
export interface TableModuleOutline { module: string; fileCount: number; tableEstimate: number }
export interface TableMineResult { tables: TableCandidate[]; modules: string[]; outline: TableModuleOutline[] }

function collectFiles(root: string, exts: string[]): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.isDirectory()) { if (EXCLUDE_DIRS.has(e.name)) continue; walk(join(dir, e.name)) }
      else if (e.isFile() && exts.some((x) => e.name.toLowerCase().endsWith(x))) out.push(join(dir, e.name))
    }
  }
  walk(root)
  return out
}

/** 模块名：相对路径倒数第二段目录（db/migration/xxx.sql → migration）。 */
function moduleOfPath(relPath: string): string {
  const segs = relPath.split('/').filter(Boolean)
  return segs.length >= 2 ? segs[segs.length - 2] : (segs[0] ?? 'core')
}

/** 解析 SQL DDL 文件：CREATE TABLE / 索引 / 外键。 */
export function parseDdlFile(relPath: string, text: string): TableCandidate[] {
  const out: TableCandidate[] = []
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([\w$]+)`?\s*\(/gi
  let m: RegExpExecArray | null
  while ((m = tableRe.exec(text)) !== null) {
    const table = m[1]
    const openIdx = text.indexOf('(', m.index)
    let depth = 0, closeIdx = -1
    for (let i = openIdx; i < text.length; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') { depth--; if (depth === 0) { closeIdx = i; break } }
    }
    if (closeIdx === -1) continue
    const body = text.slice(openIdx + 1, closeIdx)
    // 表注释：表定义尾部 COMMENT='...'
    const semiIdx = text.indexOf(';', closeIdx)
    const tail = semiIdx === -1 ? text.slice(closeIdx + 1) : text.slice(closeIdx + 1, semiIdx)
    const tableComment = tail.match(/COMMENT\s*=\s*'((?:[^'\\]|\\.)*)'/i)?.[1]?.replace(/''/g, "'")

    const columns: TableColumn[] = []
    const indexes: TableIndex[] = []
    const relations: TableRelation[] = []
    const lines = body.split('\n')
    // 主键列集合（PRIMARY KEY (id) 或列级 PRIMARY KEY）
    const pkCols = new Set<string>()
    const pkMatch = body.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i)
    if (pkMatch) {
      for (const c of pkMatch[1].split(',')) pkCols.add(c.trim().replace(/^`|`$/g, ''))
    }
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith('PRIMARY') || line.startsWith('UNIQUE') || line.startsWith('KEY') || line.startsWith('CONSTRAINT') || line.startsWith('INDEX')) continue
      const cm = line.match(/^`?([\w$]+)`?\s+([A-Za-z0-9_()]+)/)
      if (!cm) continue
      const nullable = !/NOT\s+NULL/i.test(line)
      const comment = line.match(/COMMENT\s*'((?:[^'\\]|\\.)*)'/i)?.[1]?.replace(/''/g, "'")
      columns.push({
        name: cm[1], type: cm[2].toUpperCase(), nullable, comment,
        primaryKey: pkCols.has(cm[1]) || /PRIMARY\s+KEY/i.test(line),
        line: lineOf(text, text.indexOf(rawLine)),
      })
    }
    // 表级索引（含 UNIQUE KEY / KEY / INDEX）
    const idxRe = /(?:UNIQUE\s+)?(?:KEY|INDEX)\s+`?([\w$]+)`?\s*\(([^)]+)\)/gi
    let im: RegExpExecArray | null
    while ((im = idxRe.exec(body)) !== null) {
      if (im[1] === 'PRIMARY') continue
      const unique = /UNIQUE\s+(?:KEY|INDEX)/i.test(im[0])
      const cols = im[2].split(',').map((c) => c.trim().replace(/^`|`$/g, ''))
      indexes.push({ name: im[1], columns: cols, unique, line: lineOf(text, text.indexOf(im[0])) })
    }
    // 外键
    const fkRe = /FOREIGN\s+KEY\s*\(`?([\w$]+)`?\)\s*REFERENCES\s+`?([\w$]+)`?\s*\(`?([\w$]+)`?\)/gi
    let fm: RegExpExecArray | null
    while ((fm = fkRe.exec(body)) !== null) {
      relations.push({ from: fm[1], toTable: fm[2], toColumn: fm[3], line: lineOf(text, text.indexOf(fm[0])) })
    }
    out.push({
      table, module: moduleOfPath(relPath), file: relPath, line: lineOf(text, m.index),
      columns, indexes, relations, comment: tableComment, hash: '', sources: ['ddl'],
    })
  }
  // 独立 CREATE INDEX 语句并入对应表
  const stIdxRe = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+`?([\w$]+)`?\s+ON\s+`?([\w$]+)`?\s*\(([^)]+)\)/gi
  let sm2: RegExpExecArray | null
  while ((sm2 = stIdxRe.exec(text)) !== null) {
    const t = out.find((c) => c.table === sm2![2])
    if (t) {
      t.indexes.push({
        name: sm2![1],
        columns: sm2![3].split(',').map((c) => c.trim().replace(/^`|`$/g, '')),
        unique: /UNIQUE/i.test(sm2![0]),
        line: lineOf(text, sm2!.index),
      })
    }
  }
  return out
}

/** 解析 MyBatis mapper XML：sql 片段列清单 + from/join/into 表引用。 */
export function parseMapperXml(relPath: string, text: string): TableCandidate[] {
  const out: TableCandidate[] = []
  const columnsOf: Record<string, string[]> = {}
  const sqlRe = /<sql\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/sql>/gi
  let sm: RegExpExecArray | null
  while ((sm = sqlRe.exec(text)) !== null) {
    const cols = (sm[2].match(/`?[\w$]+`?/g) ?? [])
      .map((c) => c.replace(/^`|`$/g, ''))
      .filter((c) => !['select', 'from', 'where', 'and', 'or', 'insert', 'into', 'values', 'update', 'set', 'id'].includes(c.toLowerCase()))
    columnsOf[sm[1]] = cols
  }
  const tableRefs = new Set<string>()
  const refRe = /\b(?:from|join|update|into)\s+`?([\w$]+)`?/gi
  let rm: RegExpExecArray | null
  while ((rm = refRe.exec(text)) !== null) {
    const t = rm[1]
    if (!['select', 'where', 'information_schema', 'dual'].includes(t.toLowerCase())) tableRefs.add(t)
  }
  const cols: string[] = []
  const selectRe = /<select[\s\S]*?>([\s\S]*?)<\/select>/gi
  let em: RegExpExecArray | null
  while ((em = selectRe.exec(text)) !== null) {
    const body = em[1].replace(/<include[^>]*\/>/gi, (inc) => {
      const id = inc.match(/refid="([^"]+)"/)?.[1] ?? ''
      return (columnsOf[id] ?? []).join(', ')
    })
    const colMatches = body.match(/`?[\w$]+`?/g) ?? []
    for (const c of colMatches) {
      const clean = c.replace(/^`|`$/g, '')
      if (!/^(select|from|where|and|or|insert|into|values|update|set|join|on|order|by|group|limit|distinct|as|id)$/i.test(clean)) {
        if (!cols.includes(clean)) cols.push(clean)
      }
    }
  }
  for (const table of tableRefs) {
    out.push({
      table, module: moduleOfPath(relPath), file: relPath, line: lineOf(text, text.indexOf(table)),
      columns: cols.map((name) => ({ name, type: '', nullable: true, primaryKey: false, line: 1 })),
      indexes: [], relations: [], comment: undefined, hash: '', sources: ['mapper'],
    })
  }
  return out
}

/** 解析 JPA @Entity：@Table/@Column/@Id。 */
export function parseJpaEntity(relPath: string, text: string): TableCandidate[] {
  const out: TableCandidate[] = []
  const tableName = text.match(/@Table\s*\(\s*name\s*=\s*"([^"]+)"/)?.[1]
  if (!tableName) return out
  const ids = new Set<string>()
  const idRe = /@Id[\s\S]*?@Column\s*\(\s*name\s*=\s*"([^"]+)"/g
  let im: RegExpExecArray | null
  while ((im = idRe.exec(text)) !== null) ids.add(im[1])
  // 单字段 @Id + @Column 同注解块
  const singleIdRe = /@Id[\s\S]{0,120}?@Column\s*\(\s*name\s*=\s*"([^"]+)"/g
  let sim: RegExpExecArray | null
  while ((sim = singleIdRe.exec(text)) !== null) ids.add(sim[1])

  const columns: TableColumn[] = []
  const colRe = /@Column\s*\(\s*name\s*=\s*"([^"]+)"\s*(?:,\s*nullable\s*=\s*(true|false))?[^)]*\)[\s\S]*?private\s+[\w<>\[\]]+\s+(\w+)\s*;/g
  let cm: RegExpExecArray | null
  while ((cm = colRe.exec(text)) !== null) {
    columns.push({ name: cm[1], type: '', nullable: cm[2] !== 'false', primaryKey: ids.has(cm[1]), line: lineOf(text, cm.index) })
  }
  // 仅 @Id 无 @Column 的情况兜底（name 取字段名）
  if (columns.length === 0 && ids.size > 0) {
    const bareIdRe = /@Id[\s\S]*?private\s+[\w<>\[\]]+\s+(\w+)\s*;/g
    let bm: RegExpExecArray | null
    while ((bm = bareIdRe.exec(text)) !== null) {
      columns.push({ name: bm[1], type: '', nullable: false, primaryKey: true, line: lineOf(text, bm.index) })
    }
  }
  if (columns.length > 0) {
    out.push({
      table: tableName, module: moduleOfPath(relPath), file: relPath, line: lineOf(text, text.indexOf('@Table')),
      columns, indexes: [], relations: [], comment: undefined, hash: '', sources: ['jpa'],
    })
  }
  return out
}

const SOURCE_PRIORITY: Record<string, number> = { ddl: 3, jpa: 2, mapper: 1 }

/** 多来源合并：同表高优先级来源的列/索引/关系替换低优先级；sources 并集。 */
export function mergeTables(candidates: TableCandidate[]): TableCandidate[] {
  const byTable = new Map<string, TableCandidate>()
  for (const c of candidates) {
    const existing = byTable.get(c.table)
    if (!existing) { byTable.set(c.table, { ...c }); continue }
    const merged: TableCandidate = { ...existing }
    merged.sources = [...new Set([...existing.sources, ...c.sources])]
    const curPrio = Math.max(...existing.sources.map((s) => SOURCE_PRIORITY[s] ?? 0))
    const newPrio = Math.max(...c.sources.map((s) => SOURCE_PRIORITY[s] ?? 0))
    if (newPrio > curPrio) {
      merged.columns = c.columns
      merged.indexes = c.indexes
      merged.relations = c.relations
      merged.comment = c.comment ?? existing.comment
    } else if (newPrio === curPrio && existing.columns.length === 0 && c.columns.length > 0) {
      merged.columns = c.columns
    }
    byTable.set(c.table, merged)
  }
  return [...byTable.values()]
}

/** 挖掘全部表（DDL + mapper + JPA 三来源合并）。 */
export function mineTables(root: string, moduleFilter?: string): TableMineResult {
  const sqlFiles = collectFiles(root, ['.sql', '.ddl'])
  const mapperFiles = collectFiles(root, ['.xml'])
  const javaFiles = collectFiles(root, ['.java'])
  const all: TableCandidate[] = []
  for (const f of sqlFiles) {
    let text = ''
    try { text = readFileSync(f, 'utf8').replace(/\r\n/g, '\n') } catch { continue }
    all.push(...parseDdlFile(relative(root, f).replace(/\\/g, '/'), text))
  }
  for (const f of mapperFiles) {
    let text = ''
    try { text = readFileSync(f, 'utf8').replace(/\r\n/g, '\n') } catch { continue }
    all.push(...parseMapperXml(relative(root, f).replace(/\\/g, '/'), text))
  }
  for (const f of javaFiles) {
    let text = ''
    try { text = readFileSync(f, 'utf8').replace(/\r\n/g, '\n') } catch { continue }
    all.push(...parseJpaEntity(relative(root, f).replace(/\\/g, '/'), text))
  }
  const merged = mergeTables(all)
  const filtered = moduleFilter ? merged.filter((t) => t.module === moduleFilter) : merged
  // 每文件哈希（同文件多表共享同一哈希）
  const fileHash = new Map<string, string>()
  for (const t of filtered) {
    if (!fileHash.has(t.file)) {
      let text = ''
      try { text = readFileSync(join(root, t.file.split('/').join('\\')), 'utf8') } catch { /* hash 留空 */ }
      fileHash.set(t.file, text ? sha256(text.replace(/\r\n/g, '\n')) : '')
    }
  }
  const tables = filtered.map((t) => ({ ...t, hash: fileHash.get(t.file) ?? '' }))
  const byModule = new Map<string, { fileCount: number; tableEstimate: number }>()
  for (const t of tables) {
    if (!byModule.has(t.module)) byModule.set(t.module, { fileCount: 0, tableEstimate: 0 })
    const v = byModule.get(t.module)!
    v.fileCount++
    v.tableEstimate++
  }
  const outline: TableModuleOutline[] = [...byModule.entries()].map(([module, v]) => ({ module, fileCount: v.fileCount, tableEstimate: v.tableEstimate }))
  return { tables, modules: outline.map((o) => o.module), outline }
}
