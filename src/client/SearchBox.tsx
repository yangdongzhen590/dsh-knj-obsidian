import { useState } from 'react'
import { fetchSearch, type SearchCandidate } from './api.ts'

export function SearchBox({ onResult }: { onResult: (c: SearchCandidate[]) => void }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!q.trim()) return
    setBusy(true)
    try {
      const r = await fetchSearch(q)
      onResult(r.candidates)
    } catch {
      // 搜索失败：降级为空结果，避免未处理拒绝与静默失败
      onResult([])
    } finally {
      setBusy(false)
    }
  }

  return <div style={{ display: 'flex', gap: 6, padding: 8 }}>
    <input value={q} onChange={(e) => setQ(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') run() }}
      placeholder="搜索知识库…"
      style={{ flex: 1, background: '#1f2937', border: '1px solid #374151', color: '#e5e7eb', borderRadius: 6, padding: '5px 8px', fontSize: 13 }} />
    <button onClick={run} disabled={busy}
      style={{ background: '#3b82f6', border: 'none', color: '#fff', borderRadius: 6, padding: '5px 10px', fontSize: 13, cursor: 'pointer' }}>
      {busy ? '…' : '搜'}
    </button>
  </div>
}
