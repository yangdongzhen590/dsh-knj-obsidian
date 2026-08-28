/**
 * v7 vault 头部（设计 v2）：当前库身份（名称+路径）、切换下拉、新建/挂接/移除。
 * - 挂载时按当前工作区激活库（跟随工作区走；无 workspaces 服务时降级为手动切换）
 * - 切换/变更后回调 onVaultChanged，由上层刷新树/lint/图谱
 * 样式全部走宿主令牌（styles.ts），随宿主浅/深主题自适应。
 */
import { useEffect, useRef, useState } from 'react'
import { activateVault, attachVault, fetchVaults, removeVault, switchVault } from './api.ts'
import type { VaultInfo, VaultListEntry } from './api.ts'
import { IconBook, IconChevronDown, IconGear, IconPlus, IconTrash } from './icons.tsx'

/** 客户端工作区服务的最小结构面（宿主 dsh-client-runtime 提供；缺失时仅手动切换）。 */
export interface WorkspaceFace {
  list: {
    getSnapshot(): { items: readonly WorkspaceView[]; recentWorkspaceId?: string; baselinesReady?: boolean }
    subscribe(cb: () => void): () => void
  }
  pickDirectory?(): Promise<string | null>
}

interface WorkspaceView { id: string; title?: string; path?: string }

const SOURCE_LABEL: Record<string, string> = { cwd: '默认', workspace: '工作区', attached: '挂接' }

export function VaultHeader({ workspaces, onVaultChanged }: { workspaces?: WorkspaceFace; onVaultChanged: () => void }) {
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

  // 初始加载 + 跟随工作区：最近激活的工作区目录 → activateVault
  useEffect(() => {
    load()
    if (!workspaces) return
    let disposed = false
    const applyWorkspace = () => {
      try {
        const snap = workspaces.list.getSnapshot()
        if (!snap.baselinesReady) return
        const recent = snap.items.find((w) => w.id === snap.recentWorkspaceId) ?? snap.items[0]
        const root = recent?.path
        if (!root || disposed) return
        if (activatedRootRef.current === root) return
        activatedRootRef.current = root
        activateVault(root)
          .then((r) => {
            if (disposed) return
            setCurrent(r.current)
            setVaults(r.vaults)
            onVaultChanged()
          })
          .catch(() => { /* 服务端不可用：保持当前库 */ })
      } catch {
        // host 无 workspaces 服务：仅手动切换
      }
    }
    applyWorkspace()
    const unsub = workspaces.list.subscribe(applyWorkspace)
    return () => { disposed = true; unsub() }
  }, [workspaces])

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
