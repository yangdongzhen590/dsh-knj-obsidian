/**
 * 会话级根解析（纯函数）用例。
 *
 * 契约：面板跟随的是「当前会话所属工作区」，不是宿主全局单值当前库。
 * 0.2 的 sessions 快照没有 `current`、workspaces 快照没有 `recentWorkspaceId`，
 * 所以解析必须走 sessionId + cwd + workspace 行（sessionIds/path）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const mod = await import(pathToFileURL(join(ROOT, 'src/client/session-root.ts')).href)
const { resolveSessionRoot, normalizeRoot } = mod

test('normalizeRoot: 大小写/分隔符/尾斜杠归一', () => {
  assert.equal(normalizeRoot('D:\\Dsh-KNJ\\x\\'), 'd:/dsh-knj/x')
  assert.equal(normalizeRoot(undefined), '')
})

test('sessionId 归属工作区 → 取该工作区 path（优先于 cwd）', () => {
  const root = resolveSessionRoot({
    sessionId: 's-1',
    cwd: 'C:\\Users\\MrYang',
    workspaces: [
      { workspaceId: 'w-a', path: 'D:\\workspace\\tap-taste', sessionIds: ['s-9'] },
      { workspaceId: 'w-b', path: 'D:\\dsh-knj\\dsh-knj-scheduler', sessionIds: ['s-1'] },
    ],
  })
  assert.equal(root, 'D:\\dsh-knj\\dsh-knj-scheduler')
})

test('无归属时取 cwd 的最深已注册工作区祖先', () => {
  const root = resolveSessionRoot({
    sessionId: 's-2',
    cwd: 'D:\\dsh-knj\\dsh-knj-obsidian\\src',
    workspaces: [
      { path: 'D:\\dsh-knj' },
      { path: 'D:\\dsh-knj\\dsh-knj-obsidian' },
    ],
  })
  assert.equal(root, 'D:\\dsh-knj\\dsh-knj-obsidian')
})

test('cwd 不在任何工作区下 → 用 cwd 自己', () => {
  const root = resolveSessionRoot({
    sessionId: 's-3',
    cwd: 'E:\\scratch\\demo',
    workspaces: [{ path: 'D:\\workspace\\tap-taste' }],
  })
  assert.equal(root, 'E:\\scratch\\demo')
})

test('既无归属也无 cwd → undefined（不得猜全局库）', () => {
  assert.equal(resolveSessionRoot({ sessionId: 's-4', workspaces: [{ path: 'D:\\x' }] }), undefined)
  assert.equal(resolveSessionRoot({}), undefined)
})

test('cwd 与工作区路径的比较对 Windows 大小写不敏感', () => {
  const root = resolveSessionRoot({
    cwd: 'd:\\DSH-KNJ\\DSH-KNJ-SCHEDULER',
    workspaces: [{ path: 'D:\\dsh-knj\\dsh-knj-scheduler' }],
  })
  assert.equal(root, 'D:\\dsh-knj\\dsh-knj-scheduler')
})
