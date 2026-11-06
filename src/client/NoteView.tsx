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

/** 服务端 404 文案（页面不存在）：面板没有「新建页」入口，空白编辑器不能当新建用。 */
const MISSING_PAGE_RE = /页面不存在|page not found/i

export function NoteView({
  note,
  brokenLink,
  onNavigate,
  onSaved,
  root,
}: {
  note: NoteRef
  brokenLink: string | null
  onNavigate: (id: string) => void
  onSaved?: () => void
  /** 该会话工作区根：读页/存页都钉在这个库上（undefined 时退回全局当前库）。 */
  root?: string
}) {
  const [mode, setMode] = useState<Mode>('preview')
  const [content, setContent] = useState('')
  const [raw, setRaw] = useState('')
  const [dirty, setDirty] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** 目标页在磁盘上不存在：置灰编辑器，避免把 404 误当「新建」。 */
  const [missing, setMissing] = useState(false)

  const pageUrl = () => {
    const scope = root ? `&root=${encodeURIComponent(root)}` : ''
    return `/api/obsidian-wiki/page?id=${encodeURIComponent(note.id)}&category=${encodeURIComponent(note.category)}${scope}`
  }

  useEffect(() => {
    let cancelled = false
    setError(null); setNotice(null); setMissing(false)
    setDirty(false); setMode('preview')
    fetch(pageUrl())
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.error) setError(data.error)
        else setContent(renderMarkdown(data.page?.body ?? ''))
      })
      .catch((e) => { if (!cancelled) setError(String(e)) })
    fetchRawPage(note.id, note.category, root)
      .then((r) => { if (!cancelled) setRaw(r) })
      .catch((e) => {
        // 页面不存在时源码态会渲染成一块空白编辑器（看起来像“新建”）；标出来并置灰，
        // 保存按钮随之禁用，提示改走 wiki_ingest / wiki_capture 新建。
        if (!cancelled && MISSING_PAGE_RE.test(String(e))) setMissing(true)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, note.category, root])

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
    if (missing) return
    setSaving(true); setError(null); setNotice(null)
    try {
      await saveRawPage(note.id, note.category, raw, root)
      setDirty(false)
      setNotice('已保存')
      const res = await fetch(pageUrl())
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
          disabled={!dirty || saving || missing} onClick={save}>
          {saving ? '保存中…' : dirty ? '保存' : '已保存'}
        </button>
      </>}
    </div>

    {brokenLink && <div className="knj-banner knj-banner--warn" style={{ marginBottom: 10 }}>
      <IconWarning size={14} />断链：页面「{brokenLink}」不存在
    </div>}
    {missing && <div className="knj-banner knj-banner--warn" style={{ marginBottom: 10 }}>
      <IconWarning size={14} />页面不存在，不能在此新建（编辑器已锁定）。请让 Agent 用 wiki_ingest / wiki_capture 创建页面。
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
          readOnly={missing}
          onChange={(e) => { setRaw(e.target.value); setDirty(true) }}
          spellCheck={false}
          placeholder='# 标题&#10;&#10;正文…（含 frontmatter 整份编辑）'
        />}
    {mode === 'source' && !dirty && !missing && (
      <div className="knj-banner knj-banner--info" style={{ marginTop: 10 }}>
        <IconInfo size={14} />源码态展示磁盘原文，可直接编辑并保存（id / category 与路径不符会被服务端拒绝）。
      </div>
    )}
  </div>
}
