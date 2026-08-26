// client-build.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath（而非 URL.pathname + join）：Windows 上 pathname 形如 /D:/…，
// join 后产生 \\D:\…，fs 会解析成不存在的 D:\D:\…（见 smoke.test.mjs 同款约定）
const ROOT = fileURLToPath(new URL('.', import.meta.url))

test('client 构建产物存在且为 ModuleLoader 工厂', () => {
  const client = join(ROOT, 'client/client.js')
  assert.ok(existsSync(client), 'client/client.js 应存在（先 npm run build:client）')
  const text = readFileSync(client, 'utf8')
  assert.ok(text.includes('__ModuleLoader__'), '应含 ModuleLoader 工厂')
})

test('package.json 声明 client 入口与构建脚本', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('dsh-better-sidebar'))
  assert.equal(pkg.exports['./client'].default, './client/client.js')
  assert.ok(pkg.scripts['build:client'])
})
