// category-ui.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const CLIENT = join(ROOT, 'src/client')

test('index-builder 分区标题含字典/数据结构', () => {
  const t = readFileSync(join(ROOT, 'src/index-builder.ts'), 'utf8')
  assert.match(t, /'dictionaries', title: '## 字典'/, 'index-builder 应有字典分区')
  assert.match(t, /'tables', title: '## 数据结构'/, 'index-builder 应有数据结构分区')
})

test('LintPanel 导入分类含新目录', () => {
  const t = readFileSync(join(CLIENT, 'LintPanel.tsx'), 'utf8')
  assert.match(t, /value: 'dictionaries'/, 'LintPanel 应有 dictionaries 分类')
  assert.match(t, /value: 'tables'/, 'LintPanel 应有 tables 分类')
})

test('GraphView 着色映射含新分类', () => {
  const t = readFileSync(join(CLIENT, 'GraphView.tsx'), 'utf8')
  assert.match(t, /dictionaries/, 'GraphView 应有 dictionaries 着色')
  assert.match(t, /tables/, 'GraphView 应有 tables 着色')
})

test('styles.ts 新分类色标', () => {
  const t = readFileSync(join(CLIENT, 'styles.ts'), 'utf8')
  assert.match(t, /--knj-cat-dictionaries/, 'styles.ts 应有 dictionaries 色标')
  assert.match(t, /--knj-cat-tables/, 'styles.ts 应有 tables 色标')
})
