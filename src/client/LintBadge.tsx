import { useEffect, useState } from 'react'
import { fetchLint } from './api.ts'

export function LintBadge() {
  const [report, setReport] = useState<{ pageCount: number; issues: number } | null>(null)

  useEffect(() => {
    fetchLint().then((r) => setReport({ pageCount: r.pageCount, issues: r.orphans.length + r.brokenLinks.length + r.missingFrontmatter.length })).catch(() => {})
  }, [])

  if (!report) return null
  const color = report.issues === 0 ? '#22c55e' : report.issues < 5 ? '#f59e0b' : '#ef4444'
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', fontSize: 12, color: '#9ca3af' }}>
    <span>{report.pageCount} 页</span>
    <span style={{ color }}>{report.issues === 0 ? '健康' : `${report.issues} 个问题`}</span>
  </div>
}
