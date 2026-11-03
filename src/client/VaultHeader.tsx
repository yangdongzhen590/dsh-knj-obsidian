/**
 * v7 vault 头部（设计 v2）：当前库身份（名称+路径）、切换下拉、新建/挂接/移除。
 * - 挂载时按当前工作区激活库（跟随工作区走；无 workspaces 服务时降级为手动切换）
 * - 切换/变更后回调 onVaultChanged，由上层刷新树/lint/图谱
 * 样式全部走宿主令牌（styles.ts），随宿主浅/深主题自适应。
 */
import { useEffect, useRef, useState } from 'react'
import { activateVault, attachVault, fetchVaults, removeVault, switchVault } from './api.ts'
import type { VaultInfo, VaultListEntry } from './api.ts'
import { IconBook, IconChevronDown, IconGear, IconPlus, IconRefresh, IconTrash } from './icons.tsx'
import { copyToClipboard } from './clipboard.ts'

/** 客户端工作区服务的最小结构面（宿主 dsh-client-runtime 提供；缺失时仅手动切换）。 */
export interface WorkspaceFace {
  list: {
    getSnapshot(): { items: readonly WorkspaceView[]; recentWorkspaceId?: string; baselinesReady?: boolean; state?: string; phase?: string }
    subscribe(cb: () => void): () => void
  }
  pickDirectory?(): Promise<string | null>
  /** 注册已存在的路径为工作区（幂等：已注册则解析回同一工作区）；v12 用于把库根落成工作区。 */
  create?(input: { path: string }): Promise<{ id: string; title?: string; path?: string }>
}

/** 客户端会话服务的最小结构面（宿主 dsh-client-runtime 提供）：读「当前选中会话」及其 cwd。 */
export interface SessionFace {
  list: {
    getSnapshot(): { current?: string; byId?: Record<string, { cwd?: string }> }
    subscribe(cb: () => void): () => void
  }
}

interface WorkspaceView {
  /** 宿主 dsh-api-workspace-controller 的 WorkspaceView 字段名是 workspaceId（历史/旧版可能是 id）。 */
  workspaceId?: string
  id?: string
  title?: string
  path?: string
  sessionIds?: readonly string[]
}

/** 取工作区 id：兼容 workspaceId（现行契约）与 id（旧版/窄化面）。 */
function workspaceIdOf(w: WorkspaceView | undefined): string | undefined {
  return w?.workspaceId ?? w?.id
}

const SOURCE_LABEL: Record<string, string> = { cwd: '默认', workspace: '工作区', attached: '挂接' }

