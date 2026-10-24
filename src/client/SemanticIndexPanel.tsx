import { useEffect, useRef, useState } from 'react'
import { fetchSemanticStatus, triggerSemanticUpdate, type SemanticStatus } from './api.ts'

/** 状态词 → 面向用户的短句（不把内部枚举直接抛给用户）。 */
const STATE_LABEL: Record<SemanticStatus['indexState'], string> = {
  ready: '就绪',
  'index-stale': '有未嵌入的新页',
  'index-empty': '索引为空',
}

function formatSeconds(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return '不到 1 秒'
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

/**
 * 本地语义索引状态块：模型是否就位、已索引多少页、还差多少页、是否正在重建，以及「更新索引」。
 *
 * 为什么必须是一个显式按钮：真实库首次重建包含模型加载（本机实测冷启动约 1.5 分钟，之后约 40ms/篇），
 * 不能让它变成界面上一次没有解释的卡顿；进度靠轮询 status（待嵌入数在下降）。
 */
export function SemanticIndexPanel({ root }: { root?: string } = {}) {
  const [status, setStatus] = useState<SemanticStatus | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    const load = () => {
      fetchSemanticStatus(root)
        .then((s) => { if (aliveRef.current) setStatus(s) })
        .catch(() => { if (aliveRef.current) setStatus(null) })
    }
    load()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    window.addEventListener('wiki:pages-changed', load)
    window.addEventListener('wiki:vault-changed', load)
    return () => {
      aliveRef.current = false
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('wiki:pages-changed', load)
      window.removeEventListener('wiki:vault-changed', load)
    }
  }, [root])

  // 重建进行中：每 2 秒轮询一次状态（也用于刷新「已用时间」），结束后再取一次终态
  useEffect(() => {
    if (!status?.refreshing) return
    const timer = setInterval(() => {
      setTick((v) => v + 1)
      fetchSemanticStatus(root)
        .then((s) => {
          if (!aliveRef.current) return
          setStatus(s)
          if (!s.refreshing) {
            setMessage(s.lastRun?.ok
              ? `索引已更新：${s.lastRun.documents} 篇 / ${s.lastRun.chunks} 块，用时 ${formatSeconds(s.lastRun.durationMs)}`
              : (s.lastRun?.note ?? '索引更新结束，但没有可报告的细节'))
          }
        })
        .catch(() => { /* 轮询失败保留上一次状态 */ })
    }, 2000)
    return () => clearInterval(timer)
  }, [status?.refreshing, root])

  const update = async () => {
    setBusy(true)
    setMessage('')
    try {
      const result = await triggerSemanticUpdate(root)
      setStatus(result.status)
      setMessage(result.running ? '正在重建索引（首次包含模型加载，通常 1–2 分钟）…' : (result.status.note ?? '已提交，但未开始'))
    } catch (error) {
      setMessage(`更新索引失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const pending = status?.pendingEmbedding ?? 0
  const elapsed = status?.refreshing
    ? formatSeconds((status.elapsedMs ?? 0) + tick * 2000)
    : ''

  return (
    <div className="knj-vcol" style={{ gap: 4 }}>
      <div className="knj-pop__row">
        <span className="knj-hrow" style={{ gap: 6 }}>
          <span style={{ fontWeight: 500 }}>语义索引</span>
          {status === null && <span className="knj-pop__hint">状态未知</span>}
          {status !== null && !status.modelPresent && <span className="knj-pop__hint">模型未就位</span>}
          {status !== null && status.modelPresent && (
            <span className="knj-pop__hint">
              {STATE_LABEL[status.indexState]} · {status.documents} 篇{pending > 0 ? ` · 待嵌入 ${pending} 篇` : ''}
            </span>
          )}
          {status?.refreshing && <span className="knj-pop__hint">正在重建{elapsed ? `（已用 ${elapsed}）` : ''}</span>}
        </span>
        <button type="button" className="knj-btn knj-btn--sm" onClick={update}
          disabled={busy || status?.refreshing === true || status?.modelPresent === false}
          title={status?.modelPresent === false
            ? '本地嵌入模型未就位：按下方提示放入模型文件后再更新'
            : '重建本地语义索引（不联网）'}>
          {status?.refreshing ? '重建中…' : '更新索引'}
        </button>
      </div>
      <span className="knj-pop__hint">
        本地语义检索用 300M 嵌入模型在本机运行，全程不联网；检索工具为 <code>wiki_search_semantic</code>。
        {status?.modelPresent && status.coldStartMs !== undefined && ` 首次重建含模型加载（本机约 ${formatSeconds(status.coldStartMs)}），之后约 40 毫秒/篇。`}
      </span>
      {status?.modelPresent === false && status.note && <span className="knj-pop__hint">{status.note}</span>}
      {status?.lastRun?.note && <span className="knj-pop__hint">{status.lastRun.note}</span>}
      {message && <div className="knj-banner knj-banner--info" style={{ color: 'var(--knj-text)' }}>{message}</div>}
    </div>
  )
}
