/**
 * v7 vault 头部（2026-10-24 改为**会话级作用域**）。
 *
 * 旧实现按 `workspaces.list.getSnapshot().recentWorkspaceId` +
 * `sessions.list.getSnapshot().current` 轮询调度 activate。DSH 0.2 的两个快照里
 * 都没有这两个字段（SessionListState = ids/byId/phase/projectionsBySession；
 * WorkspaceState = items/archivedSessionIds/pinnedSessionIds/state/phase/error），
 * 于是跟随目标恒为 undefined，面板停在旧库——「切换工作区后仍是旧库」。
 *
 * 新契约：root（= 当前会话所属工作区根，由 WikiSidebar 用 session-root.ts 算出）
 * 作为唯一输入；库身份/页数/未初始化态全部由 `/vaults?root=` 回填，不再写全局
 * currentVaultId，因此多个会话的面板互不干扰。下拉「切换知识库」= 本面板的临时
 * 覆盖（view-only），「跟随工作区」可一键还原。
 */
import { useEffect, useState } from 'react'
import { attachVault, fetchVaults, removeVault } from './api.ts'
import type { VaultInfo, VaultListEntry } from './api.ts'
import { normalizeRoot } from './session-root.ts'
import { IconBook, IconChevronDown, IconGear, IconPlus, IconRefresh, IconTrash } from './icons.tsx'

/** 客户端工作区服务的最小结构面（宿主 dsh-client-runtime 提供；缺失时仅手动切换）。 */
export interface WorkspaceFace {
  list: {
    getSnapshot(): { items: readonly WorkspaceView[] }
    subscribe(cb: () => void): () => void
  }
  pickDirectory?(): Promise<string | null>
  /** 注册已存在的路径为工作区（幂等：已注册则解析回同一工作区）。 */
  create?(input: { path: string }): Promise<{ id: string; title?: string; path?: string }>
}

/** 会话服务最小面（保留导出：0.2 之前/其它调用方仍按此结构传参）。 */
export interface SessionFace {
  list: {
    getSnapshot(): { byId?: Record<string, { cwd?: string }> }
    subscribe(cb: () => void): () => void
  }
}

interface WorkspaceView {
  workspaceId?: string
  id?: string
  title?: string
  path?: string
  sessionIds?: readonly string[]
}

const SOURCE_LABEL: Record<string, string> = { cwd: '默认', workspace: '工作区', attached: '挂接' }

