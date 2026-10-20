#!/usr/bin/env node
// check-capability.mjs — 能力页四条不变量检查（I1–I4）
//
// 用法:
//   node scripts/check-capability.mjs --project <dir> --page <vault相对路径> [--pretty]
//   node scripts/check-capability.mjs --project <dir> --all      # 检查全部 capability 页
//
// 判据（见设计文档 §7）:
//   I1 引用密度：≥5 条 `路径:行`，覆盖 ≥3 个文件
//   I2 连通性：≥2 个 [[wikilink]] 指向既有页
//   I3 可发现性：标题 Top1；问答式 queries ≥80% 进 Top5（任务式在 S1 不判）
//   I4 新鲜度：sources 块的文件 hash 是否变化（变化 = stale）
//
// 退出码: 0=全过；1=有不合格项；2=参数/文件错误

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const argOf = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const projectRoot = resolve(argOf('--project') ?? '.')
const pretty = args.includes('--pretty')

// ── 加载既有 vault（用于 I2/I3）──
const vaultStorePath = join(projectRoot, 'lib', 'vault-store.js')
const retrieverPath = join(projectRoot, 'lib', 'retriever.js')
if (!existsSync(vaultStorePath)) {
  console.error(`找不到 ${vaultStorePath}（需要先构建 lib/）`)
  process.exit(2)
}
const { VaultStore } = await import(pathToFileURL(vaultStorePath).href)
const store = new VaultStore(projectRoot)
const existingPages = new Set(store.listPagesReadonly().map((p) => p.id))

const retrievePath = existsSync(retrieverPath) ? retrieverPath : null
const retrieve = retrievePath
  ? (await import(pathToFileURL(retrievePath).href)).retrieve
  : null

// ── 页定位 ──
function pageFiles() {
  const one = argOf('--page')
  if (one) return [resolve(join(projectRoot, '.wiki'), one)]
  const dir = join(projectRoot, '.wiki', 'projects')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f.startsWith('capability-'))
    .map((f) => join(dir, f))
}

