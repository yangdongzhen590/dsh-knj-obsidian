// collection-client.test.mjs
// 源码级契约：代码采集 = GUI 启动器（预填当前对话 + 复制兜底，引用内置 wiki-collect skill），
// 不再含浏览器受审阅状态机；旧直接导入仍标注「快速导入（直接写入）」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CLIENT = join(import.meta.dirname, 'src', 'client')
const launcher = readFileSync(join(CLIENT, 'CodeCollectLauncher.tsx'), 'utf8')
const lintPanel = readFileSync(join(CLIENT, 'LintPanel.tsx'), 'utf8')
const sidebar = readFileSync(join(CLIENT, 'WikiSidebar.tsx'), 'utf8')
const index = readFileSync(join(CLIENT, 'index.ts'), 'utf8')
const api = readFileSync(join(CLIENT, 'api.ts'), 'utf8')

test('launcher discloses exact supported scope and names the wiki-collect skill', () => {
  assert.match(launcher, /wiki-collect/)
  assert.match(launcher, /Java enum/)
  assert.match(launcher, /Java public static final/)
  assert.match(launcher, /SQL DDL/)
  assert.match(launcher, /MyBatis XML/)
  assert.match(launcher, /JPA Entity/)
  assert.match(launcher, /TypeScript/)
  assert.match(launcher, /不支持/)
})

test('launcher prefills the conversation and has copy fallback, no browser draft state', () => {
  assert.match(launcher, /sendToAgent/)
  assert.match(launcher, /预填当前对话开始采集/)
  assert.match(launcher, /复制触发指令/)
  assert.match(launcher, /直接入库/)
  assert.doesNotMatch(launcher, /applyCollection|collect\/|确认写入所选草稿/)
})

test('legacy direct import is labelled quick direct write', () => {
  assert.match(lintPanel, /快速导入（直接写入）/)
  assert.match(lintPanel, /直接写入/)
  assert.match(lintPanel, /跳过受审阅流程/)
})

test('sidebar and boot wiring expose the launcher with conversation bridge', () => {
  assert.match(sidebar, /CodeCollectLauncher/)
  assert.match(sidebar, /代码采集/)
  assert.match(index, /conversation/)
  assert.match(index, /sendToAgent/)
  assert.doesNotMatch(api, /collect\//)
})
