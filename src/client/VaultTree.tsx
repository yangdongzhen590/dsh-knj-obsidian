import { useEffect, useState } from 'react'
import { fetchPages, type PageSummary } from './api.ts'
import { IconBook, IconChevronRight, IconFile, IconRefresh } from './icons.tsx'

const CATEGORY_LABELS: Record<string, string> = {
  concepts: '概念', entities: '实体', references: '参考', synthesis: '综合', projects: '项目',
}

/** confidence 圆点：extracted 实心强调色 / inferred 空心 / ambiguous 琥珀 */
const CONFIDENCE_DOT: Record<string, string> = {
  extracted: 'knj-dot--ok',
  inferred: 'knj-dot--muted',
  ambiguous: 'knj-dot--warn',
}

export function VaultTree({ onOpen }: { onOpen: (page: PageSummary) => void }) {
  const [pages, setPages] = useState<PageSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const load = () => fetchPages()
      .then((r) => { setPages(r.pages); setLoaded(true) })
      .catch((e) => { setError(String(e)); setLoaded(true) })
    load()
    // v5：笔记工作台保存成功后广播刷新
    window.addEventListener('wiki:pages-changed', load)
    return () => window.removeEventListener('wiki:pages-changed', load)
  }, [])

  if (error) return <div className="knj-error"><IconRefresh size={14} />加载失败：{error}</div>
  // 三态：加载中不闪空态引导
  if (!loaded) return <div className="knj-loading"><span className="knj-spinner"><IconRefresh size={14} /></span>加载中…</div>
  if (pages.length === 0) {
    return <div className="knj-empty">
      <span className="knj-empty__icon"><IconBook size={28} /></span>
      <div>知识库还是空的</div>
      <div>对 agent 说「把 XX 吸收进 wiki」开始沉淀。</div>
    </div>
  }

  const groups = new Map<string, PageSummary[]>()
  for (const p of pages) {
    const list = groups.get(p.category) ?? []
    list.push(p)
    groups.set(p.category, list)
  }

  return <div className="knj-tree">
    {[...groups.entries()].map(([cat, list]) => {
      return (
        <div key={cat} className="knj-tree__group">
          <div className="knj-tree__head">
            <span className="knj-tree__group-icon"><IconBook size={13} /></span>
            {CATEGORY_LABELS[cat] ?? cat}
            <span className="knj-tree__count">{list.length}</span>
          </div>
          {list.map((p) => (
            <div key={p.id} className="knj-tree__item" onClick={() => onOpen(p)} title={p.title}>
              <span className="knj-tree__item-icon"><IconFile size={13} /></span>
              <span className="knj-tree__item-title">{p.title}</span>
              <span className={`knj-dot ${CONFIDENCE_DOT[p.confidence] ?? 'knj-dot--muted'}`} title={`confidence: ${p.confidence}`} />
            </div>
          ))}
        </div>
      )
    })}
    <div className="knj-tree__hint">
      <IconChevronRight size={12} />点击笔记在右侧工作台打开
    </div>
  </div>
}
