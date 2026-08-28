/**
 * v5.1 富渲染管线：
 * - 浏览器：marked（带 wikilink 内联扩展，解析期直接产出锚点 token）→ DOMPurify 白名单净化
 * - Node（测试/SSR 等无 window 环境）：先 HTML 转义再白名单转换的回退渲染器（覆盖本插件用到的语法集）
 *
 * v5.0 → v5.1 教训：此前用 `\u0000WIKILINK<i>\u0000` 占位符过 marked 再在净化后还原，
 * 但 DOMPurify 内部经历 DOM parse → serialize，HTML 规范把文本中的 U+0000 替换为
 * U+FFFD，占位符永不匹配 → wikilink 锚点从未生成（浏览器上双链点不了）。
 * 现改为 marked 内联扩展在 token 层产出最终锚点；代码块/行内代码天然不参与 inline
 * 扩展，也顺带修掉了「代码块里的 [[x]] 被误转成链接」的回归。
 *
 * 安全模式不变：任何进入 dangerouslySetInnerHTML 的输出都经过「转义/净化 + 白名单」，
 * 锚点 href 固定 '#'，无 javascript: 注入面。
 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g
/** wikilink 目标 id 只允许 SAFE_ID 字符集，杜绝把属性玩出花 */
const SAFE_ID = /^[a-zA-Z0-9\u4e00-\u9fff][a-zA-Z0-9\u4e00-\u9fff-]*$/

/** marked 内联扩展：[[target]] / [[target#anchor]] / [[target|alias]] → 白名单锚点。 */
const wikilinkExtension = {
  name: 'wikilink',
  level: 'inline' as const,
  start(src: string) { return src.indexOf('[[') },
  tokenizer(src: string) {
    const m = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/.exec(src)
    if (!m) return undefined
    const id = m[1].trim()
    const label = (m[2] ?? '').trim() || id
    if (!SAFE_ID.test(id)) return undefined // 非法目标：不消费，按普通文本走
    return { type: 'wikilink', raw: m[0], id, label }
  },
  renderer(token: { id: string; label: string }) {
    return `<a href="#" data-wikilink="${escapeHtml(token.id)}">${escapeHtml(token.label)}</a>`
  },
}

marked.use({ extensions: [wikilinkExtension] })

/** 仅 marked（含 wikilink 扩展），不净化。测试与浏览器路径共用的解析段。 */
export function parseWithMarked(text: string): string {
  return marked.parse(text, { async: false, gfm: true, breaks: false }) as string
}

/** DOMPurify 白名单：markdown 呈现所需标签 + wikilink 锚点的 data 属性。 */
const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', 'em', 'del', 's',
    'ul', 'ol', 'li', 'input', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'a', 'span', 'div', 'img'],
  ALLOWED_ATTR: ['href', 'data-wikilink', 'type', 'checked', 'disabled', 'class', 'align'],
}

/** 已转义文本上的 wikilink → 锚点（回退渲染器行内使用）。 */
export function renderWikilinks(escapedText: string): string {
  return escapedText.replace(WIKILINK_RE, (_m, target: string, alias?: string) => {
    const id = target.trim()
    const label = (alias ?? '').trim() || id
    if (!SAFE_ID.test(id)) return _m
    return `<a href="#" data-wikilink="${escapeHtml(id)}">${escapeHtml(label)}</a>`
  })
}

export function renderMarkdown(text: string): string {
  // 浏览器路径：marked（wikilink 扩展）+ DOMPurify
  if (typeof window !== 'undefined' && DOMPurify.isSupported) {
    return DOMPurify.sanitize(parseWithMarked(text), PURIFY_CONFIG)
  }
  // Node 回退路径：转义 + 白名单转换（覆盖标题/粗体/斜体/删除线/代码/代码块/列表/任务列表/表格/引用/分隔线）
  return renderFallback(text)
}

/** Node 无 DOM 的回退渲染器：先转义后白名单（与 v4 安全模式同源）。 */
function renderFallback(text: string): string {
  const escaped = escapeHtml(text)
  const blocks: string[] = []
  const noBlocks = escaped.replace(/```([\s\S]*?)```/g, (_m, code: string) => {
    blocks.push(`<pre><code>${code}</code></pre>`)
    return `\u0001BLOCK${blocks.length - 1}\u0001`
  })
  const lines = noBlocks.split('\n')
  const out: string[] = []
  let inUl = false, inOl = false, inQuote = false
  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false }
    if (inOl) { out.push('</ol>'); inOl = false }
  }
  const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false } }

  // 表格：连续的 |…| 行块
  const flushTable = (rows: string[]) => {
    if (!rows.length) return
    const cells = (row: string) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    const header = cells(rows[0])
    const bodyRows = rows[2] !== undefined ? rows.slice(2) : []
    out.push('<table><thead><tr>' + header.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>')
    for (const r of bodyRows) {
      out.push('<tr>' + cells(r).map((c) => `<td>${c}</td>`).join('') + '</tr>')
    }
    out.push('</tbody></table>')
  }
  let tableRows: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    // 表格行收集
    if (/^\|.*\|$/.test(line.trim())) { tableRows.push(line.trim()); continue }
    flushTable(tableRows); tableRows = []

    const m = line.match(/^(#{1,6})\s+(.*)$/)
    if (m) {
      closeLists(); closeQuote()
      const level = Math.min(m[1].length, 6)
      out.push(`<h${level}>${renderWikilinks(inline(m[2] ?? ''))}</h${level}>`)
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeLists(); closeQuote()
      out.push('<hr>')
      continue
    }
    // 注意：此处 line 已经过 escapeHtml，引用符呈现为 &gt;
    if (line.startsWith('&gt; ') || line.startsWith('&gt;')) {
      closeLists()
      if (!inQuote) { out.push('<blockquote>'); inQuote = true }
      out.push(`<p>${renderWikilinks(inline(line.replace(/^&gt;\s?/, '')))}</p>`)
      continue
    }
    closeQuote()
    const task = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/)
    if (task) {
      if (inOl) { out.push('</ol>'); inOl = false }
      if (!inUl) { out.push('<ul>'); inUl = true }
      const checked = task[1].toLowerCase() === 'x'
      out.push(`<li><input type="checkbox" disabled${checked ? ' checked' : ''}> ${renderWikilinks(inline(task[2]))}</li>`)
      continue
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (inOl) { out.push('</ol>'); inOl = false }
      if (!inUl) { out.push('<ul>'); inUl = true }
      out.push(`<li>${renderWikilinks(inline(line.slice(2)))}</li>`)
      continue
    }
    const ol = line.match(/^\d+\.\s+(.*)$/)
    if (ol) {
      if (inUl) { out.push('</ul>'); inUl = false }
      if (!inOl) { out.push('<ol>'); inOl = true }
      out.push(`<li>${renderWikilinks(inline(ol[1]))}</li>`)
      continue
    }
    closeLists()
    if (line === '') { out.push(''); continue }
    const block = line.match(/^\u0001BLOCK(\d+)\u0001$/)
    if (block) { out.push(blocks[Number(block[1])]); continue }
    out.push(`<p>${renderWikilinks(inline(line))}</p>`)
  }
  flushTable(tableRows)
  closeLists(); closeQuote()
  return out.join('\n')
}

/** 行内语法：代码、粗体、斜体、删除线。输入已转义（wikilink 由 renderWikilinks 处理）。 */
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
}
