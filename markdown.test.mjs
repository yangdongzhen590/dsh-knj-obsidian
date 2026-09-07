// markdown.test.mjs
// Task 4 存在性 + 行为测试：markdown.ts（escape-then-whitelist 渲染）与 NoteView.tsx。
// brief 的断言 regex 笔误（`/replace\(/g === undefined ? /</ : /</` 恒为 /</）已按
// controller ruling 改写：存在性 + escapeHtml 源断言 + 直接调用 renderMarkdown 验证转义。
// Node >= 23.6 默认 type stripping：markdown.ts 仅含可擦除注解，可直接 import 调用。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderMarkdown, PURIFY_CONFIG } from './src/client/markdown.ts'

// fileURLToPath（而非 URL.pathname + join）：Windows 上 pathname 形如 /D:/…，
// join 后产生 \\D:\…，fs 会解析成不存在的 D:\D:\…（见 client-build.test.mjs 同款约定）
const ROOT = fileURLToPath(new URL('.', import.meta.url))

test('markdown.ts 存在、导出 renderMarkdown 且含 escapeHtml（先转义后白名单）', () => {
  const md = join(ROOT, 'src/client/markdown.ts')
  assert.ok(existsSync(md), 'src/client/markdown.ts 应存在')
  const text = readFileSync(md, 'utf8')
  assert.match(text, /export function renderMarkdown/, '应导出 renderMarkdown')
  assert.match(text, /escapeHtml/, '应包含 escapeHtml（完整 HTML 转义先于一切白名单转换）')
})

test('renderMarkdown 输出不含原始 <script>，wikilink 转白名单锚点，标题/粗体/代码/列表可用', () => {
  // XSS 主断言：先完整转义，原始 <script> 永不出现；粗体白名单标签照常生效
  const out = renderMarkdown('**x** 与 <script>alert(1)</script>')
  assert.ok(!out.includes('<script'), '输出不得含原始 <script>')
  assert.ok(out.includes('&lt;script&gt;'), '应以转义实体呈现 script 标签')
  assert.ok(out.includes('<strong>x</strong>'), '粗体白名单标签应生效')

  // wikilink：href 固定 '#'（无 javascript: 注入面）+ data-wikilink 携带目标
  const linked = renderMarkdown('参见 [[deep-module]] 与 [[概念页#章|别名]]')
  assert.ok(linked.includes('<a href="#" data-wikilink="deep-module"'), 'wikilink 应转为白名单锚点')
  assert.ok(linked.includes('data-wikilink="概念页"'), '带 #锚点|别名 的 wikilink 应取目标名')

  // 标题层级按 # 数量（brief 原代码 m[2] 未定义会在标题上崩溃）
  assert.ok(renderMarkdown('# 大标题').includes('<h1'), '一级标题')
  assert.ok(renderMarkdown('### 三级').includes('<h3'), '三级标题')

  // 代码块与列表
  assert.ok(renderMarkdown('```\nalert(1)\n```').includes('<pre'), '围栏代码块')
  assert.ok(renderMarkdown('- 项目一').includes('<li>项目一</li>'), '列表项')
})

test('NoteView.tsx 存在、含 wikilink 处理且 innerHTML 仅喂 renderMarkdown 输出', () => {
  const nv = join(ROOT, 'src/client/NoteView.tsx')
  assert.ok(existsSync(nv), 'src/client/NoteView.tsx 应存在')
  const text = readFileSync(nv, 'utf8')
  assert.match(text, /wikilink|\[\[/i, '应含 wikilink 处理')
  assert.match(text, /renderMarkdown/, '正文应经 renderMarkdown 渲染')
  assert.match(text, /dangerouslySetInnerHTML/, '正文容器使用 dangerouslySetInnerHTML')
  assert.match(text, /__html:\s*content/, 'innerHTML 仅喂 content 状态（content 只来自 renderMarkdown 输出或空串）')
})

test('笔记图片可显示：img 的 src/alt 不得被白名单剥掉，危险协议仍拦', () => {
  // 契约层：DOMPurify 白名单必须放行 img 的 src/alt（浏览器路径）
  assert.ok(PURIFY_CONFIG.ALLOWED_TAGS.includes('img'), 'img 标签应在白名单')
  assert.ok(PURIFY_CONFIG.ALLOWED_ATTR.includes('src'), 'src 属性必须保留（否则全部笔记图片破图）')
  assert.ok(PURIFY_CONFIG.ALLOWED_ATTR.includes('alt'), 'alt 属性应保留')

  // 行为层：Node 回退路径同样渲染图片，相对路径可用
  const out = renderMarkdown('![架构图](assets/arch.png)')
  assert.ok(out.includes('<img'), '应渲染出 img 标签')
  assert.ok(out.includes('src="assets/arch.png"'), '相对路径图片应可用')
  assert.ok(out.includes('alt="架构图"'), 'alt 属性应保留')
  // 协议防护：javascript: 协议剥成纯 alt 文本
  const evil = renderMarkdown('![x](javascript:alert(1))')
  assert.ok(!evil.includes('src="javascript:'), 'javascript: 协议必须被剥')
  assert.ok(!evil.includes('<img'), '危险协议不产生 img')
})