/** 路径尾段（展示用；不引入 node:path，客户端无该模块）。 */
function shortDir(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function VaultHeader({ root, workspaces, startAgentSession, onVaultChanged }: {
  /** 当前会话所属工作区根（undefined = 宿主没给会话上下文，退回全局当前库）。 */
  root?: string
  workspaces?: WorkspaceFace
  /** v11：新建会话并预填指令（ok=false 时 message 为失败原因）；用于「初始化知识库」触发 agent。 */
  startAgentSession?: (instruction: string, cwd?: string) => Promise<{ ok: boolean; message?: string }>
  onVaultChanged: () => void
}) {
  const [current, setCurrent] = useState<VaultInfo | null>(null)
  const [vaults, setVaults] = useState<VaultListEntry[]>([])
  const [uninitialized, setUninitialized] = useState(false)
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [formPath, setFormPath] = useState('')
  const [formName, setFormName] = useState('')
  const [busy, setBusy] = useState(false)
  /** 本面板的临时库覆盖（下拉切换）；不写全局 currentVaultId。 */
  const [overrideRoot, setOverrideRoot] = useState<string | undefined>(undefined)

  const effectiveRoot = overrideRoot ?? root

  const flash = (text: string, kind: 'ok' | 'err' = 'ok') => {
    setNotice({ text, kind })
    setTimeout(() => setNotice(null), 5000)
  }

  const load = async () => {
    try {
      const r = await fetchVaults(effectiveRoot)
      setCurrent(r.current)
      setVaults(r.vaults)
      setUninitialized(Boolean(r.uninitialized))
    } catch (e) {
      flash(`库列表加载失败：${e instanceof Error ? e.message : String(e)}`, 'err')
    }
  }

  // 会话切换（root 变化）→ 丢弃面板级覆盖，重新按新工作区取库
  useEffect(() => {
    setOverrideRoot(undefined)
  }, [root])

  // 跟随目标变化（root / 本面板覆盖）→ 重新解析库身份
  useEffect(() => {
    setCurrent(null)
    setUninitialized(false)
    load().catch(() => { /* load 内部已 flash */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRoot])

  const handleSwitch = (id: string) => {
    if (!id || id === current?.id) return
    const target = vaults.find((v) => v.id === id)
    if (!target) return
    setOverrideRoot(target.root)
    onVaultChanged()
  }

  const doAttach = async () => {
    const path = formPath.trim()
    if (!path) { flash('请填写库目录（绝对路径）', 'err'); return }
    setBusy(true)
    try {
      const r = await attachVault(path, formName.trim() || undefined)
      setManageOpen(false)
      setFormPath('')
      setFormName('')
      flash(`已挂接/新建：${r.current?.name ?? path}`)
      setOverrideRoot(path)
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
    const targetRoot = current?.root ?? effectiveRoot
    const res = startAgentSession
      ? await startAgentSession(text, targetRoot)
      : { ok: false, message: '宿主未提供新建会话能力' }
    if (!res.ok) {
      try { await navigator.clipboard.writeText(text) } catch { /* 提示里给出降级说明 */ }
      flash(`无法新建会话（${res.message ?? '未知原因'}）：初始化指令已复制，请粘贴到对话发送给 Agent`, 'err')
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
      await removeVault(current.id)
      flash(`已移除「${current.name}」`)
      setOverrideRoot(undefined)
      onVaultChanged()
    } catch (e) {
      flash(`移除失败：${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally { setBusy(false) }
  }

  const followedByWorkspace = Boolean(overrideRoot && root && normalizeRoot(overrideRoot) !== normalizeRoot(root))
  // 下拉 value 必须能匹配到某个 option；否则浏览器回落到**第一个库**（实测显示成 iobs_pro）。
  // 未注册 / 未初始化 / 尚未加载时统一落到「本工作区」占位 option。
  const currentInList = Boolean(current?.id) && vaults.some((v) => v.id === current!.id)
  const selectValue = currentInList ? current!.id : '__follow__'
  const displayRoot = current?.root ?? effectiveRoot
  const followLabel = current?.name ?? (effectiveRoot ? shortDir(effectiveRoot) : '当前工作区')

  return <div className="knj-vault">
    <div className="knj-vault__identity">
      <span className="knj-vault__name" title={current?.name ?? displayRoot}>
        <IconBook size={15} />
        <span className="knj-vault__name-text">
          {current ? current.name : (effectiveRoot ? '本工作区没有知识库' : '知识库')}
        </span>
      </span>
      {displayRoot && (
        <span className="knj-vault__path" title={displayRoot}>{displayRoot}</span>
      )}
      <span className="knj-statusbar__spacer" />
      {effectiveRoot && uninitialized && (
        <button type='button' className="knj-btn knj-btn--sm knj-btn--primary" disabled={busy}
          title={'此工作区还没有 .wiki，点此把初始化交给当前对话 Agent（wiki_init）'} onClick={doInit}>
          初始化知识库
        </button>
      )}
      {effectiveRoot && uninitialized && (
        <span className="knj-chip knj-chip--neutral" title='磁盘上还没有 .wiki：注册 ≠ 建库'>未初始化</span>
      )}
      {followedByWorkspace && (
        <button type='button' className="knj-btn knj-btn--sm" disabled={busy}
          title={`本面板临时切到了别的库；点此回到当前工作区（${root}）`}
          onClick={() => { setOverrideRoot(undefined); onVaultChanged() }}>
          跟随工作区
        </button>
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

    <select className="knj-select knj-vault__select" value={selectValue}
      onChange={(e) => handleSwitch(e.target.value)} disabled={busy} title='切换知识库（只影响本面板，不改全局当前库）'>
      {selectValue === '__follow__' && (
        <option value='__follow__'>{followLabel}{uninitialized ? ' · 未初始化' : ''}</option>
      )}
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
