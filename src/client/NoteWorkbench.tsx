/**
 * v5 笔记工作台（设计 v2）：历史栈导航 + wikilink 原地跳转 + 断链提示。
 * tab.path 种子（id|category）仍是入口；站内导航不再开新标签。
 */
import { useCallback, useEffect, useState } from 'react'
import { NoteView, type NoteRef } from './NoteView.tsx'
import { fetchPages } from './api.ts'
import { IconBack } from './icons.tsx'

export function parseNotePath(path: string | undefined): { id: string; category: string } | null {
  if (!path) return null
  const idx = path.lastIndexOf('|')
  if (idx === -1) return null
  return { id: path.slice(0, idx), category: path.slice(idx + 1) }
}

/** id → category 索引（wikilink 只带 id，解析落点用） */
type Index = Map<string, { category: string; title: string }>

export function NoteWorkbench({ path, onPagesChanged }: { path?: string; onPagesChanged?: () => void }) {
  const [index, setIndex] = useState<Index>(new Map())
  const [stack, setStack] = useState<NoteRef[]>([])
  const [brokenLink, setBrokenLink] = useState<string | null>(null)
  const seed = parseNotePath(path)

  // 启动拉一次索引
  useEffect(() => {
    let cancelled = false
    fetchPages()
      .then(({ pages }) => {
        if (cancelled) return
        const m: Index = new Map()
        for (const p of pages) m.set(p.id, { category: p.category, title: p.title })
        setIndex(m)
      })
      .catch(() => { /* 索引失败时 wikilink 全部按断链处理 */ })
    return () => { cancelled = true }
  }, [])

  // 种子页变化（边栏打开另一篇）→ 重置栈
  useEffect(() => {
    if (!seed) { setStack([]); setBrokenLink(null); return }
    setStack([{ id: seed.id, category: seed.category, title: seed.id }])
    setBrokenLink(null)
  }, [seed?.id, seed?.category])

  // 压栈时用索引标题回填
  useEffect(() => {
    if (!stack.length) return
    const top = stack[stack.length - 1]
    const meta = index.get(top.id)
    if (meta && meta.title !== top.title) {
      setStack((s) => s.map((n, i) => (i === s.length - 1 ? { ...n, title: meta.title } : n)))
    }
  }, [index, stack])

  const current = stack.length ? stack[stack.length - 1] : null

  const navigate = useCallback((id: string) => {
    const meta = index.get(id)
    if (!meta) { setBrokenLink(id); return }
    setBrokenLink(null)
    setStack((s) => [...s, { id, category: meta.category, title: meta.title }])
  }, [index])

  const back = useCallback(() => {
    setBrokenLink(null)
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
  }, [])

  // 保存成功后刷新索引（title 可能改了），并同步边栏
  const handleSaved = useCallback(() => {
    fetchPages()
      .then(({ pages }) => {
        const m: Index = new Map()
        for (const p of pages) m.set(p.id, { category: p.category, title: p.title })
        setIndex(m)
        setStack((s) => s.map((n) => {
          const meta = m.get(n.id)
          return meta ? { ...n, title: meta.title } : n
        }))
      })
      .catch(() => { /* 刷新失败不影响已保存状态 */ })
    onPagesChanged?.()
  }, [onPagesChanged])

  if (!current) return (
    // 注意：.knj-wiki 必须是 .knj-empty 的祖先（styles.ts 用后代选择器 .knj-wiki .knj-empty），
    // 不能把两个类放同一元素上，否则 flex 居中规则不生效（v8 验证抓到的回归）。
    <div className="knj-wiki" style={{ height: '100%' }}>
      <div className="knj-empty" style={{ height: '100%' }}>从知识库选择一篇笔记</div>
    </div>
  )

  // 根容器 = 滚动容器（knj-wb-scroll，见 styles.ts）：笔记 tab 渲染在右侧面板
  // paneContent（overflow:hidden）内，没有宿主主区域滚动容器可依赖（v11 修正 v8 假设）。
  return <div className="knj-wiki knj-wb-scroll">
    <div style={{ padding: '14px 28px 0', maxWidth: 880, margin: '0 auto' }}>
      {stack.length > 1 && (
        <button type='button' className="knj-btn knj-btn--sm knj-wb__back" onClick={back}>
          <IconBack size={13} />返回（{stack.length - 1}）
        </button>
      )}
    </div>
    <NoteView note={current} brokenLink={brokenLink} onNavigate={navigate} onSaved={handleSaved} />
  </div>
}
