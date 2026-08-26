import { useEffect, useState } from 'react'
import { renderMarkdown } from './markdown.ts'

export function parseNotePath(path: string | undefined): { id: string; category: string } | null {
  if (!path) return null
  const idx = path.lastIndexOf('|')
  if (idx === -1) return null
  return { id: path.slice(0, idx), category: path.slice(idx + 1) }
}

export function NoteWorkbench({ path }: { path?: string }) {
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ref = parseNotePath(path)

  useEffect(() => {
    let cancelled = false
    if (!ref) { setContent(''); setTitle(''); return }
    setError(null)
    fetch(`/api/obsidian-wiki/page?id=${encodeURIComponent(ref.id)}&category=${encodeURIComponent(ref.category)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.error) setError(data.error)
        else { setTitle(data.page?.title ?? ref.id); setContent(renderMarkdown(data.page?.body ?? '')) }
      })
      .catch((e) => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [path])

  if (!ref) return <div style={{ padding: 24, color: '#9ca3af', textAlign: 'center' }}>从知识库选择一篇笔记</div>
  if (error) return <div style={{ padding: 16, color: '#f87171' }}>加载失败：{error}</div>

  return <div style={{ padding: '16px 24px', maxWidth: 860, margin: '0 auto' }}>
    <h1 style={{ margin: '0 0 8px', fontSize: 24, color: '#f3f4f6' }}>{title}</h1>
    <div style={{ marginBottom: 16, padding: '8px 12px', background: '#1f2937', borderRadius: 6, fontSize: 12, color: '#9ca3af' }}>
      {ref.category} · {ref.id}
    </div>
    <div dangerouslySetInnerHTML={{ __html: content }} />
  </div>
}
