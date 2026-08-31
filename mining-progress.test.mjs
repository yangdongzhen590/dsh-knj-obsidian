// mining-progress.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProgress, markModule, pendingModules, progressFileFor } from './lib/mining-progress.js'

function tmp() { return mkdtempSync(join(tmpdir(), 'mining-progress-')) }

test('readProgress 文件不存在返回空结构', () => {
  const p = readProgress(join(tmp(), 'progress.json'), 'enum')
  assert.equal(p.version, 1)
  assert.equal(p.kind, 'enum')
  assert.deepEqual(Object.keys(p.modules), [])
})

test('markModule 写回文件且中断安全（重读一致）', () => {
  const dir = tmp()
  const file = join(dir, 'progress.json')
  let p = readProgress(file, 'enum')
  markModule(p, 'order', 'done', file)
  // 模拟中断后重新读取
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(raw.modules.order.state, 'done')
  p = readProgress(file, 'enum')
  assert.equal(p.modules.order.state, 'done')
  rmSync(dir, { recursive: true, force: true })
})

test('pendingModules 只返回未完成模块', () => {
  const file = join(tmp(), 'progress.json')
  let p = readProgress(file, 'enum')
  markModule(p, 'order', 'done', file)
  markModule(p, 'user', 'pending', file)
  markModule(p, 'pay', 'partial', file)
  assert.deepEqual(pendingModules(p).sort(), ['pay', 'user'])
})

test('progressFileFor 落在 vault _raw/_tools 下', () => {
  const f = progressFileFor('D:/proj/.wiki', 'enum')
  assert.ok(f.includes('_raw'), '应在 _raw 下')
  assert.ok(f.includes('_tools'), '应在 _tools 下')
  assert.ok(f.endsWith('progress-enum.json'), '文件名带 kind')
})
