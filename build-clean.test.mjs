// build-clean.test.mjs
// tsc 只覆盖同名产物、不删旧文件：模块删除后 lib/xxx.js 会一直留在发布包里
// （2026.11.15 的 lib/subvault.js 就是这样漏出去的）。build 必须先清 lib。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)))

test('build 前清空 lib：旧产物不留、client/ 不受影响', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-knj-clean-lib-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  // 模拟一款已删除模块的旧产物 + 正常产物
  mkdirSync(join(dir, 'lib', 'types'), { recursive: true })
  writeFileSync(join(dir, 'lib', 'subvault.js'), 'export const stale = 1\n')
  writeFileSync(join(dir, 'lib', 'index.js'), 'export {}\n')
  // client/ 是 tsdown 的独立产物，清 lib 绝不能碰
  mkdirSync(join(dir, 'client'), { recursive: true })
  writeFileSync(join(dir, 'client', 'client.js'), '/* client bundle */\n')

  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'clean-lib.mjs'), dir], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr || r.stdout)
  assert.equal(existsSync(join(dir, 'lib')), false, 'lib 应被整体清空（死代码不随包发布）')
  assert.equal(existsSync(join(dir, 'client', 'client.js')), true, 'client/ 不是 tsc 产物，不得删除')
})

test('package.json 的 build 先清 lib 再 tsc', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const build = String(pkg.scripts.build)
  assert.match(build, /clean-lib\.mjs/, 'build 必须调用 clean-lib 脚本')
  const cleanAt = build.indexOf('clean-lib.mjs')
  const tscAt = build.indexOf('tsc -p tsconfig.json')
  assert.ok(cleanAt >= 0 && tscAt > cleanAt, `build 必须先清 lib 再编译：${build}`)
})
