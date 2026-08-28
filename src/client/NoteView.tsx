/**
 * v5 笔记视图（设计 v2）：预览 / 源码双态。
 * - 预览：富 markdown 渲染（renderMarkdown），wikilink 点击经事件委托上抛 onNavigate
 * - 源码：磁盘原文（含 frontmatter）可编辑 + 复制 + 保存（错误就地展示）
 * 断链提示由父级（持有页面索引的 NoteWorkbench）判定后经 brokenLink prop 下传。
 */
import { useEffect, useState } from 'react'
import { renderMarkdown } from './markdown.ts'
import { fetchRawPage, saveRawPage } from './api.ts'
import { IconCheck, IconCopy, IconInfo, IconWarning } from './icons.tsx'

export interface NoteRef {
  id: string
  category: string
  title: string
}

type Mode = 'preview' | 'source'

export function NoteView({
  note,
  brokenLink,
  onNavigate,
  onSaved,
}: {
  note: NoteRef
  brokenLink: string | null
  onNavigate: (id: string) => void
  onSaved?: () => void
}) {
  const [mode, setMode] = useState<Mode>('preview')
  const [content, setContent] = useState('')
  const [raw, setRaw] = useState('')
  const [dirty, setDirty] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null); setNotice(null)
    setDirty(false); setMode('preview')
    fetch(`/api/obsidian-wiki/page?id=${encodeURIComponent(note.id)}&category=${encodeURIComponent(note.category)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.error) setError(data.error)
        else setContent(renderMarkdown(data.page?.body ?? ''))
      })
      .catch((e) => { if (!cancelled) setError(String(e)) })
    fetchRawPage(note.id, note.category)
      .then((r) => { if (!cancelled) setRaw(r) })
      .catch(() => { /* 源码拉取失败不打断预览；进入源码态保存时会再报 */ })
    return () => { cancelled = true }
  }, [note.id, note.category])

  // wikilink 事件委托：容器级点击监听（渲染 HTML 中的 <a data-wikilink>）
  const onContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('a[data-wikilink]')
    if (!target) return
    e.preventDefault()
    const id = target.getAttribute('data-wikilink') ?? ''
    if (id) onNavigate(id)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setNotice('复制失败：浏览器剪贴板不可用')
    }
  }

  const save = async () => {
    setSaving(true); setError(null); setNotice(null)
    try {
      await saveRawPage(note.id, note.category, raw)
      setDirty(false)
      setNotice('已保存')
      const res = await fetch(`/api/obsidian-wiki/page?id=${encodeURIComponent(note.id)}&category=${encodeURIComponent(note.category)}`)
      const data = await res.json()
      if (!data.error) setContent(renderMarkdown(data.page?.body ?? ''))
      // 广播刷新（边栏树/lint 徽标监听）
      window.dispatchEvent(new CustomEvent('wiki:pages-changed'))
      onSaved?.()
    } catch (e) {
      setError(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return <div className="knj-wb">
    <h1 className="knj-wb__title">{note.title}</h1>
    <div className="knj-wb__meta">
      <span className={`knj-chip knj-chip--${note.category}`}>{note.category}</span>
      <span>{note.id}</span>
    </div>

    <div className="knj-wb__actions">
      <div className="knj-seg">
        <button type='button' className={`knj-seg__item${mode === 'preview' ? ' knj-seg__item--active' : ''}`} onClick={() => setMode('preview')}>预览</button>
        <button type='button' className={`knj-seg__item${mode === 'source' ? ' knj-seg__item--active' : ''}`} onClick={() => setMode('source')}>源码</button>
      </div>
      {mode === 'source' && <>
        <button type='button' className="knj-btn" onClick={copy}>
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}{copied ? '已复制' : '复制'}
        </button>
        <button type='button' className={`knj-btn ${dirty ? 'knj-btn--primary' : 'knj-btn--subtle'}`}
          disabled={!dirty || saving} onClick={save}>
          {saving ? '保存中…' : dirty ? '保存' : '已保存'}
        </button>
      </>}
    </div>

    {brokenLink && <div className="knj-banner knj-banner--warn" style={{ marginBottom: 10 }}>
      <IconWarning size={14} />断链：页面「{brokenLink}」不存在
    </div>}
    {notice && <div className="knj-banner knj-banner--ok" style={{ marginBottom: 10 }}>
      <IconCheck size={14} />{notice}
    </div>}
    {error && <div className="knj-banner knj-banner--err" style={{ marginBottom: 10 }}>
      <IconWarning size={14} />{error}
    </div>}

    {mode === 'preview'
      ? <div className='wiki-md-content' onClick={onContentClick} dangerouslySetInnerHTML={{ __html: content }} />
      : <textarea
          className="knj-wb__editor"
          value={raw}
          onChange={(e) => { setRaw(e.target.value); setDirty(true) }}
          spellCheck={false}
          placeholder='# 标题&#10;&#10;正文…（含 frontmatter 整份编辑）'
        />}
    {mode === 'source' && !dirty && (
      <div className="knj-banner knj-banner--info" style={{ marginTop: 10 }}>
        <IconInfo size={14} />源码态展示磁盘原文，可直接编辑并保存（id / category 与路径不符会被服务端拒绝）。
      </div>
    )}
  </div>
}
