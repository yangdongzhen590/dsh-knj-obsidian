/**
 * 知识库边栏标签（设计 v2，2026-10-24 会话级作用域）：
 * - 顶部：vault 头部（当前工作区的库身份 + 切换 + 新建/挂接/移除，v7）
 * - 搜索（图标输入框 + 加载态）
 * - 浏览/图谱分段切换；内容区随搜索结果 / 树 / 图谱切换
 * - 底部状态条（LintPanel）：页数 + 健康度；「问题」「工具」面板展开
 *
 * root = 当前会话所属工作区根。0.2 的 pane-tab seat 按会话渲染并注入
 * `sessionId` + `useSessions`；index.ts 的 SeatBoundWikiBody 用它们取到会话 cwd，
 * 这里再用 session-root.ts 的纯函数解析成工作区根，全树的数据请求都带上它。
 */
import { useEffect, useMemo, useState } from 'react'
import { VaultTree } from './VaultTree.tsx'
import { SearchBox } from './SearchBox.tsx'
import { LintPanel } from './LintPanel.tsx'
import { GraphView } from './GraphView.tsx'
import { KnowledgeDistillLauncher } from './KnowledgeDistillLauncher.tsx'
import { VaultHeader, type SessionFace, type WorkspaceFace } from './VaultHeader.tsx'
import { IconBook, IconClose, IconGraph, IconImport, IconSparkles } from './icons.tsx'
import { resolveSessionRoot } from './session-root.ts'
import type { SearchCandidate } from './api.ts'

export function WikiSidebar({ openNote, workspaces, sessions, startAgentSession, sessionId, sessionCwd, build }: {
  openNote: (id: string, category: string, title: string) => void
  workspaces?: WorkspaceFace
  sessions?: SessionFace
  /** v11：新建会话并预填指令（ok=false 时 message 为失败原因）；cwd 指定新会话所属工作区。 */
  startAgentSession?: (instruction: string, cwd?: string) => Promise<{ ok: boolean; message?: string }>
  /** 0.2 pane-tab seat 注入：本面板所属会话 id。 */
  sessionId?: string
  /** 该会话的 cwd（由 seat 的 useSessions 订阅，切换会话时实时变化）。 */
  sessionCwd?: string
  /** 客户端构建标记（面板底部显示）：用于人眼确认浏览器加载的是哪一次构建。 */
  build?: string
}) {
  const [results, setResults] = useState<SearchCandidate[] | null>(null)
  const [view, setView] = useState<'browse' | 'graph' | 'collect' | 'distill'>('browse')
  // v7：库切换时自增，强制图谱重挂载（取数当前库）
  const [vaultVersion, setVaultVersion] = useState(0)
  const [workspaceTick, setWorkspaceTick] = useState(0)

  // 工作区快照不是 React store 能直接订阅的 hook（只有 service.list.subscribe），
  // 这里退化成一次订阅 + tick：路径/归属变化时重新解析 root。
  useEffect(() => {
    if (!workspaces?.list?.subscribe) return
    return workspaces.list.subscribe(() => setWorkspaceTick((v) => v + 1))
  }, [workspaces])

  const workspaceItems = (() => {
    try { return workspaces?.list.getSnapshot()?.items ?? [] } catch { return [] }
  })()

  const root = useMemo(
    () => resolveSessionRoot({ sessionId, cwd: sessionCwd, workspaces: workspaceItems }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, sessionCwd, workspaceTick],
  )

  /** v7：库切换后清掉旧库的搜索结果、刷新树/lint、重挂载图谱。 */
  const handleVaultChanged = () => {
    setResults(null)
    setVaultVersion((v) => v + 1)
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('wiki:pages-changed'))
  }

  return <div className="knj-wiki knj-vcol">
    <VaultHeader root={root} workspaces={workspaces} startAgentSession={startAgentSession} onVaultChanged={handleVaultChanged} />
    <SearchBox onResult={setResults} root={root} />

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
          title='代码结构采集 / 近期会话蒸馏'
          onClick={() => setView('collect')}>
          <IconSparkles size={13} />知识蒸馏
        </button>
      </div>
    </div>

    {/* v12：图谱视图改成不滚动的 flex 宿主，画布才能吃到侧栏剩余高度；
        浏览/蒸馏仍用 knj-scroll（内容可滚动）。 */}
    <div className={view === 'graph' ? 'knj-grow knj-graph-host' : 'knj-grow knj-scroll'}>
      {view === 'graph' ? (
        // key=vaultVersion+root：库/工作区切换后强制重挂载，避免展示旧库图谱
        <div key={`${vaultVersion}:${root ?? ''}`}><GraphView onOpenNote={openNote} root={root} /></div>
      ) : view === 'collect' ? (
        <KnowledgeDistillLauncher startAgentSession={startAgentSession} sessions={sessions as never}
          workspaces={workspaces as never} root={root} />
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
      ) : root === undefined ? (
        <div className="knj-empty">
          <span className="knj-empty__icon"><IconBook size={26} /></span>
          <div>宿主没有提供会话上下文</div>
          <div>无法判断本工作区该用哪个知识库；可在上方下拉里手动选择。</div>
        </div>
      ) : (
        <VaultTree onOpen={(p) => openNote(p.id, p.category, p.title)} root={root} />
      )}
    </div>

    <LintPanel openNote={openNote} root={root} />
    {/* 构建标记：出现「新建会话并预填」的诡异失败时，先靠它确认浏览器跑的是哪一版。 */}
    <div className="knj-pop__hint" style={{ padding: '0 12px 8px', opacity: 0.65 }}
      title="客户端构建标记（确认浏览器加载了哪一次构建）">
      dsh-knj-obsidian v{build ?? 'dev'}
    </div>
  </div>
}
