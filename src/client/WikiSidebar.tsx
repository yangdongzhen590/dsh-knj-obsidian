/**
 * 知识库边栏标签：顶部搜索 + lint 徽标，下方按 category 分组的 vault 树。
 * 搜索后切换为结果列表；图视图为 Task 5。
 */
import { useState } from 'react'
import { VaultTree } from './VaultTree.tsx'
import { SearchBox } from './SearchBox.tsx'
import { LintBadge } from './LintBadge.tsx'
import type { SearchCandidate } from './api.ts'

export function WikiSidebar() {
  const [results, setResults] = useState<SearchCandidate[] | null>(null)

  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <SearchBox onResult={setResults} />
    <LintBadge />
    {results !== null ? (
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ padding: '4px 8px', fontWeight: 600, color: '#d1d5db', fontSize: 12 }}>搜索结果（{results.length}）</div>
        {results.length === 0 && <div style={{ padding: 12, fontSize: 12, color: '#9ca3af' }}>无匹配</div>}
        {results.map((c) => (
          <div key={c.id} style={{ padding: '6px 8px', borderBottom: '1px solid #1f2937' }}>
            <div style={{ color: '#e5e7eb', fontSize: 13 }}>{c.title}</div>
            <div style={{ color: '#6b7280', fontSize: 11 }}>{c.category} · {c.confidence}</div>
            <div style={{ color: '#9ca3af', fontSize: 11, marginTop: 2 }}>{c.snippet}</div>
          </div>
        ))}
      </div>
    ) : (
      <div style={{ flex: 1, overflow: 'auto' }}>
        <VaultTree onOpen={() => {}} />
      </div>
    )}
  </div>
}
