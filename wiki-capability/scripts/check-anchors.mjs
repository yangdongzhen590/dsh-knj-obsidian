#!/usr/bin/env node
// check-anchors.mjs — 能力页行号核对 + sources 指纹计算（SKILL.md §3.4 的脚本）
//
// 用法:
//   node scripts/check-anchors.mjs --project <根> --page projects/capability-x.md [--strict] [--hashes]
//
// 行为:
//   --page   : 抽出页内所有 `路径:行` / `路径:起-止` 引用，打印该行区间真实内容
//   --strict : **按 Sources 段括号里声明的符号核对**该行号区间是否真含这个符号。
//              不符 = 行号漂移（插了行、删了行之后最常见的失效模式），非零退出。
//   --hashes : 计算 ```sources 块里每个 path 的 sha256:前16位，并打印可直接替换的 JSON 片段
//              （I4 新鲜度判据：hash 变了 = 源文件变了 = 这页 stale）
//
// 退出码: 0=全部引用可定位（且 --strict 下符号全部吻合）
//         1=有文件不存在 / 行号越界 / 声明符号未出现在该区间
//
// ⚠️ 无 --strict 时，退出码 0 **不代表锚点正确**——它只证明「文件在、行号没越界」。
//    一条引用可以指向完全无关的一行而照样通过。所以：
//      · `Sources` 每条都应在括号里写出这段里的符号（如 `文件名:554`（RECURRENCE_THRESHOLD = 3）），
//        --strict 才有依据可核；
//      · 括号里没有标识符的条目（纯中文描述）会被记为「需人工确认」并计数披露，不会被当成通过。
//
// 只读：不改页、不写库。
//
// 实测（2026-10-20 能力挖掘会话）：40 条引用逐条核对，抓出 2 处行号漂移。
// 实测（2026-10-21）：无 --strict 时 exit=0 骗过了一次「行号是否漂移」的判断——那次是人工
// 读表才确认没漂移的；--strict 就是为堵这个洞加的。

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const argOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const projectRoot = resolve(argOf('--project') ?? '.')
const pageArg = argOf('--page')
const wantHashes = args.includes('--hashes')
const strict = args.includes('--strict')
if (!pageArg) { console.error('需要 --page <vault相对路径>'); process.exit(1) }

const pageFile = resolve(join(projectRoot, '.wiki'), pageArg)
if (!existsSync(pageFile)) { console.error(`找不到 ${pageFile}`); process.exit(1) }
const raw = readFileSync(pageFile, 'utf8')

const CITE_PATH = '(?:src|lib|test|client|docs|wiki-[a-z-]+)\\/[\\w./-]+'
const citeRe = new RegExp('`(' + CITE_PATH + '):(\\d+)(?:-(\\d+))?`', 'g')

const cites = []
for (const m of raw.matchAll(citeRe)) {
  cites.push({ path: m[1], start: +m[2], end: m[3] ? +m[3] : +m[2], lane: '行内引用' })
}
// Sources 段的 `路径:起-止` 同样核对（去重），并收集括号里的符号声明供 --strict 使用
const srcSec = /## Sources\n([\s\S]*?)(?:\n## |$)/.exec(raw)
const declared = []
if (srcSec) {
  for (const m of srcSec[1].matchAll(citeRe)) {
    const key = `${m[1]}:${m[2]}-${m[3] ?? m[2]}`
    if (!cites.some((c) => `${c.path}:${c.start}-${c.end}` === key)) {
      cites.push({ path: m[1], start: +m[2], end: m[3] ? +m[3] : +m[2], lane: 'Sources 段' })
    }
  }
  // 列表项形态：- `路径:起-止`（括号说明） / (`括号说明`)
  for (const line of srcSec[1].split('\n')) {
    const bullet = new RegExp('^-\\s*`(' + CITE_PATH + '):(\\d+)(?:-(\\d+))?`\\s*[（(]([^）)]*)[）)]').exec(line.trim())
    if (!bullet) continue
    declared.push({
      path: bullet[1],
      start: +bullet[2],
      end: bullet[3] ? +bullet[3] : +bullet[2],
      desc: bullet[4].trim(),
    })
  }
}

const fileCache = new Map()
const linesOf = (p) => {
  if (!fileCache.has(p)) {
    const abs = join(projectRoot, p)
    fileCache.set(p, existsSync(abs) ? readFileSync(abs, 'utf8').split('\n') : null)
  }
  return fileCache.get(p)
}

