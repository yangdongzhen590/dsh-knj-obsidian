/**
 * 剪贴板写入，带降级链：
 * 1) navigator.clipboard.writeText（仅在 secure context 可用——loopback 或 https；
 *    局域网 IP + http 下该 API 整个是 undefined）
 * 2) 隐藏 textarea + document.execCommand('copy')（同步兜底，非 secure context 也可用）
 * 返回是否真的写成功，调用方据此如实提示，不许在失败时谎报「已复制」。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* 落到 execCommand 兜底 */ }
  try {
    if (typeof document === 'undefined') return false
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    let ok = false
    try { ok = document.execCommand('copy') } catch { ok = false }
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}
