#!/usr/bin/env node
// check-anchors.mjs — 能力页行号核对 + sources 指纹计算（SKILL.md §3.4 的脚本）
//
// 用法:
//   node scripts/check-anchors.mjs --project <根> --page projects/capability-x.md [--hashes]
//
// 行为:
//   --page   : 抽出页内所有 `路径:行` / `路径:起-止` 引用，打印该行区间真实内容（供人工核对
//              「这个行号是不是真的指向我声称的那个符号」）
//   --hashes : 计算 ```sources 块里每个 path 的 sha256:前16位，并打印可直接替换的 JSON 片段
//              （I4 新鲜度判据：hash 变了 = 源文件变了 = 这页 stale）
//
// 退出码: 0=全部引用可定位；1=有文件不存在或行号越界
// 只读：不改页、不写库。
//
// 实测（2026-10-20 能力挖掘会话）：40 条引用逐条核对，抓出 2 处行号漂移。

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const argOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const projectRoot = resolve(argOf('--project') ?? '.')
const pageArg = argOf('--page')
const wantHashes = args.includes('--hashes')
if (!pageArg) { console.error('需要 --page <vault相对路径>'); process.exit(1) }

const pageFile = resolve(join(projectRoot, '.wiki'), pageArg)
if (!existsSync(pageFile)) { console.error(`找不到 ${pageFile}`); process.exit(1) }
const raw = readFileSync(pageFile, 'utf8')

const citeRe = /`((?:src|lib|test|client|docs|wiki-[a-z-]+)\/[\w./-]+):(\d+)(?:-(\d+))?`/g
const cites = []
for (const m of raw.matchAll(citeRe)) {
  cites.push({ path: m[1], start: +m[2], end: m[3] ? +m[3] : +m[2], lane: '行内引用' })
}
// Sources 段的 `路径:起-止` 同样核对（去重）
const srcSec = /## Sources\n([\s\S]*?)(?:\n## |$)/.exec(raw)
if (srcSec) {
  for (const m of srcSec[1].matchAll(citeRe)) {
    const key = `${m[1]}:${m[2]}-${m[3] ?? m[2]}`
    if (!cites.some((c) => `${c.path}:${c.start}-${c.end}` === key)) {
      cites.push({ path: m[1], start: +m[2], end: m[3] ? +m[3] : +m[2], lane: 'Sources 段' })
    }
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
