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
