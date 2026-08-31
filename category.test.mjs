// category.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

test('WikiCategory 扩展 dictionaries + tables', () => {
  const t = readFileSync(join(ROOT, 'src/types.ts'), 'utf8')
  assert.match(t, /'dictionaries'/, 'types.ts 应含 dictionaries 分类')
  assert.match(t, /'tables'/, 'types.ts 应含 tables 分类')
})

test('vault-store CATEGORIES 数组含新目录', () => {
  const t = readFileSync(join(ROOT, 'src/vault-store.ts'), 'utf8')
  assert.match(t, /'dictionaries'/, 'CATEGORIES 应含 dictionaries')
  assert.match(t, /'tables'/, 'CATEGORIES 应含 tables')
})
