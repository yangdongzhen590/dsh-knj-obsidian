#!/usr/bin/env node
// process-task.mjs — 任务状态机原子操作（SDD 的 process_task.py 适配版）
//
// 动作:
//   get_next          取下一条「待挖掘」任务，标为「挖掘中」，attempt_count+1
//   update_complete   标「挖掘完成」并回填 page_id
//   update_failed     标「挖掘失败」并记录原因
//   reset_timeout     把「挖掘中」超时的任务重置回「待挖掘」
//   status            打印当前进度
//
// 用法:
//   node scripts/process-task.mjs --project <根> get_next
//   node scripts/process-task.mjs --project <根> update_complete --index 1 --page-id capability-知识检索
//   node scripts/process-task.mjs --project <根> update_failed --index 1 --reason "…"
//   node scripts/process-task.mjs --project <根> reset_timeout --timeout-minutes 10
//   node scripts/process-task.mjs --project <根> status
//
// 退出码: 0=成功；1=参数/文件错误；2=无待处理任务

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const argOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const projectRoot = resolve(argOf('--project') ?? '.')
const action = args.find((a) => !a.startsWith('--') && !['.'].includes(a) && !a.includes('/') && !a.includes('\\'))

const TASKS = join(projectRoot, '.wiki', '_system', 'capability-mining', 'tasks.yml')
if (!existsSync(TASKS)) {
  console.error(`找不到 ${TASKS}——先跑 generate-task-list.mjs`)
  process.exit(1)
}

