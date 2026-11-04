/**
 * 查找边界必须包含**运行期新增**的工作区（P1-3，2026-11-05 评审）。
 *
 * 为什么钉这条：`src/index.ts` 只在 apply 时把 `workspaceRegistry.list()` 快照一次，
 * 而 DSH 允许在运行期新建工作区。快照之外的新工作区不在 `knownRoots()` 里，
 * `nearestVaultRoot` 于是越过它继续向上，命中**祖先目录的 `.wiki`** ——
 * 面板按会话归属解析（409），工具却把页写进祖先库：静默的跨库写入。
 *
 * 本机放大因素：`C:\Users\MrYang\.wiki` 真实存在（历史无界向上搜索的遗留库），
 * 所以"家目录下新建一个工作区"这条路径上，写穿是立刻发生的。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultManager } from './lib/vault-manager.js'

test('运行期新增的工作区必须成为查找边界（否则静默绑到祖先库）', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'knj-boundary-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const cwdRoot = join(dir, 'host')
  const parent = join(dir, 'parent')
  const fresh = join(parent, 'fresh-workspace') // 启动后才出现的工作区
  const plainSub = join(parent, 'plain-subdir') // 不是工作区的子目录（应继续向上找库）
  for (const p of [cwdRoot, parent, fresh, plainSub]) mkdirSync(p, { recursive: true })

  const roots = [] // 宿主启动时还不知道 fresh
  let manager
  let why
  try {
    manager = new VaultManager({
      registryFile: join(dir, 'vaults.json'),
      cwdRoot,
      workspaceRoots: () => roots, // 动态边界：每次解析都问一次宿主
      subVaults: false,
    })
  } catch (err) {
    manager = undefined
    why = err
  }
  assert.ok(
    manager,
    `VaultManager 必须接受 workspaceRoots 取值函数（宿主工作区可在运行期新增）：${why?.message ?? ''}`,
  )

  manager.ensureVaultAt(parent) // 祖先目录先有库（这就是会被误绑的那个库）
  roots.push({ path: fresh }) // 运行期新增工作区

  assert.equal(
    manager.readonlyVaultForRoot(fresh),
    undefined,
    '运行期新增的工作区不是边界 → 会静默绑定祖先目录的库（写穿）',
  )
  assert.ok(manager.readonlyVaultForRoot(parent), '祖先库本身仍应可解析（对照）')
  assert.ok(
    manager.readonlyVaultForRoot(plainSub),
    '普通子目录（不是工作区）应继续向上找到工作区库——边界不能把子目录查找一刀切掉',
  )
})
