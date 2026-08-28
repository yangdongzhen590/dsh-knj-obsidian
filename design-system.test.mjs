// design-system.test.mjs
// 设计系统 v2 契约（红绿测试）：
// 1. styles.ts 存在，基于宿主令牌（--dsw-alias-* / --dsw-static-*）定义 WIKI_CSS，并导出 injectWikiStyles
// 2. index.ts 挂载时注入样式
// 3. 各组件使用 className 类样式（不再全部内联 style）
// 4. 组件不再硬编码旧暗色色板（#0b1020 / #1f2937 / #374151 / …）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const CLIENT = join(ROOT, 'src/client')

const FILES = [
  'VaultHeader.tsx', 'VaultTree.tsx', 'SearchBox.tsx', 'LintPanel.tsx',
  'GraphView.tsx', 'WikiSidebar.tsx', 'NoteView.tsx', 'NoteWorkbench.tsx',
]
// 旧界面的硬编码色板（含暗色小按钮/边框/背景的典型值）
const OLD_HEX = /#(?:0b1020|1f2937|374151|111827|052e16|450a0a|451a03)\b/i

test('设计系统：styles.ts 存在且基于宿主令牌', () => {
  const s = join(CLIENT, 'styles.ts')
  assert.ok(existsSync(s), 'src/client/styles.ts 应存在（设计系统 v2）')
  const text = readFileSync(s, 'utf8')
  assert.match(text, /WIKI_CSS/, '应导出 WIKI_CSS')
  assert.match(text, /injectWikiStyles/, '应导出 injectWikiStyles')
  assert.match(text, /--dsw-alias-/, '应引用宿主别名令牌 --dsw-alias-*')
  assert.match(text, /--dsw-static-/, '应引用宿主静态色板 --dsw-static-*')
})

test('index.ts 挂载时注入样式', () => {
  const text = readFileSync(join(CLIENT, 'index.ts'), 'utf8')
  assert.match(text, /injectWikiStyles\(\)/, 'apply 时应调用 injectWikiStyles()')
})

test('组件使用 className 类样式（不再全部内联 style）', () => {
  for (const f of FILES) {
    const text = readFileSync(join(CLIENT, f), 'utf8')
    assert.match(text, /className/, `${f} 应使用 className 样式类`)
  }
})

test('组件不再硬编码旧暗色色板', () => {
  for (const f of FILES) {
    const text = readFileSync(join(CLIENT, f), 'utf8')
    assert.doesNotMatch(text, OLD_HEX, `${f} 不应出现旧色板硬编码（应走宿主令牌）`)
  }
})

// ---- v8 滚动回归契约（falsifiable：回退任一断言即红） ----

test('NoteWorkbench 工作台根容器不得锁死高度（height:100% 会让 md 超高内容无可滚动区域）', () => {
  const text = readFileSync(join(CLIENT, 'NoteWorkbench.tsx'), 'utf8')
  assert.match(text, /height:\s*'auto',\s*minHeight:\s*'100%'/, '正常态根容器应显式 height:auto + minHeight:100%')
})

test('NoteWorkbench 空态：knj-wiki 必须是 knj-empty 的祖先（styles.ts 用后代选择器 .knj-wiki .knj-empty）', () => {
  const text = readFileSync(join(CLIENT, 'NoteWorkbench.tsx'), 'utf8')
  assert.match(text, /<div className="knj-wiki"[\s\S]*?<div className="knj-empty"/, '空态应为外层 knj-wiki 包内层 knj-empty')
})

test('styles.ts 不自定义滚动条（宿主已有 --dsw-alias-scrollbar-* 主题，插件不得重复声明）', () => {
  const text = readFileSync(join(CLIENT, 'styles.ts'), 'utf8')
  assert.doesNotMatch(text, /::-webkit-scrollbar/, 'styles.ts 不得含 ::-webkit-scrollbar 规则')
})

// ---- 根节点双类布局契约（后代选择器不匹配自身，须有复合选择器） ----

test('styles.ts 提供根节点复合选择器 .knj-wiki.knj-col（WikiSidebar 根同节点双类）', () => {
  const text = readFileSync(join(CLIENT, 'styles.ts'), 'utf8')
  assert.match(text, /\.knj-wiki\.knj-col/, '应存在 .knj-wiki.knj-col 复合选择器')
})

test('styles.ts 空态撑满滚动内容区（.knj-scroll > .knj-empty 垂直居中）', () => {
  const text = readFileSync(join(CLIENT, 'styles.ts'), 'utf8')
  assert.match(text, /\.knj-scroll\s*>\s*\.knj-empty\s*\{\s*height:\s*100%/, '滚动区内空态应 height:100%')
})