console.log(`页面: ${pageArg}`)
console.log(`引用: ${cites.length} 条 / ${new Set(cites.map((c) => c.path)).size} 文件`)
console.log('')
let bad = 0
for (const c of cites) {
  const lines = linesOf(c.path)
  if (!lines) { console.log(`✗ [${c.lane}] ${c.path}:${c.start} — 文件不存在`); bad++; continue }
  if (c.start > lines.length) { console.log(`✗ [${c.lane}] ${c.path}:${c.start} — 越界（共 ${lines.length} 行）`); bad++; continue }
  const end = Math.min(c.end, c.start + 2, lines.length)
  const body = []
  for (let i = c.start; i <= end; i++) body.push(`      ${i}| ${lines[i - 1].slice(0, 150)}`)
  console.log(`· [${c.lane}] ${c.path}:${c.start}-${c.end}`)
  console.log(body.join('\n'))
  console.log('')
}

// ── --strict：按 Sources 声明核对符号 ──
/** 从括号说明里抠出「被声明的符号」：反引号内的整串 + 其中的标识符 + 裸标识符。 */
const STOP = new Set(['and', 'the', 'for', 'with', 'const', 'function', 'return', 'await', 'async', 'null', 'true', 'false', 'json', 'string', 'number'])
function symbolsIn(desc) {
  const out = new Set()
  for (const m of desc.matchAll(/`([^`]+)`/g)) {
    const t = m[1].trim()
    for (const id of t.matchAll(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g)) out.add(id[0])
  }
  // 裸标识符（至少含一个大写字母或下划线，避免把英文虚词当符号）
  for (const m of desc.matchAll(/(?<![`\w$.])([A-Za-z_$][A-Za-z0-9_$]{2,})(?![`\w$])/g)) {
    const w = m[1]
    if (STOP.has(w)) continue
    if (/[A-Z_]/.test(w)) out.add(w)
  }
  return [...out]
}

const strictRows = []
let strictFails = 0
let unverifiable = 0
for (const d of declared) {
  const lines = linesOf(d.path)
  if (!lines) { strictRows.push({ ...d, verdict: 'missing' }); strictFails++; continue }
  const end = Math.min(d.end, lines.length)
  const slice = lines.slice(d.start - 1, end).join('\n')
  const syms = symbolsIn(d.desc)
  if (syms.length === 0) { unverifiable++; strictRows.push({ ...d, verdict: 'unverifiable', syms }); continue }
  const hit = syms.filter((s) => slice.includes(s))
  if (hit.length === 0) { strictFails++; strictRows.push({ ...d, verdict: 'FAIL', syms }) }
  else strictRows.push({ ...d, verdict: 'ok', syms: hit })
}

if (strict) {
  console.log('=== 严格核对（按 Sources 括号里声明的符号）===')
  for (const r of strictRows) {
    const tag = r.verdict === 'ok' ? '✓' : r.verdict === 'FAIL' ? '✗ 不符' : r.verdict === 'missing' ? '✗ 文件不存在' : '· 需人工'
    const detail = r.verdict === 'ok' ? `命中 ${r.syms.join(', ')}`
      : r.verdict === 'FAIL' ? `声明 [${r.syms.join(', ')}] 在该区间内一个都没有`
      : r.verdict === 'unverifiable' ? `括号里没有可核对的标识符：${r.desc}`
      : ''
    console.log(`${tag}  ${r.path}:${r.start}-${r.end}  ${detail}`)
  }
  console.log('')
  console.log(`严格核对小结: 可核对 ${strictRows.length - unverifiable} 条 / 不符 ${strictFails} 条 / 需人工确认 ${unverifiable} 条`)
  if (strictFails > 0) bad += strictFails
  if (unverifiable > 0) {
    console.log(`⚠ ${unverifiable} 条没有任何符号声明 → 不参与自动核对。给这些条目的括号补上标识符，--strict 才有依据。`)
  }
} else if (declared.length > 0) {
  console.log(`（未启用 --strict：本次只证明「文件在、行号不越界」，不证明该行是指称的符号。`)
  console.log(`  需要符号级核对请加 --strict；当前页有 ${declared.length} 条带括号声明的 Sources。）`)
  console.log('')
}

if (wantHashes) {
  const sBlock = /```sources\n([\s\S]*?)```/.exec(raw)
  if (!sBlock) { console.log('（无 sources 块）'); process.exit(bad ? 1 : 0) }
  let sources = []
  try { sources = JSON.parse(sBlock[1]) } catch { console.error('sources 块不是合法 JSON'); process.exit(1) }
  const out = sources.map((s) => {
    const abs = join(projectRoot, s.path)
    if (!existsSync(abs)) return { path: s.path, hash: 'MISSING', symbols: s.symbols ?? [] }
    const hash = 'sha256:' + createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 16)
    return { path: s.path, hash, symbols: s.symbols ?? [] }
  })
  console.log('=== sources 块（可直接替换）===')
  console.log(JSON.stringify(out, null, 2))
}

process.exit(bad ? 1 : 0)
