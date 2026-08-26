/**
 * 极简 markdown → 安全 HTML 渲染：
 * - 先 HTML 转义（防注入）
 * - 再把 [[wikilink]] 转成可点击链接
 * 支持：标题（# 前缀）、粗体、代码块（``` 围栏）、行内代码、列表（- 前缀）、wikilink。
 * 不支持完整 markdown（v4 只读渲染，够用即可）。
 *
 * 安全模式「先转义后白名单」：escapeHtml 在一切规则之前对全文执行；
 * 此后仅追加白名单标签（h1-h4/ul/li/p/div/pre/code/strong/a），
 * 锚点 href 固定为 '#'，无 javascript: 注入面。
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g

/** wikilink 目标 → 页面标识（category/id 需由调用方解析；此处转成 data 属性 + 文本） */
export function renderWikilinks(text: string): string {
  return text.replace(WIKILINK_RE, (_m, target: string) => {
    const id = target.trim()
    return `<a href="#" data-wikilink="${escapeHtml(id)}" style="color:#3b82f6;text-decoration:underline">${escapeHtml(id)}</a>`
  })
}

export function renderMarkdown(text: string): string {
  const escaped = escapeHtml(text)
  // 代码块先行（避免围栏内容被其他规则破坏）
  const blocks: string[] = []
  const noBlocks = escaped.replace(/```([\s\S]*?)```/g, (_m, code: string) => {
    blocks.push(`<pre style="background:#111827;padding:8px;border-radius:6px;overflow:auto"><code>${code}</code></pre>`)
    return `\u0000BLOCK${blocks.length - 1}\u0000`
  })
  const lines = noBlocks.split('\n')
  const out: string[] = []
  let inList = false
  for (const raw of lines) {
    const line = raw.trimEnd()
    // brief 修正：捕获组 1 = # 数量、组 2 = 标题文本（原单组写法 m[2] 恒为 undefined，
    // 任何标题都会让 renderWikilinks 抛 TypeError，且层级误按文本长度计算）
    const m = line.match(/^(#{1,4})\s+(.*)$/)
    if (m) {
      if (inList) { out.push('</ul>'); inList = false }
      const level = Math.min(m[1].length, 4)
      const h = ['h1', 'h2', 'h3', 'h4'][level - 1] ?? 'h4'
      out.push(`<${h} style="margin:8px 0;color:#f3f4f6">${renderWikilinks(m[2] ?? '')}</${h}>`)
      continue
    }
    if (line.startsWith('- ')) {
      if (!inList) { out.push('<ul style="margin:4px 0;padding-left:20px">'); inList = true }
      out.push(`<li>${renderWikilinks(line.slice(2))}</li>`)
      continue
    }
    if (inList) { out.push('</ul>'); inList = false }
    if (line === '') { out.push('<div style="height:6px"></div>'); continue }
    const block = line.match(/^\u0000BLOCK(\d+)\u0000$/)
    if (block) { out.push(blocks[Number(block[1])]); continue }
    const inline = line.replace(/`([^`]+)`/g, (_mm, code: string) => `<code style="background:#1f2937;padding:1px 4px;border-radius:3px;font-size:12px">${code}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    out.push(`<p style="margin:4px 0;color:#d1d5db;line-height:1.6">${renderWikilinks(inline)}</p>`)
  }
  if (inList) out.push('</ul>')
  return out.join('\n')
}
