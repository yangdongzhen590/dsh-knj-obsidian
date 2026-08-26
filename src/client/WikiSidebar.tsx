/**
 * 知识库边栏标签（A3 混合形态入口）：顶部搜索 + lint 徽标，浏览/图谱切换。
 * 浏览 = 按 category 分组的 vault 树（或搜索结果，可返回）；图谱 = 交互图谱。
 * 点击笔记/图谱节点 → openNote（由 index.ts 注入 openTab 到主区域工作台标签）。
 */
import { useState } from 'react'
import { VaultTree } from './VaultTree.tsx'
import { SearchBox } from './SearchBox.tsx'
import { LintBadge } from './LintBadge.tsx'
import { GraphView } from './GraphView.tsx'
import type { SearchCandidate } from './api.ts'

export function WikiSidebar({ openNote }: { openNote: (id: string, category: string, title: string) => void }) {
  const [results, setResults] = useState<SearchCandidate[] | null>(null)
  const [view, setView] = useState<'browse' | 'graph'>('browse')

  const tabStyle = (active: boolean) => ({
    padding: '6px 12px', cursor: 'pointer', fontSize: 13,
    color: active ? '#3b82f6' : '#9ca3af',
    borderBottom: active ? '2px solid #3b82f6' : 'none',
  })

  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <SearchBox onResult={setResults} />
    <LintBadge />
    <div style={{ display: 'flex', borderBottom: '1px solid #1f2937' }}>
      <div onClick={() => setView('browse')} style={tabStyle(view === 'browse')}>浏览</div>
      <div onClick={() => setView('graph')} style={tabStyle(view === 'graph')}>图谱</div>
    </div>
    {view === 'graph' ? (
      <div style={{ flex: 1, overflow: 'auto' }}><GraphView onOpenNote={openNote} /></div>
    ) : results !== null ? (
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, color: '#d1d5db', fontSize: 12 }}>搜索结果（{results.length}）</span>
          <button onClick={() => setResults(null)} style={{ background: 'transparent', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 12 }}>← 返回</button>
        </div>
        {results.length === 0 && <div style={{ padding: 12, fontSize: 12, color: '#9ca3af' }}>无匹配</div>}
        {results.map((c) => (
          <div key={c.id} onClick={() => openNote(c.id, c.category, c.title)}
            style={{ padding: '6px 8px', borderBottom: '1px solid #1f2937', cursor: 'pointer' }}>
            <div style={{ color: '#e5e7eb', fontSize: 13 }}>{c.title}</div>
            <div style={{ color: '#6b7280', fontSize: 11 }}>{c.category} · {c.confidence}</div>
            <div style={{ color: '#9ca3af', fontSize: 11, marginTop: 2 }}>{c.snippet}</div>
          </div>
        ))}
      </div>
    ) : (
      <div style={{ flex: 1, overflow: 'auto' }}>
        <VaultTree onOpen={(p) => openNote(p.id, p.category, p.title)} />
      </div>
    )}
  </div>
}
