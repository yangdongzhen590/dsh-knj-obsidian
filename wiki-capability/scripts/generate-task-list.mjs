#!/usr/bin/env node
// generate-task-list.mjs — 从入口清单生成功能任务清单（SDD 的 generate_task_list.py 适配版）
//
// 输入：.wiki/_system/capability-mining/entries.json（由 enumerate-entries.mjs 产出）
// 输出：.wiki/_system/capability-mining/tasks.yml + 功能树.md
//
// 行为：
//   1. 按「入口 → 文件」聚类成功能簇（同一批文件的入口归为一个功能）
//   2. 已有 tasks.yml 时增量对齐（按 function_name 保留状态），只增新增、标消失的
//   3. 功能树.md 给人看（覆盖生成）
//
// 用法：node scripts/generate-task-list.mjs --project <根> [--force]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

const args = process.argv.slice(2)
const argOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const projectRoot = resolve(argOf('--project') ?? '.')
const force = args.includes('--force')

const MINE_DIR = join(projectRoot, '.wiki', '_system', 'capability-mining')
const ENTRIES = join(MINE_DIR, 'entries.json')
const TASKS = join(MINE_DIR, 'tasks.yml')
const TREE = join(MINE_DIR, '功能树.md')

if (!existsSync(ENTRIES)) {
  console.error(`找不到 ${ENTRIES}——先跑 enumerate-entries.mjs`)
  process.exit(1)
}
const { entries } = JSON.parse(readFileSync(ENTRIES, 'utf8'))

// ── 1. 聚类：优先读人工策展的「功能映射.yml」；无则按入口文件（v1 兜底）──
const MAP_FILE = join(MINE_DIR, '功能映射.yml')

