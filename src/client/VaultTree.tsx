/** 浏览视图 = 文件浏览器（Obsidian 式）：7 个知识分类目录可层层展开/收起。 */
import { useEffect, useState } from 'react'
import { fetchPages, type PageSummary } from './api.ts'
import { IconBook, IconChevronRight, IconFile, IconFolder, IconRefresh } from './icons.tsx'

const CATEGORY_LABELS: Record<string, string> = {
  concepts: '概念', entities: '实体', dictionaries: '字典', tables: '数据结构',
  references: '参考资料', synthesis: '综合', projects: '项目知识',
}
/** 目录展示顺序：与 index.md 的 SECTION_TITLES 一致 */
const CATEGORY_ORDER = ['concepts', 'entities', 'dictionaries', 'tables', 'references', 'synthesis', 'projects']

const CONFIDENCE_DOT: Record<string, string> = {
  extracted: 'knj-dot--ok',
  inferred: 'knj-dot--muted',
  ambiguous: 'knj-dot--warn',
}

export function VaultTree({ onOpen }: { onOpen: (page: PageSummary) => void }) {
  const [pages, setPages] = useState<PageSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean> | null>(null)

  useEffect(() => {
    const load = () => fetchPages()
      .then((r) => {
        setPages(r.pages)
        setLoaded(true)
        setExpanded((prev) => prev ?? initialExpanded(r.pages))
      })
      .catch((e) => { setError(String(e)); setLoaded(true) })
    load()
    window.addEventListener('wiki:pages-changed', load)
    return () => window.removeEventListener('wiki:pages-changed', load)
  }, [])

  const toggle = (cat: string) => {
    setExpanded((prev) => ({ ...(prev ?? {}), [cat]: !(prev?.[cat] ?? false) }))
  }

  if (error) return <div className="knj-error"><IconRefresh size={14} />加载失败：{error}</div>
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
  for (const list of groups.values()) list.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))

  return <div className="knj-tree">
    {CATEGORY_ORDER.map((cat) => {
      const list = groups.get(cat)
      const count = list?.length ?? 0
      const open = expanded?.[cat] ?? count > 0
      return (
        <div key={cat}>
          <div
            className={`knj-tree__dir${open ? ' knj-tree__dir--open' : ''}`}
            onClick={() => toggle(cat)}
            title={count > 0 ? `展开/收起 ${CATEGORY_LABELS[cat] ?? cat}` : `${CATEGORY_LABELS[cat] ?? cat}（暂无页面）`}
          >
            <span className="knj-tree__chev"><IconChevronRight size={13} /></span>
            <span className={`knj-tree__dir-icon knj-tree__dir-icon--${cat}`}><IconFolder size={14} /></span>
            <span className="knj-tree__dir-name">{CATEGORY_LABELS[cat] ?? cat}</span>
            <span className="knj-tree__count">{count}</span>
          </div>
          {open && (
            <div className="knj-tree__children">
              {count === 0 ? (
                <div className="knj-tree__empty">（暂无页面）</div>
              ) : (
                list!.map((p) => (
                  <div key={p.id} className="knj-tree__item" onClick={() => onOpen(p)} title={p.title}>
                    <span className="knj-tree__item-icon"><IconFile size={13} /></span>
                    <span className="knj-tree__item-title">{p.title}</span>
                    <span className={`knj-dot ${CONFIDENCE_DOT[p.confidence] ?? 'knj-dot--muted'}`} title={`confidence: ${p.confidence}`} />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )
    })}
    <div className="knj-tree__hint">
      <IconChevronRight size={12} />点击目录展开/收起 · 点击页在右侧打开
    </div>
  </div>
}

function initialExpanded(pages: PageSummary[]): Record<string, boolean> {
  const nonEmpty = new Set(pages.map((p) => p.category))
  const out: Record<string, boolean> = {}
  for (const cat of CATEGORY_ORDER) out[cat] = nonEmpty.has(cat)
  return out
}

