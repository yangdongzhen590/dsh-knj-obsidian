// markdown-v3.test.mjs — v5.1 浏览器渲染路径修复（先红后绿）。
// 根因：\u0000 占位符过 DOMPurify（DOM parse → serialize）时，HTML 规范把 U+0000
// 替换为 U+FFFD，占位还原正则永不匹配 → wikilink 锚点从未生成。
// 修法：marked 内联扩展在 token 层直接产出锚点；此处直接测 parseWithMarked 输出。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWithMarked } from './src/client/markdown.ts'

test('wikilink 基本形态：解析为 data-wikilink 锚点', () => {
  const out = parseWithMarked('参见 [[deep-module]] 页面')
  assert.ok(out.includes('<a href="#" data-wikilink="deep-module"'), '应有锚点: ' + out)
  assert.ok(/>deep-module</.test(out), '默认显示 id 文本')
})

test('wikilink 带别名：data-wikilink 取目标，显示别名', () => {
  const out = parseWithMarked('参见 [[deep-module|深模块]]')
  assert.ok(out.includes('data-wikilink="deep-module"'), '目标 id 进属性')
  assert.ok(out.includes('>深模块</a>'), '别名做显示文本')
})

test('代码块内的 [[x]] 不转锚点（字面呈现）', () => {
  const out = parseWithMarked('```\n[[ghost-link]]\n```')
  assert.ok(!out.includes('data-wikilink'), '代码块内容不得变链接: ' + out)
  assert.ok(out.includes('[[ghost-link]]'), '字面保留')
})

test('行内代码内的 [[x]] 不转锚点', () => {
  const out = parseWithMarked('写 `[[inline-code]]` 时')
  assert.ok(!out.includes('data-wikilink'), '行内代码不得变链接')
})

test('非法 id（空格/尖括号）按原文呈现，不产生锚点', () => {
  assert.ok(!parseWithMarked('[[bad id]]').includes('data-wikilink'))
  assert.ok(!parseWithMarked('[[a<b]]').includes('data-wikilink'))
  assert.ok(parseWithMarked('[[bad id]]').includes('[[bad id]]'), '原文保留')
})

test('别名含 HTML：标签被转义，不得逃逸', () => {
  const out = parseWithMarked('[[ok-page|<b>加粗</b>]]')
  assert.ok(out.includes('data-wikilink="ok-page"'))
  assert.ok(!out.includes('<b>加粗</b>'), '别名中的标签必须转义: ' + out)
  assert.ok(out.includes('&lt;b&gt;'), '以实体呈现')
})

test('表格单元格内的 wikilink 也成锚点', () => {
  const out = parseWithMarked('| 页面 | 说明 |\n|---|---|\n| [[a-page]] | 入口 |')
  assert.ok(out.includes('data-wikilink="a-page"'), '表格内 wikilink 应可点')
})
