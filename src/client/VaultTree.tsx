import { useEffect, useState } from 'react'
import { fetchPages, type PageSummary } from './api.ts'

const CATEGORY_LABELS: Record<string, string> = {
  concepts: '概念', entities: '实体', references: '参考', synthesis: '综合', projects: '项目',
}

export function VaultTree({ onOpen }: { onOpen: (page: PageSummary) => void }) {
  const [pages, setPages] = useState<PageSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchPages().then((r) => setPages(r.pages)).catch((e) => setError(String(e)))
  }, [])

  if (error) return <div style={{ color: '#f87171', fontSize: 12 }}>加载失败：{error}</div>
  if (pages.length === 0) {
    return <div style={{ padding: 16, fontSize: 13, color: '#9ca3af', textAlign: 'center' }}>
      知识库还是空的。<br />对 agent 说「把 XX 吸收进 wiki」开始。
    </div>
  }

  const groups = new Map<string, PageSummary[]>()
  for (const p of pages) {
    const list = groups.get(p.category) ?? []
    list.push(p)
    groups.set(p.category, list)
  }

  return <div style={{ fontSize: 13 }}>
    {[...groups.entries()].map(([cat, list]) => (
      <div key={cat}>
        <div style={{ padding: '6px 8px', fontWeight: 600, color: '#d1d5db', borderBottom: '1px solid #1f2937' }}>
          {CATEGORY_LABELS[cat] ?? cat}（{list.length}）
        </div>
        {list.map((p) => (
          <div key={p.id} onClick={() => onOpen(p)}
            style={{ padding: '4px 8px 4px 20px', cursor: 'pointer', color: '#e5e7eb' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#1f2937' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
            {p.title}
          </div>
        ))}
      </div>
    ))}
  </div>
}
