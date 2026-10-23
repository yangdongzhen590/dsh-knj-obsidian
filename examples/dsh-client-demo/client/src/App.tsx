import { useCallback, useEffect, useState } from 'react'

interface WikiPage {
  category: string
  id: string
  title: string
}

interface PagesResponse {
  root: string
  count: number
  pages: WikiPage[]
  error?: string
}

const CATEGORY_COLORS: Record<string, string> = {
  concepts: '#2563eb',
  entities: '#0891b2',
  references: '#7c3aed',
  synthesis: '#db2777',
  projects: '#ea580c',
  dictionaries: '#16a34a',
  tables: '#64748b',
}

export default function App() {
  const [data, setData] = useState<PagesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/client-demo/pages')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 880, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22 }}>DSH client demo</h1>
      <p style={{ color: '#64748b' }}>
        这个页面由 <code>dsh-client-demo</code> 插件伺服（路由 <code>/client-demo</code>），
        数据来自插件注册的 <code>/api/client-demo/pages</code> —— 读取 dsh-knj-obsidian 知识库的真实页面清单。
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
        <button onClick={() => void load()} disabled={loading}>
          {loading ? '加载中…' : '刷新'}
        </button>
        {data && (
          <span>
            共 <strong>{data.count}</strong> 页 · 库根 <code style={{ fontSize: 12 }}>{data.root}</code>
          </span>
        )}
      </div>

      {error && (
        <p style={{ color: '#dc2626' }}>加载失败：{error}（插件是否已安装且 dsh web 已重启？）</p>
      )}
      {data?.error && <p style={{ color: '#dc2626' }}>插件侧读库失败：{data.error}</p>}

      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
        {(data?.pages ?? []).map((p) => (
          <li
            key={`${p.category}/${p.id}`}
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '10px 14px',
              display: 'flex',
              gap: 12,
              alignItems: 'baseline',
            }}
          >
            <span
              style={{
                color: '#fff',
                background: CATEGORY_COLORS[p.category] ?? '#94a3b8',
                borderRadius: 999,
                fontSize: 11,
                padding: '2px 10px',
                whiteSpace: 'nowrap',
              }}
            >
              {p.category}
            </span>
            <span style={{ fontWeight: 600 }}>{p.title}</span>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>{p.id}.md</span>
          </li>
        ))}
      </ul>

      {!loading && data && data.count === 0 && <p>库里没有页面（或库根配置不对）。</p>}
    </main>
  )
}
