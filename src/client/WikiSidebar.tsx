/**
 * 知识库边栏标签（设计 v2）：
 * - 顶部：vault 头部（当前库身份 + 切换 + 新建/挂接/移除，v7）
 * - 搜索（图标输入框 + 加载态）
 * - 浏览/图谱分段切换；内容区随搜索结果 / 树 / 图谱切换
 * - 底部状态条（LintPanel）：页数 + 健康度；「问题」「工具」面板展开
 */
import { useState } from 'react'
import { VaultTree } from './VaultTree.tsx'
import { SearchBox } from './SearchBox.tsx'
import { LintPanel } from './LintPanel.tsx'
import { GraphView } from './GraphView.tsx'
import { CodeCollectLauncher } from './CodeCollectLauncher.tsx'
import { VaultHeader, type SessionFace, type WorkspaceFace } from './VaultHeader.tsx'
import { IconBook, IconClose, IconGraph, IconImport } from './icons.tsx'
import type { SearchCandidate } from './api.ts'

export function WikiSidebar({ openNote, workspaces, sessions, sendToAgent }: {
  openNote: (id: string, category: string, title: string) => void
  workspaces?: WorkspaceFace
  sessions?: SessionFace
  /** v9：预填当前对话输入框。返回 ''=成功，非空=失败原因（UI 显示并退回复制）。 */
  sendToAgent?: (instruction: string) => string
}) {
  const [results, setResults] = useState<SearchCandidate[] | null>(null)
  const [view, setView] = useState<'browse' | 'graph' | 'collect'>('browse')
  // v7：库切换时自增，强制图谱重挂载（取数当前库）
  const [vaultVersion, setVaultVersion] = useState(0)

  /** v7：库切换后清掉旧库的搜索结果、刷新树/lint、重挂载图谱。 */
  const handleVaultChanged = () => {
    setResults(null)
    setVaultVersion((v) => v + 1)
    window.dispatchEvent(new CustomEvent('wiki:pages-changed'))
  }

  return <div className="knj-wiki knj-vcol">
    <VaultHeader workspaces={workspaces} sessions={sessions} onVaultChanged={handleVaultChanged} />
    <SearchBox onResult={setResults} />

    <div style={{ padding: '8px 12px 4px' }}>
      <div className="knj-seg">
        <button type='button' className={`knj-seg__item${view === 'browse' ? ' knj-seg__item--active' : ''}`}
          onClick={() => setView('browse')}>
          <IconBook size={13} />浏览
        </button>
        <button type='button' className={`knj-seg__item${view === 'graph' ? ' knj-seg__item--active' : ''}`}
          onClick={() => setView('graph')}>
          <IconGraph size={13} />图谱
        </button>
        <button type='button' className={`knj-seg__item${view === 'collect' ? ' knj-seg__item--active' : ''}`}
          onClick={() => setView('collect')}>
          <IconImport size={13} />代码采集
        </button>
      </div>
    </div>

    <div className="knj-grow knj-scroll">
      {view === 'graph' ? (
        // key=vaultVersion：库切换后强制重挂载，避免展示旧库图谱
        <div key={vaultVersion}><GraphView onOpenNote={openNote} /></div>
      ) : view === 'collect' ? (
        <CodeCollectLauncher sendToAgent={sendToAgent} />
      ) : results !== null ? (
        <div className="knj-vcol">
          <div className="knj-result-head">
            <span className="knj-result-title">搜索结果（{results.length}）</span>
            <span className="knj-statusbar__spacer" />
            <button type='button' className="knj-icon-btn" title='返回浏览' onClick={() => setResults(null)}>
              <IconClose size={14} />
            </button>
          </div>
          {results.length === 0 && <div className="knj-empty">
            <span className="knj-empty__icon"><IconBook size={26} /></span>
            <div>没有匹配的笔记</div>
            <div>换个关键词试试，或对 agent 说「把 XX 吸收进 wiki」。</div>
          </div>}
          {results.map((c) => (
            <div key={c.id} className="knj-result-item" onClick={() => openNote(c.id, c.category, c.title)}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--knj-text)' }}>{c.title}</div>
              <div className="knj-result-item__meta">
                <span className={`knj-chip knj-chip--${c.category}`}>{c.category}</span>
                <span>{c.confidence}</span>
              </div>
              <div className="knj-result-item__snippet">{c.snippet}</div>
            </div>
          ))}
        </div>
      ) : (
        <VaultTree onOpen={(p) => openNote(p.id, p.category, p.title)} />
      )}
    </div>

    <LintPanel openNote={openNote} />
  </div>
}
