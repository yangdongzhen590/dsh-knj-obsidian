/**
 * 笔记视图：接收选中的笔记引用（id/category/title），
 * 拉取 /api/obsidian-wiki/page 并渲染标题 + category/id 信息 + markdown 正文。
 *
 * 安全说明：dangerouslySetInnerHTML 的输入是 renderMarkdown() 的输出——该函数
 * 先完整转义所有用户内容（escapeHtml），再把 [[wikilink]] 转成白名单化链接
 * （href 固定为 '#' + data 属性，无 javascript: 注入面）。
 * 这是"先转义后白名单"的安全模式，markdown.test.mjs 覆盖转义。
 */
import { useEffect, useState } from 'react'
import { renderMarkdown } from './markdown.ts'

export interface NoteRef {
  id: string
  category: string
  title: string
}

export function NoteView({ note }: { note: NoteRef | null }) {
  const [content, setContent] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!note) { setContent(''); return }
    setError(null)
    fetch(`/api/obsidian-wiki/page?id=${encodeURIComponent(note.id)}&category=${encodeURIComponent(note.category)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error)
        else setContent(renderMarkdown(data.page.body ?? ''))
      })
      .catch((e) => setError(String(e)))
  }, [note])

  if (!note) return <div style={{ padding: 24, color: '#9ca3af', textAlign: 'center' }}>从左侧选择一篇笔记查看</div>
  if (error) return <div style={{ padding: 16, color: '#f87171' }}>加载失败：{error}</div>

  return <div style={{ padding: '12px 16px', maxWidth: 800, margin: '0 auto' }}>
    <h1 style={{ margin: '0 0 8px', fontSize: 22, color: '#f3f4f6' }}>{note.title}</h1>
    <div style={{ marginBottom: 16, padding: '8px 12px', background: '#1f2937', borderRadius: 6, fontSize: 12, color: '#9ca3af' }}>
      {note.category} · {note.id}
    </div>
    <div dangerouslySetInnerHTML={{ __html: content }} />
  </div>
}