// ── 单页检查 ──
function checkPage(file) {
  const raw = readFileSync(file, 'utf8')
  const id = file.replace(/\\/g, '/').split('/').pop().replace(/\.md$/, '')
  const result = { id, file, I1: null, I2: null, I3: null, I4: null, issues: [] }

  // I1 引用密度
  const cites = [...raw.matchAll(/`((?:src|lib|test|client|docs|wiki-[a-z-]+)\/[\w./-]+):(\d+)(?:-(\d+))?`/g)]
  const citeFiles = new Set(cites.map((m) => m[1]))
  const i1ok = cites.length >= 5 && citeFiles.size >= 3
  result.I1 = { pass: i1ok, count: cites.length, files: citeFiles.size }
  if (!i1ok) result.issues.push(`I1: 引用 ${cites.length} 条 / ${citeFiles.size} 文件（须 ≥5 / ≥3）`)

  // I2 连通性
  const links = [...raw.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim())
  const valid = links.filter((l) => existingPages.has(l))
  const i2ok = new Set(valid).size >= 2
  result.I2 = { pass: i2ok, total: links.length, valid: [...new Set(valid)] }
  if (!i2ok) result.issues.push(`I2: ${new Set(valid).size} 个有效 wikilink（须 ≥2）`)

  // I3 可发现性
  if (retrieve) {
    const titleMatch = /^title:\s*(.+)$/m.exec(raw)
    const title = titleMatch ? titleMatch[1].trim().replace(/^["']|["']$/g, '') : id
    const qBlock = /```queries\n([\s\S]*?)```/.exec(raw)
    const queries = qBlock
      ? qBlock[1].split('\n').map((l) => l.trim()).filter(Boolean)
      : []
    // 问答式 vs 任务式：含「改/加/删/调/修/换」等动词开头视为任务式
    const isTask = (q) => /^(改|加|删|调|修|换|移|重构|新增|删除|调整|修改)/.test(q)
    const titleRank = rankOf(title)
    const qaResults = queries.filter((q) => !isTask(q)).map((q) => ({ q, rank: rankOf(q) }))
    const taskResults = queries.filter(isTask).map((q) => ({ q, rank: rankOf(q) }))
    const qaPass = qaResults.length === 0 || qaResults.filter((r) => r.rank > 0 && r.rank <= 5).length / qaResults.length >= 0.8
    const i3ok = titleRank === 1 && qaPass
    result.I3 = { pass: i3ok, titleRank, qa: qaResults, task: taskResults }
    if (titleRank !== 1) result.issues.push(`I3: 标题自检索第 ${titleRank || '>10'} 名（须 Top1）`)
    if (!qaPass) result.issues.push(`I3: 问答式 queries Top5 命中率 ${(qaResults.filter((r) => r.rank > 0 && r.rank <= 5).length / qaResults.length * 100).toFixed(0)}%（须 ≥80%）`)
  } else {
    result.I3 = { pass: null, note: 'retrieve 不可用，跳过' }
  }

  // I4 新鲜度
  const sBlock = /```sources\n([\s\S]*?)```/.exec(raw)
  if (sBlock) {
    let sources = []
    try {
      sources = JSON.parse(sBlock[1])
    } catch {
      result.I4 = { pass: false, note: 'sources 块 JSON 解析失败' }
      result.issues.push('I4: sources 块不是合法 JSON')
    }
    if (Array.isArray(sources)) {
      const stale = []
      for (const s of sources) {
        const abs = join(projectRoot, s.path)
        if (!existsSync(abs)) {
          stale.push({ path: s.path, reason: 'missing' })
          continue
        }
        const hash = 'sha256:' + createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 16)
        if (s.hash && s.hash !== 'pending' && s.hash !== hash) {
          stale.push({ path: s.path, reason: 'hash-changed', recorded: s.hash, current: hash })
        }
      }
      result.I4 = { pass: stale.length === 0, stale }
      if (stale.length > 0) result.issues.push(`I4: ${stale.length} 个源文件已变化 → stale`)
    }
  } else {
    result.I4 = { pass: false, note: '缺少 sources 块' }
    result.issues.push('I4: 缺少 sources 指纹块')
  }

  return result
}

function rankOf(query) {
  const r = retrieve(store, query, { mode: 'auto', maxCandidates: 10 })
  return r.candidates.findIndex((c) => c.id === currentId) + 1
}

// ── main ──
let currentId = ''
const files = pageFiles()
if (files.length === 0) {
  console.error('没有找到 capability 页（.wiki/projects/capability-*.md）')
  process.exit(2)
}

let anyFail = false
const results = []
for (const f of files) {
  currentId = f.replace(/\\/g, '/').split('/').pop().replace(/\.md$/, '')
  const res = checkPage(f)
  results.push(res)
  if (res.issues.length > 0) anyFail = true
}

if (pretty) {
  console.log(JSON.stringify(results, null, 2))
} else {
  for (const r of results) {
    const mark = (x) => (x === null ? '…' : x ? '✓' : '✗')
    console.log(`\n${r.id}`)
    console.log(`  I1 ${mark(r.I1?.pass)} 引用 ${r.I1?.count ?? '?'} 条 / ${r.I1?.files ?? '?'} 文件`)
    console.log(`  I2 ${mark(r.I2?.pass)} wikilink ${r.I2?.valid?.length ?? '?'} 个有效`)
    if (r.I3?.pass !== null && r.I3?.pass !== undefined) {
      console.log(`  I3 ${mark(r.I3.pass)} 标题第 ${r.I3.titleRank} 名；问答式 ${r.I3.qa?.filter((x) => x.rank > 0 && x.rank <= 5).length ?? 0}/${r.I3.qa?.length ?? 0} 进 Top5`)
    }
    console.log(`  I4 ${mark(r.I4?.pass)} ${r.I4?.stale?.length ? r.I4.stale.length + ' 个源已变' : '全新鲜'}`)
    for (const issue of r.issues) console.log(`     ⚠ ${issue}`)
  }
}
process.exit(anyFail ? 1 : 0)
