// smoke.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath（而非 URL.pathname + join）：Windows 上 pathname 形如 /D:/…，
// join 后产生 \\D:\…，fs 会解析成不存在的 D:\D:\…
const ROOT = fileURLToPath(new URL('.', import.meta.url))

test('插件包声明存在且指向 cordis 补丁', () => {
  const pkg = JSON.parse(readPkg())
  assert.equal(pkg.name, 'dsh-knj-obsidian')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.main, 'lib/index.js')
})

test('cordis patch 声明插件行', () => {
  const yml = readFile('cordis.patch.yml')
  assert.match(yml, /- insert:/)
  assert.match(yml, /id: dsh-knj-obsidian/)
})

test('src 有 cordis 入口与类型文件', () => {
  assert.ok(existsSync(join(ROOT, 'src/index.ts')))
  assert.ok(existsSync(join(ROOT, 'src/types.ts')))
})

test('files 白名单含 wiki-query，且 skill 文件就位（v2 检索必须随包分发）', () => {
  const pkg = JSON.parse(readPkg())
  assert.ok(pkg.files.includes('wiki-query'), 'files 白名单必须包含 wiki-query 目录')
  assert.ok(existsSync(join(ROOT, 'wiki-query/SKILL.md')))
  assert.ok(existsSync(join(ROOT, 'wiki-query/references/retrieval-guide.md')))
})

function readPkg() { return readFile('package.json') }
function readFile(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}