// ── 极简 YAML 读写（仅覆盖本技能固定结构，零第三方依赖）──
function load() {
  const text = readFileSync(TASKS, 'utf8')
  const meta = {}
  const tasks = []
  let cur = null
  let inMeta = false
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (line.trim() === 'meta:') { inMeta = true; continue }
    if (line.trim() === 'tasks:') { inMeta = false; continue }
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    if (inMeta) {
      if (t.includes(':') && !t.startsWith('-')) {
        const [k, ...v] = t.split(':')
        meta[k.trim()] = v.join(':').trim().replace(/^["']|["']$/g, '')
      }
      continue
    }
    if (t.startsWith('- index:')) {
      cur = { index: +t.split(':')[1] }
      tasks.push(cur)
      continue
    }
    if (!cur || !t.includes(':')) continue
    const [k, ...v] = t.split(':')
    const key = k.trim()
    let val = v.join(':').trim().replace(/^["']|["']$/g, '')
    if (key === 'entries' || key === 'modules') {
      cur[key] = val.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    } else if (key === 'index' || key === 'attempt_count' || key === 'entry_count') {
      cur[key] = +val
    } else if (val === 'null') {
      cur[key] = null
    } else {
      cur[key] = val
    }
  }
  return { meta, tasks }
}

function save(meta, tasks) {
  const pad = (n) => String(n).padStart(2, '0')
  const now = new Date()
  const fmt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const q = (v) => `"${String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  const lines = [
    '# tasks.yml — 系统功能挖掘任务清单',
    '# 状态机：待挖掘 -> 挖掘中 -> 挖掘完成 | 挖掘失败',
    '',
    'meta:',
    '  version: "1.0"',
    `  project_root: ${q(meta.project_root ?? '')}`,
    `  generated_at: ${q(meta.generated_at ?? fmt)}`,
    `  updated_at: ${q(fmt)}`,
    `  total_tasks: ${tasks.length}`,
    `  completed: ${tasks.filter((t) => t.status === '挖掘完成').length}`,
    `  failed: ${tasks.filter((t) => t.status === '挖掘失败').length}`,
    `  in_progress: ${tasks.filter((t) => t.status === '挖掘中').length}`,
    '',
    'tasks:',
  ]
  for (const t of tasks) {
    lines.push(`  - index: ${t.index}`)
    lines.push(`    function_name: ${q(t.function_name)}`)
    lines.push(`    status: ${t.status}`)
    lines.push(`    attempt_count: ${t.attempt_count ?? 0}`)
    lines.push(`    start_time: ${t.start_time ? q(t.start_time) : 'null'}`)
    lines.push(`    end_time: ${t.end_time ? q(t.end_time) : 'null'}`)
    lines.push(`    page_id: ${t.page_id ? q(t.page_id) : 'null'}`)
    lines.push(`    entry_count: ${t.entry_count ?? 0}`)
    lines.push(`    entries: [${(t.entries ?? []).map(q).join(', ')}]`)
    lines.push(`    modules: [${(t.modules ?? []).map(q).join(', ')}]`)
    if (t.fail_reason) lines.push(`    fail_reason: ${q(t.fail_reason)}`)
    lines.push('')
  }
  writeFileSync(TASKS, lines.join('\n'), 'utf8')
}

function nowStr() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// ── 动作 ──
const { meta, tasks } = load()
const findTask = (idx) => tasks.find((t) => t.index === +idx)

if (action === 'get_next') {
  // 超时检查先行
  const timeoutMin = +(argOf('--timeout-minutes') ?? 10)
  const now = Date.now()
  let reset = 0
  for (const t of tasks) {
    if (t.status !== '挖掘中' || !t.start_time) continue
    const started = new Date(t.start_time.replace(' ', 'T')).getTime()
    if (Number.isFinite(started) && now - started > timeoutMin * 60_000) {
      t.status = '待挖掘'
      t.attempt_count = (t.attempt_count ?? 0) + 1
      t.start_time = null
      reset++
    }
  }
  if (reset > 0) console.error(`[INFO] 重置 ${reset} 个超时任务`)

  const next = tasks.find((t) => t.status === '待挖掘')
  if (!next) {
    save(meta, tasks)
    console.log('{"all_done": true}')
    process.exit(0)
  }
  next.status = '挖掘中'
  next.start_time = nowStr()
  next.attempt_count = (next.attempt_count ?? 0) + 1
  save(meta, tasks)
  console.log('=====TASK_INFO=====')
  console.log(`index: ${next.index}`)
  console.log(`function_name: ${next.function_name}`)
  console.log(`attempt_count: ${next.attempt_count}`)
  console.log(`entries: ${(next.entries ?? []).join(',')}`)
  console.log(`modules: ${(next.modules ?? []).join(',')}`)
  console.log('=====END=====')
  process.exit(0)
}

if (action === 'update_complete') {
  const t = findTask(argOf('--index'))
  if (!t) { console.error('找不到该任务'); process.exit(1) }
  t.status = '挖掘完成'
  t.end_time = nowStr()
  t.page_id = argOf('--page-id') ?? t.page_id
  delete t.fail_reason
  save(meta, tasks)
  console.log(`[OK] ${t.function_name} → 挖掘完成${t.page_id ? `（${t.page_id}）` : ''}`)
  process.exit(0)
}

if (action === 'update_failed') {
  const t = findTask(argOf('--index'))
  if (!t) { console.error('找不到该任务'); process.exit(1) }
  const attempts = t.attempt_count ?? 0
  if (attempts >= 3) {
    t.status = '挖掘失败'
    t.end_time = nowStr()
    t.fail_reason = argOf('--reason') ?? '超过最大重试次数'
    console.log(`[FAIL] ${t.function_name} 已达 ${attempts} 次重试 → 挖掘失败`)
  } else {
    t.status = '待挖掘'  // 未到 3 次则回到待挖掘，下一轮重试
    t.start_time = null
    t.fail_reason = argOf('--reason') ?? ''
    console.log(`[RETRY] ${t.function_name} 失败（第 ${attempts} 次）→ 回到待挖掘`)
  }
  save(meta, tasks)
  process.exit(0)
}

if (action === 'reset_timeout') {
  const timeoutMin = +(argOf('--timeout-minutes') ?? 10)
  const now = Date.now()
  let n = 0
  for (const t of tasks) {
    if (t.status !== '挖掘中' || !t.start_time) continue
    const started = new Date(t.start_time.replace(' ', 'T')).getTime()
    if (Number.isFinite(started) && now - started > timeoutMin * 60_000) {
      t.status = '待挖掘'
      t.attempt_count = (t.attempt_count ?? 0) + 1
      t.start_time = null
      n++
    }
  }
  save(meta, tasks)
  console.log(`[OK] 重置 ${n} 个超时任务`)
  process.exit(0)
}

if (action === 'status') {
  const done = tasks.filter((t) => t.status === '挖掘完成').length
  console.log(`进度: ${done}/${tasks.length} 完成`)
  for (const t of tasks) {
    const icon = t.status === '挖掘完成' ? '✓' : t.status === '挖掘中' ? '→' : t.status === '挖掘失败' ? '✗' : '○'
    console.log(`  ${icon} ${t.index}. ${t.function_name}  [${t.status}]${t.page_id ? ' → ' + t.page_id : ''}`)
  }
  process.exit(done === tasks.length ? 0 : 0)
}

console.error('未知动作。可用: get_next | update_complete | update_failed | reset_timeout | status')
process.exit(1)
