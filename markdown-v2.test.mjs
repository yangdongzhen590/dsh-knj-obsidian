// markdown-v2.test.mjs — v5 富渲染管线测试（先红后绿）。
// Node 环境无 window：renderMarkdown 走「先转义后解析」回退路径；
// 浏览器路径（marked + DOMPurify）的净化接线由 client 构建产物与源码断言覆盖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from './src/client/markdown.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

test('表格渲染为 <table>（表头/行/列齐全）', () => {
  const md = '| 插件 | 版本 |\n|---|---|\n| obsidian | 257 |\n| menu | 251 |'
  const out = renderMarkdown(md)
  assert.ok(out.includes('<table'), '应有 <table>')
  assert.ok(out.includes('<th>插件</th>') || out.includes('<th>插件'), '表头单元格')
  assert.ok(out.includes('<td>obsidian</td>') || out.includes('<td>obsidian'), '数据行')
})

test('引用块渲染为 <blockquote>', () => {
  const out = renderMarkdown('> 引用内容')
  assert.ok(out.includes('<blockquote'), '应有 blockquote')
})

test('任务列表渲染为 checkbox', () => {
  const out = renderMarkdown('- [x] 已完成\n- [ ] 待办')
  assert.ok(/type="checkbox"|checked/.test(out), '应有 checkbox（checked 或 disabled 形态）')
})

test('分隔线渲染为 <hr>', () => {
  const out = renderMarkdown('段落一\n\n---\n\n段落二')
  assert.ok(out.includes('<hr'), '应有 hr')
})

test('wikilink 带别名：data-wikilink 取目标，显示别名', () => {
  const out = renderMarkdown('参见 [[deep-module|深模块]]')
  assert.ok(out.includes('data-wikilink="deep-module"'), 'data-wikilink 应为目标 id')
  assert.ok(out.includes('深模块'), '显示文本应为别名')
  assert.ok(out.includes('href="#"'), '锚点 href 固定 #（无 js 注入面）')
})

test('Node 回退路径：原始 <script> 与 onerror 不存活，markdown 语法照常', () => {
  const out = renderMarkdown('**粗体** 与 <script>alert(1)</script> 和 <img src=x onerror=alert(1)>')
  assert.ok(!out.includes('<script'), '不得有原始 script 标签')
  assert.ok(!/<img\s[^>]*onerror/i.test(out), '不得有携带 onerror 属性的 img 元素（纯文本实体呈现可接受）')
  assert.ok(out.includes('<strong>粗体</strong>'), '粗体应生效')
})

test('源码断言：marked 与 DOMPurify 进入渲染管线（浏览器路径）', () => {
  const text = readFileSync(join(ROOT, 'src/client/markdown.ts'), 'utf8')
  assert.match(text, /from 'marked'/, '应引入 marked')
  assert.match(text, /from 'dompurify'/, '应引入 dompurify')
  assert.match(text, /isSupported/, '应有 DOMPurify 可用性判断（Node 回退/浏览器净化两路）')
  assert.match(text, /ALLOWED_TAGS|ALLOWED_ATTR/, '净化应配置白名单')
})