/** 读人工策展的功能映射（agent 判断后的结果，脚本只负责记账） */
function loadCuratedMap() {
  if (!existsSync(MAP_FILE)) return null
  const text = readFileSync(MAP_FILE, 'utf8')
  const features = []
  let cur = null
  for (const raw of text.split('\n')) {
    const t = raw.trim()
    if (t.startsWith('- name:')) {
      if (cur) features.push(cur)
      cur = { name: t.slice('- name:'.length).trim().replace(/^["']|["']$/g, ''), entries: [], modules: [] }
    } else if (cur && t.startsWith('entries:')) {
      cur.entries = t.slice('entries:'.length).trim().replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    } else if (cur && t.startsWith('modules:')) {
      cur.modules = t.slice('modules:'.length).trim().replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    }
  }
  if (cur) features.push(cur)
  return features.length > 0 ? features : null
}

const curated = loadCuratedMap()
const clusters = new Map()
if (curated) {
  for (const f of curated) clusters.set(f.name, f)
} else {
  for (const e of entries) {
    const file = e.file.replace(/\\/g, '/')
    if (!clusters.has(file)) clusters.set(file, [])
    clusters.get(file).push(e)
  }
}

// 文件 → 功能名映射（v1 内置；可用 .wiki/_system/capability-mining/功能映射.yml 覆盖）
const FILE_FEATURES = [
  { match: /^src\/tools\.ts$/, name: '知识工具面' },
  { match: /^src\/routes\.ts$/, name: 'HTTP 路由与数据面' },
  { match: /^src\/trigger\.ts$/, name: '主动触发层' },
  { match: /^src\/client\//, name: '边栏 UI' },
  { match: /^src\/(retriever|semantic|drill)/, name: '检索内核' },
]

function nameOfCluster(file, list) {
  for (const f of FILE_FEATURES) {
    if (f.match.test(file)) return f.name
  }
  return file.replace(/^src\//, '').replace(/\/[^/]+$/, '') || file
}

// ── 2. 增量对齐既有状态 ──
let oldTasks = new Map()
if (existsSync(TASKS) && !force) {
  const text = readFileSync(TASKS, 'utf8')
  let cur = null
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (t.startsWith('- index:')) {
      if (cur) oldTasks.set(cur.function_name, cur)
      cur = { index: +t.split(':')[1] }
    } else if (cur && t.startsWith('function_name:')) {
      cur.function_name = t.split(':')[1].trim().replace(/^["']|["']$/g, '')
    } else if (cur && t.startsWith('status:')) {
      cur.status = t.split(':')[1].trim()
    } else if (cur && t.startsWith('attempt_count:')) {
      cur.attempt_count = +t.split(':')[1]
    }
  }
  if (cur) oldTasks.set(cur.function_name, cur)
}

// ── 3. 生成任务列表 ──
const tasks = []
let idx = 1
if (curated) {
  // 人工策展路径：入口与模块都由映射给定
  for (const f of curated) {
    const old = oldTasks.get(f.name)
    tasks.push({
      index: idx++,
      function_name: f.name,
      status: old?.status ?? '待挖掘',
      attempt_count: old?.attempt_count ?? 0,
      start_time: old?.start_time ?? null,
      end_time: old?.end_time ?? null,
      page_id: old?.page_id ?? null,
      entry_count: f.entries.length,
      entries: f.entries,
      modules: f.modules,
    })
  }
} else {
  // 兜底路径：按入口文件聚簇
  for (const [key, list] of clusters) {
    const name = nameOfCluster(key, list)
    const old = oldTasks.get(name)
    const modules = [...new Set(list.map((e) => e.file))].slice(0, 12)
    const existing = tasks.find((t) => t.function_name === name)
    if (existing) {
      // 同名合并（如 src/client/api.ts 与 GraphView.tsx 都归「边栏 UI」）
      existing.entry_count += list.length
      existing.entries = [...existing.entries, ...list.map((e) => `${e.type}:${e.name}`)].slice(0, 20)
      existing.modules = [...new Set([...existing.modules, ...modules])]
      continue
    }
    tasks.push({
      index: idx++,
      function_name: name,
      status: old?.status ?? '待挖掘',
      attempt_count: old?.attempt_count ?? 0,
      start_time: old?.start_time ?? null,
      end_time: old?.end_time ?? null,
      page_id: old?.page_id ?? null,
      entry_count: list.length,
      entries: list.map((e) => `${e.type}:${e.name}`).slice(0, 20),
      modules,
    })
  }
}

// ── 4. 序列化 ──
const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const fmt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
const q = (v) => `"${String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

const lines = [
  '# tasks.yml — 系统功能挖掘任务清单（由 generate-task-list.mjs 生成）',
  '# 状态机：待挖掘 -> 挖掘中 -> 挖掘完成 | 挖掘失败',
  '# 本文件由技能维护，可手工修改单条 status 以强制重跑',
  '',
  'meta:',
  '  version: "1.0"',
  `  project_root: ${q(projectRoot.replace(/\\/g, '/'))}`,
  `  generated_at: ${q(fmt)}`,
  `  total_tasks: ${tasks.length}`,
  `  completed: ${tasks.filter((t) => t.status === '挖掘完成').length}`,
  `  failed: ${tasks.filter((t) => t.status === '挖掘失败').length}`,
  '',
  'tasks:',
]
for (const t of tasks) {
  lines.push(`  - index: ${t.index}`)
  lines.push(`    function_name: ${q(t.function_name)}`)
  lines.push(`    status: ${t.status}`)
  lines.push(`    attempt_count: ${t.attempt_count}`)
  lines.push(`    start_time: ${t.start_time ? q(t.start_time) : 'null'}`)
  lines.push(`    end_time: ${t.end_time ? q(t.end_time) : 'null'}`)
  lines.push(`    page_id: ${t.page_id ? q(t.page_id) : 'null'}`)
  lines.push(`    entry_count: ${t.entry_count}`)
  lines.push(`    entries: [${t.entries.map(q).join(', ')}]`)
  lines.push(`    modules: [${t.modules.map(q).join(', ')}]`)
  lines.push('')
}

mkdirSync(dirname(TASKS), { recursive: true })
writeFileSync(TASKS, lines.join('\n'), 'utf8')

// ── 5. 功能树（给人看）──
const tree = [
  `# 系统功能树 — ${projectRoot.replace(/\\/g, '/').split('/').pop()}`,
  '',
  `> 由 generate-task-list.mjs 自动生成 · ${fmt} · 共 ${tasks.length} 个功能 / ${entries.length} 个入口`,
  '',
]
for (const t of tasks) {
  tree.push(`## ${t.function_name}（${t.entry_count} 入口${t.status !== '待挖掘' ? ' · ' + t.status : ''}）`)
  tree.push(`- 入口：${t.entries.slice(0, 8).join(' / ')}${t.entries.length > 8 ? ` …等 ${t.entries.length} 个` : ''}`)
  tree.push(`- 模块：${t.modules.join(' · ')}`)
  if (t.page_id) tree.push(`- 知识页：[[${t.page_id}]]`)
  tree.push('')
}
writeFileSync(TREE, tree.join('\n'), 'utf8')

console.log(`[OK] ${tasks.length} 个功能 → ${TASKS}`)
console.log(`[OK] 功能树 → ${TREE}`)
for (const t of tasks) console.log(`  ${t.index}. ${t.function_name}（${t.entry_count} 入口，${t.modules.length} 模块）[${t.status}]`)
