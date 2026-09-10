import { useState } from 'react'
import { IconCopy, IconSparkles } from './icons.tsx'

export type CollectKind = 'enum' | 'db' | 'both'

const SCOPE_LABELS: Array<{ value: CollectKind; label: string; detail: string }> = [
  { value: 'enum', label: '枚举/常量字典', detail: 'Java enum + public static final 常量 → dictionaries' },
  { value: 'db', label: '表结构', detail: 'SQL DDL / MyBatis XML / JPA Entity → tables' },
  { value: 'both', label: '全部', detail: '字典 + 表结构一次采集' },
]

/** 启动器触发指令（引用内置 wiki-collect skill；GUI 不产生任何草稿/状态机）。 */
function buildTrigger(kind: CollectKind): string {
  return [
    '请使用内置 wiki-collect skill 在当前工作区执行代码结构采集：',
    `采集类型 = ${kind}（enum=Java 枚举/常量字典；db=SQL DDL/MyBatis/JPA 表结构；both=全部）。`,
    '步骤：用 wiki_mine 扫描并对账存量知识（new/changed/unchanged/deleted，含同名近似页提醒）→ 蒸馏 → 直接 wiki_ingest 入库。',
    '规则：仅支持 Java enum、Java public static final、SQL DDL、MyBatis XML、JPA Entity；不支持 TypeScript/Python/Go/任意 ORM/JSON Schema。',
    '不得读取 .dsh 会话归档等非代码源；未知/推断字段保持 unknown/inferred，不得补造成事实；不得覆盖他源页面。',
    '完成后报告：本批 new/changed/unchanged/deleted 数量、入库页数与剩余模块（如有）。',
  ].join('\n')
}

/** GUI 采集启动器：只把触发指令交给当前对话 Agent（预填输入框），复制为兜底。 */
export function CodeCollectLauncher({ sendToAgent }: { sendToAgent?: (instruction: string) => string }) {
  const [kind, setKind] = useState<CollectKind>('both')
  const [message, setMessage] = useState('')

  const deliver = async (copyOnly: boolean) => {
    const text = buildTrigger(kind)
    if (!copyOnly && sendToAgent) {
      const reason = sendToAgent(text)
      if (!reason) {
        setMessage('触发指令已填入当前对话输入框：查看后按回车发送，Agent 会用 wiki-collect 采集并直接入库。')
        return
      }
      setMessage(`无法自动预填输入框（${reason}）：触发指令已复制到剪贴板，请粘贴到对话发送给 Agent。`)
      try { await navigator.clipboard.writeText(text) } catch { /* 指令仍在下方可复制 */ }
      return
    }
    try { await navigator.clipboard.writeText(text) } catch { /* 展示兜底文本 */ }
    setMessage('触发指令已复制到剪贴板，请粘贴到对话发送给 Agent（当前对话框无法自动预填）。')
  }

  return <div className="knj-vcol" style={{ padding: 12, gap: 10 }}>
    <div className="knj-banner knj-banner--info">
      <span><strong>代码结构采集</strong>：把当前工作区的枚举/常量字典与表结构采集进知识库。
        点击后把触发指令交给当前对话 Agent，由它用内置 <code>wiki-collect</code> skill 完成
        扫描 → 联动存量对账 → 蒸馏 → 直接入库（按你的决策不做二次确认；知识库纳入 git 分支合并把关已预留）。
        本视图不产生草稿状态，也不直接写库。</span>
    </div>
    <div className="knj-pop__hint">支持：Java enum、Java public static final、SQL DDL、MyBatis XML、JPA Entity。
      <br />不支持：TypeScript、Python、Go、任意 ORM、JSON Schema。只读代码文件，不读会话归档。</div>

    <div className="knj-vcol" style={{ gap: 6 }}>
      {SCOPE_LABELS.map((s) => (
        <label key={s.value} className="knj-result-item" style={{ cursor: 'pointer' }}>
          <span className="knj-hrow" style={{ gap: 7 }}>
            <input type="radio" name="collect-kind" checked={kind === s.value} onChange={() => setKind(s.value)} />
            <span style={{ fontWeight: 500 }}>{s.label}</span>
          </span>
          <span className="knj-pop__hint">{s.detail}</span>
        </label>
      ))}
    </div>

    <div className="knj-pop__row">
      <button type="button" className="knj-btn knj-btn--primary" onClick={() => deliver(false)}>
        <IconSparkles size={14} />预填当前对话开始采集
      </button>
      <button type="button" className="knj-btn knj-btn--subtle" onClick={() => deliver(true)}>
        <IconCopy size={14} />复制触发指令
      </button>
    </div>
    <div className="knj-pop__hint">触发指令会写入对话输入框（可见可编辑），你确认后回车即发送给 Agent。</div>

    {message && <div className="knj-banner knj-banner--info" style={{ color: 'var(--knj-text)' }}>{message}</div>}
  </div>
}
