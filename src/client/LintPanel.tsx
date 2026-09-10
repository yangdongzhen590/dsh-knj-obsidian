/**
 * v6/v7 底部状态条 + 展开面板（设计 v2）：
 * - 常驻：页数 + 健康状态点（绿/琥珀/红三态）
 * - 「问题」展开：断链 / 孤儿页 / 缺 frontmatter 逐条可点跳转
 * - 「工具」展开：重建索引 / 蒸馏近期会话 / 导入 md（原顶部工具条移入，释放主视觉）
 */
import { useEffect, useState } from 'react'
import { fetchLint, fetchPages, importMd, rebuildIndex, type LintReport } from './api.ts'
import { IconChevronDown, IconImport, IconLink, IconRefresh, IconSparkles, IconWarning } from './icons.tsx'

const CATEGORIES = [
  { value: 'references', label: '参考' },
  { value: 'concepts', label: '概念' },
  { value: 'entities', label: '实体' },
  { value: 'synthesis', label: '综合' },
  { value: 'projects', label: '项目' },
  { value: 'dictionaries', label: '字典' },
  { value: 'tables', label: '数据结构' },
]

const DISTILL_TRIGGER = '用 wiki-distill 蒸馏近期 DSH 会话进知识库（先向我确认范围）'

export function LintPanel({ openNote }: { openNote: (id: string, category: string, title: string) => void }) {
  const [report, setReport] = useState<LintReport | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [catById, setCatById] = useState<Map<string, { category: string; title: string }>>(new Map())
  // 工具状态
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const [busy, setBusy] = useState<'rebuild' | 'import' | null>(null)
  const [importPathInput, setImportPathInput] = useState('')
  const [importCategory, setImportCategory] = useState('references')

  const flash = (text: string, kind: 'ok' | 'err' = 'ok') => {
    setNotice({ text, kind })
    setTimeout(() => setNotice(null), 5000)
  }

  useEffect(() => {
    const load = () => {
      fetchLint().then(setReport).catch(() => {})
      fetchPages()
        .then(({ pages }) => {
          const m = new Map<string, { category: string; title: string }>()
          for (const p of pages) m.set(p.id, { category: p.category, title: p.title })
          setCatById(m)
        })
        .catch(() => { /* 索引失败时条目仍展示，只是不可点 */ })
    }
    load()
    window.addEventListener('wiki:pages-changed', load)
    return () => window.removeEventListener('wiki:pages-changed', load)
  }, [])

  const doRebuild = async () => {
    setBusy('rebuild')
    try {
      const r = await rebuildIndex()
      flash(`索引已重建（${r.pageCount} 页）`)
      window.dispatchEvent(new CustomEvent('wiki:pages-changed'))
    } catch (e) {
      flash(`重建失败：${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally { setBusy(null) }
  }

  const doImport = async () => {
    const p = importPathInput.trim()
    if (!p) { flash('请先填写 md 文件或目录路径', 'err'); return }
    setBusy('import')
    try {
      const r = await importMd(p, importCategory)
      const parts = [
        r.imported ? `导入 ${r.imported}` : null,
        r.updated ? `更新 ${r.updated}` : null,
        r.skipped ? `跳过 ${r.skipped}` : null,
      ].filter(Boolean)
      flash(parts.length ? parts.join('，') : '没有可导入的文件')
      window.dispatchEvent(new CustomEvent('wiki:pages-changed'))
    } catch (e) {
      flash(`导入失败：${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally { setBusy(null) }
  }

  const doDistill = async () => {
    try {
      await navigator.clipboard.writeText(DISTILL_TRIGGER)
      flash('触发指令已复制，粘贴到对话发送即可')
    } catch {
      flash(`复制失败，请手动发送：${DISTILL_TRIGGER}`, 'err')
    }
  }

  if (!report) return <div className="knj-statusbar" style={{ visibility: 'hidden' }}>·</div>

  const issues = report.orphans.length + report.brokenLinks.length + report.missingFrontmatter.length
  const health = issues === 0 ? 'ok' : issues < 5 ? 'warn' : 'err'
  const healthLabel = issues === 0 ? '健康' : `${issues} 个问题`

  const jump = (id: string) => {
    const meta = catById.get(id)
    if (meta) openNote(id, meta.category, meta.title)
  }

  return <>
    {toolsOpen && <div className="knj-pop">
      <div className="knj-pop__row">
        <button type='button' className="knj-btn knj-btn--subtle" disabled={busy === 'rebuild'} onClick={doRebuild}>
          <IconRefresh size={14} />{busy === 'rebuild' ? '重建中…' : '重建索引'}
        </button>
        <button type='button' className="knj-btn knj-btn--subtle" onClick={doDistill}>
          <IconSparkles size={14} />蒸馏近期会话
        </button>
      </div>
      <div className="knj-pop__row">
        <span className="knj-section-title"><IconImport size={13} />快速导入（直接写入）</span>
      </div>
      <div className="knj-pop__hint" style={{ color: 'var(--knj-warn)' }}>直接写入，跳过受审阅流程与哈希校验；如需先审阅请用「采集」视图。</div>
      <div className="knj-pop__row">
        <input className="knj-input" value={importPathInput}
          onChange={(e) => setImportPathInput(e.target.value)}
          placeholder="md 文件或目录路径" spellCheck={false} />
        <select className="knj-select" style={{ width: 76, flexShrink: 0 }} value={importCategory}
          onChange={(e) => setImportCategory(e.target.value)} title='导入分类'>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button type='button' className="knj-btn knj-btn--primary" disabled={busy === 'import'} onClick={doImport}>
          <IconImport size={14} />{busy === 'import' ? '导入中…' : '直接导入'}
        </button>
      </div>
      <div className="knj-pop__hint">重建索引会重新生成 index.md；蒸馏会把触发指令复制到剪贴板。</div>
      {notice && <div className={`knj-banner ${notice.kind === 'ok' ? 'knj-banner--ok' : 'knj-banner--err'}`}>{notice.text}</div>}
    </div>}

    {issuesOpen && <div className="knj-pop" style={{ maxHeight: 260, overflow: 'auto' }}>
      {issues === 0 && <div className="knj-pop__hint">没有待处理的问题，知识库很健康。</div>}
      {report.brokenLinks.length > 0 && <>
        <div className="knj-section-title"><IconLink size={13} />断链（{report.brokenLinks.length}）</div>
        {report.brokenLinks.map((b, i) => (
          <div key={`bl-${i}`} className="knj-issue-item" onClick={() => jump(b.from)} title={`在来源页修复指向 ${b.target} 的链接`}>
            <IconLink size={13} />{b.from} <span style={{ color: 'var(--knj-error)' }}>→ {b.target}</span>
          </div>
        ))}
      </>}
      {report.orphans.length > 0 && <>
        <div className="knj-section-title"><IconWarning size={13} />孤儿页（{report.orphans.length}）</div>
        {report.orphans.map((o) => (
          <div key={`or-${o}`} className="knj-issue-item" onClick={() => jump(o)} title="双向链接未织好">
            {catById.get(o)?.title ?? o}
          </div>
        ))}
      </>}
      {report.missingFrontmatter.length > 0 && <>
        <div className="knj-section-title"><IconWarning size={13} />缺 frontmatter（{report.missingFrontmatter.length}）</div>
        {report.missingFrontmatter.map((m) => (
          <div key={`mf-${m}`} className="knj-issue-item" onClick={() => jump(m)}>{m}</div>
        ))}
      </>}
    </div>}

    <div className="knj-statusbar">
      <span className="knj-statusbar__meta">
        <span className={`knj-dot knj-dot--${health}`} />
        {report.pageCount} 页 · {healthLabel}
      </span>
      <span className="knj-statusbar__spacer" />
      <button type='button' className="knj-btn knj-btn--sm" onClick={() => setIssuesOpen(!issuesOpen)}>
        {issues > 0 && <span className="knj-badge knj-badge--danger">{issues}</span>}
        问题<IconChevronDown size={12} />
      </button>
      <button type='button' className="knj-btn knj-btn--sm" onClick={() => setToolsOpen(!toolsOpen)}>
        工具<IconChevronDown size={12} />
      </button>
    </div>
  </>
}
