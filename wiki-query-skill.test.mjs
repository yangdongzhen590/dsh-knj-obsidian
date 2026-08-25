// wiki-query-skill.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath（而非 URL.pathname + join）：Windows 上 pathname 形如 /D:/…，
// join 后产生 \\D:\…，fs 会解析成不存在的 D:\D:\…
const ROOT = fileURLToPath(new URL('.', import.meta.url))

test('wiki-query skill 存在且包含分层检索流程', () => {
  const skill = join(ROOT, 'wiki-query/SKILL.md')
  assert.ok(existsSync(skill), 'SKILL.md 应存在')
  const text = readFileSync(skill, 'utf8')
  assert.match(text, /name: wiki-query/)
  assert.match(text, /L1/)
  assert.match(text, /L2/)
  assert.match(text, /只读/)
  assert.match(text, /index\.md/)
})

test('references 检索指南存在且含 fallback', () => {
  const ref = join(ROOT, 'wiki-query/references/retrieval-guide.md')
  assert.ok(existsSync(ref), 'references/retrieval-guide.md 应存在')
  const text = readFileSync(ref, 'utf8')
  assert.match(text, /grep/)
  assert.match(text, /fallback|回退|降级/)
})
