import { useState } from 'react'
import { fetchSearch, type SearchCandidate } from './api.ts'
import { IconClose, IconSearch, IconRefresh } from './icons.tsx'

export function SearchBox({ onResult, root }: { onResult: (c: SearchCandidate[]) => void; root?: string }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  // v7：搜索失败与「无匹配」区分开（R-06），不再折叠成空结果
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    if (!q.trim()) return
    setBusy(true)
    setErr(null)
    try {
      // root：搜索钉在本会话工作区的库上（不带 root 时服务端退回全局当前库）
      const r = await fetchSearch(q, 'auto', root)
      onResult(r.candidates)
    } catch (e) {
      // 失败：提示错误，不切到「无匹配」结果视图；409 = 本工作区没有知识库
      const message = String(e)
      setErr(message.includes(': 409') ? '本工作区还没有知识库：点上方「初始化知识库」' : '搜索失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return <div className="knj-search" style={{ padding: '10px 12px 4px' }}>
    <span className="knj-search__icon"><IconSearch size={14} /></span>
    <input
      className="knj-input knj-search__input"
      value={q}
      onChange={(e) => { setQ(e.target.value); if (err) setErr(null) }}
      onKeyDown={(e) => { if (e.key === 'Enter') run() }}
      placeholder="搜索知识库…"
      spellCheck={false}
    />
    {busy && <span className="knj-search__spinner"><IconRefresh size={14} /></span>}
    {!busy && q && (
      <button type='button' className="knj-icon-btn knj-search__clear" title='清空' onClick={() => setQ('')}>
        <IconClose size={13} />
      </button>
    )}
    {err && <div className="knj-error" style={{ padding: '6px 4px 0' }}>{err}</div>}
  </div>
}