export function VaultHeader({ workspaces, sessions, startAgentSession, onVaultChanged }: {
  workspaces?: WorkspaceFace
  sessions?: SessionFace
  /** v11：新建会话并预填指令（ok=false 时 message 为失败原因）；用于「初始化知识库」触发 agent。 */
  startAgentSession?: (instruction: string, cwd?: string) => Promise<{ ok: boolean; message?: string }>
  onVaultChanged: () => void
}) {
  const [current, setCurrent] = useState<VaultInfo | null>(null)
  const [vaults, setVaults] = useState<VaultListEntry[]>([])
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [formPath, setFormPath] = useState('')
  const [formName, setFormName] = useState('')
  const [busy, setBusy] = useState(false)
  // 已激活过的工作区目录（避免重复激活打转）
  const activatedRootRef = useRef<string | null>(null)

  const flash = (text: string, kind: 'ok' | 'err' = 'ok') => {
    setNotice({ text, kind })
    setTimeout(() => setNotice(null), 5000)
  }

  const load = async () => {
    try {
      const r = await fetchVaults()
      setCurrent(r.current)
      setVaults(r.vaults)
    } catch (e) {
      flash(`库列表加载失败：${e instanceof Error ? e.message : String(e)}`, 'err')
    }
  }

  // 初始加载 + 跟随「当前会话」所属工作区（会话归属 → 会话 cwd → recent 兜底）
  useEffect(() => {
    load()
    if (!workspaces) return
    let disposed = false
    // 轮询读快照（绕过 subscribe 是否触发的变量），每 2s 重估一次跟随目标
    const step = () => {
      try {
        const wsSnap = workspaces.list.getSnapshot()
        let ssSnap: { current?: string; byId?: Record<string, { cwd?: string }>; phase?: string; state?: string } | undefined
        try { ssSnap = sessions?.list.getSnapshot() } catch { ssSnap = undefined }
        if (disposed) return
        // 门禁放宽：ws 基线 ready 即跟随（不等 sessions.phase=ready——新版其语义/时序存疑）
        const wsUsable = wsSnap.baselinesReady || wsSnap.phase === 'ready'
        if (!wsUsable) return
        // 跟随目标 = 当前选中会话所属的工作区目录（不用 recent：它按会话更新时间投影，可能与浏览中的会话不一致）
        let targetRoot: string | undefined
        const currentId = ssSnap?.current
        if (currentId) {
          const owning = (wsSnap.items ?? []).find((w) => w.sessionIds?.includes(currentId))
          if (owning?.path) {
            targetRoot = owning.path
          } else {
            const cwd = ssSnap?.byId?.[currentId]?.cwd
            if (cwd) targetRoot = cwd
          }
        }
        targetRoot ??= ((wsSnap.items ?? []).find((w) => workspaceIdOf(w) === wsSnap.recentWorkspaceId) ?? wsSnap.items?.[0])?.path
        if (!targetRoot || disposed || activatedRootRef.current === targetRoot) return
        activatedRootRef.current = targetRoot
        activateVault(targetRoot)
          .then((r) => {
            if (disposed) return
            setCurrent(r.current)
            setVaults(r.vaults)
            onVaultChanged()
          })
          .catch(() => { /* 服务端不可用：保持当前库 */ })
      } catch (e) {
        console.warn('[knj] vault follow step failed:', String(e))
      }
    }
    step()
    const timer = setInterval(step, 2000)
    const unsubWs = workspaces.list.subscribe(step)
    const unsubSs = sessions?.list.subscribe(step)
    return () => { disposed = true; clearInterval(timer); unsubWs(); unsubSs?.() }
  }, [workspaces, sessions])

  const handleSwitch = async (id: string) => {
    if (!id || id === current?.id) return
    setBusy(true)
    try {
      const r = await switchVault(id)
      setCurrent(r.current)
      setVaults(r.vaults)
      onVaultChanged()
    } catch (e) {
      flash(`切换失败：${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally { setBusy(false) }
  }

  const doAttach = async () => {
    const root = formPath.trim()
    if (!root) { flash('请填写库目录（绝对路径）', 'err'); return }
    setBusy(true)
    try {
      const r = await attachVault(root, formName.trim() || undefined)
      setCurrent(r.current)
      setVaults(r.vaults)
      setManageOpen(false)
      setFormPath('')
      setFormName('')
      flash(`已挂接/新建：${r.current?.name ?? root}`)
      onVaultChanged()
    } catch (e) {
      flash(`挂接失败：${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally { setBusy(false) }
  }

  /** v11：库未初始化（磁盘无 .wiki）时，新建会话让 Agent 初始化（可见、可打断）。 */
  const initInstruction = () => [
    '请初始化当前工作区的知识库：调用 wiki_init 工具创建 .wiki 脚手架',
    '（index.md / .manifest.json / concepts、entities、references、synthesis、projects、dictionaries、tables 目录）。',
    '完成后报告：库根路径、是否新建、当前页数。不要在此步骤采集或写入知识页。',
  ].join('')
  const doInit = async () => {
    const text = initInstruction()
    const res = startAgentSession
      ? await startAgentSession(text, current?.root)
      : { ok: false, message: '宿主未提供新建会话能力' }
    if (!res.ok) {
      const copied = await copyToClipboard(text)
      flash(copied
        ? `无法新建会话（${res.message ?? '未知原因'}）：初始化指令已复制，请粘贴到对话发送给 Agent`
        : `无法新建会话（${res.message ?? '未知原因'}），且剪贴板写入失败（非安全上下文），请手动复制初始化指令`, 'err')
      return
    }
    flash(res.message
      ? `已新建会话并预填初始化指令，但请注意：${res.message}`
      : '已新建会话并预填初始化指令：切到该新会话后回车发送，Agent 会用 wiki_init 建库')
    setTimeout(() => { load().catch(() => {}) }, 4000)
  }

  const doRemove = async () => {
    if (!current || current.source !== 'attached') return
    if (!window.confirm(`从列表中移除知识库「${current.name}」？\n不会删除磁盘上的任何文件。`)) return
    setBusy(true)
    try {
      const r = await removeVault(current.id)
      setCurrent(r.current)
      setVaults(r.vaults)
      flash(`已移除「${current.name}」`)
      onVaultChanged()
    } catch (e) {
      flash(`移除失败：${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally { setBusy(false) }
  }

  return <div className="knj-vault">
    <div className="knj-vault__identity">
      <span className="knj-vault__name" title={current?.name}>
        <IconBook size={15} />
        <span className="knj-vault__name-text">{current ? current.name : '知识库'}</span>
      </span>
      {current && (
        <span className="knj-vault__path" title={current.root}>{current.root}</span>
      )}
      <span className="knj-statusbar__spacer" />
      {current && !(vaults.find((v) => v.id === current.id)?.initialized ?? true) && (
        <button type='button' className="knj-btn knj-btn--sm knj-btn--primary" disabled={busy}
          title={`此工作区还没有 .wiki，点此把初始化交给当前对话 Agent（wiki_init）`} onClick={doInit}>
          初始化知识库
        </button>
      )}
      {current && !(vaults.find((v) => v.id === current.id)?.initialized ?? true) && (
        <span className="knj-chip knj-chip--neutral" title='磁盘上还没有 .wiki：注册 ≠ 建库'>未初始化</span>
      )}
      <button type='button' className="knj-icon-btn" title='刷新库列表' onClick={() => { load().catch(() => {}) }}>
        <IconRefresh size={14} />
      </button>
      {current?.source === 'attached' && (
        <button type='button' className="knj-icon-btn knj-icon-btn--danger" title='从列表移除（不删文件）' onClick={doRemove}>
          <IconTrash size={14} />
        </button>
      )}
      <button type='button' className="knj-icon-btn" title='新建 / 挂接 / 移除知识库'
        onClick={() => setManageOpen(!manageOpen)}>
        {manageOpen ? <IconChevronDown size={14} /> : <IconGear size={14} />}
      </button>
    </div>

    <select className="knj-select knj-vault__select" value={current?.id ?? ''}
      onChange={(e) => handleSwitch(e.target.value)} disabled={busy} title='切换知识库'>
      {vaults.length === 0 && <option value=''>（无知识库）</option>}
      {vaults.map((v) => (
        <option key={v.id} value={v.id}>{v.name} · {v.pageCount} 页 · {SOURCE_LABEL[v.source] ?? v.source}</option>
      ))}
    </select>

    {notice && (
      <div className={`knj-banner ${notice.kind === 'ok' ? 'knj-banner--ok' : 'knj-banner--err'}`} style={{ marginTop: 8 }}>
        {notice.text}
      </div>
    )}

    {manageOpen && (
      <div className="knj-vault__manage">
        <div className="knj-vault__manage-row">
          <input className="knj-input" value={formPath} onChange={(e) => setFormPath(e.target.value)}
            placeholder='库目录（绝对路径）' spellCheck={false} />
          <button type='button' className="knj-btn" onClick={() => workspaces?.pickDirectory?.().then((p) => p && setFormPath(p)).catch(() => {})}>选目录</button>
        </div>
        <div className="knj-vault__manage-row">
          <input className="knj-input" value={formName} onChange={(e) => setFormName(e.target.value)}
            placeholder='显示名（可留空）' />
          <button type='button' className="knj-btn knj-btn--primary" disabled={busy || !formPath.trim()} onClick={doAttach}>
            <IconPlus size={14} />{busy ? '处理中…' : '新建/挂接'}
          </button>
          <button type='button' className="knj-btn" onClick={() => setManageOpen(false)}>取消</button>
        </div>
      </div>
    )}
  </div>
}
