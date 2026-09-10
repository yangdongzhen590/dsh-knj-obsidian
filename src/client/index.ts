/**
 * dsh-knj-obsidian client: registers the "知识库" sidebar tab and the
 * "笔记" workbench tab (A3 hybrid form) in the right sidebar (better-sidebar).
 * Built by tsdown into client/client.js.
 */
import { createElement as h } from 'react'
import { WikiSidebar } from './WikiSidebar.tsx'
import { NoteWorkbench } from './NoteWorkbench.tsx'
import { injectWikiStyles, removeWikiStyles } from './styles.ts'
import type { SessionFace, WorkspaceFace } from './VaultHeader.tsx'

export const name = 'dsh-knj-obsidian'

/**
 * The subset of the better-sidebar client service this plugin touches.
 * Structural type: the junction node_modules has no dsh-better-sidebar, so
 * we must not import types from 'dsh-better-sidebar/client/service' — the
 * host provides the implementation at runtime (see tsdown CLIENT_EXTERNALS).
 */
interface BetterSidebarService {
  registerTab(descriptor: {
    id: string
    title: string | (() => string)
    icon?: unknown
    /** The host renders `descriptor.component` (TabDescriptor.component in 0.14.0). */
    component: (props: { tab?: { path?: string } }) => unknown
  }): () => void
  /** Open a tab by type; the seed's `path` lands in the tab's `path` field. */
  openTab(seed: { type: string; title?: string; path?: string }, scope?: unknown): void
}

/** The client context shape this plugin relies on (structural). */
interface ClientContext {
  betterSidebar?: BetterSidebarService
  /**
   * v8.1：新版宿主 client 用 ctx.get('workspaces'/'sessions') + exports.inject
   * 声明才能取到服务（属性访问在新版 Loader 下不可见）。旧版回退 ctx[name]。
   */
  get?(name: string): unknown
  effect(callback: () => unknown, label?: string): void
}

/**
 * v9 桥接面：better-sidebar tab 宿主把当前会话的 composer 草稿写入能力暴露为
 * `conversation.input.for(sessionScope).setDraft(text)`（可见、可编辑、用户回车发送）。
 * 结构类型：不 import dsh-better-sidebar 类型（junction 无该包）。
 */
interface ConversationInputFace { for?(actx: unknown): { setDraft?(text: string): void } }
interface ConversationFace { input?: ConversationInputFace }
interface SessionServiceFace extends SessionFace { scope?(id: string): unknown }

export const inject = ['betterSidebar', 'workspaces', 'sessions', 'conversation']

/** 双通道取宿主 client 服务：新版 ctx.get(name) → 旧版 ctx[name] 属性。 */
function hostService<T>(ctx: ClientContext, name: string): T | undefined {
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get(name) : undefined
    if (viaGet !== undefined && viaGet !== null) return viaGet as T
  } catch { /* ignore */ }
  try {
    const viaProp = (ctx as unknown as Record<string, unknown>)[name]
    return (viaProp !== undefined && viaProp !== null) ? viaProp as T : undefined
  } catch {
    return undefined
  }
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    // 设计系统 v2：注入宿主令牌驱动的样式（幂等，全局只注入一次）
    injectWikiStyles()
    const betterSidebar = hostService<BetterSidebarService>(ctx, 'betterSidebar')
    if (!betterSidebar) return
    // v7/v8.1：防御性读取宿主工作区/会话运行时；不可用时降级为手动切换（不阻塞标签渲染）
    const workspaces = hostService<WorkspaceFace>(ctx, 'workspaces')
    const sessions = hostService<SessionServiceFace>(ctx, 'sessions')
    const conversation = hostService<ConversationFace>(ctx, 'conversation')
    /**
     * v9：把受限指令交给「当前对话」的 Agent——填入该会话 composer 输入框（可见可编辑，
     * 用户回车即发送，无隐藏 Agent）。返回 ''=成功；非空=失败原因（UI 显示并退回复制）。
     * 调用序列镜像宿主 better-sidebar 规范（client.js:13344）：
     *   actx = sessions.scope(id) → conversation = ctx.get('conversation')
     *   → input = conversation.input.for(actx) → input.state.getSnapshot() → input.setDraft(text)
     */
    const sendToAgent = (text: string): string => {
      const fail = (reason: string): string => {
        console.warn('[knj] sendToAgent failed:', reason)
        return reason
      }
      try {
        if (!text) return fail('empty instruction')
        let snap: { current?: string; items?: Array<{ id: string }> } | undefined
        try { snap = sessions?.list.getSnapshot() as { current?: string; items?: Array<{ id: string }> } | undefined } catch (e) { return fail(`sessions.list.getSnapshot threw: ${String(e)}`) }
        if (!sessions) return fail('host service "sessions" unavailable')
        if (!snap) return fail('sessions.list snapshot empty')
        const current = typeof snap.current === 'string' && snap.current ? snap.current : snap.items?.[0]?.id
        if (!current) return fail('no current session id in snapshot')
        let actx: unknown
        try { actx = sessions.scope?.(current) } catch (e) { return fail(`sessions.scope(${current}) threw: ${String(e)}`) }
        if (actx === undefined || actx === null) return fail(`sessions.scope("${current}") returned nothing`)
        let conversation: { input?: { for?(actx: unknown): { state?: { getSnapshot?(): { draft?: string } }; setDraft?(text: string): void; actions?: { setDraft?(text: string): void } } | undefined } } | undefined
        try {
          conversation = (typeof ctx.get === 'function' ? ctx.get('conversation') : undefined) as typeof conversation
        } catch (e) { return fail(`ctx.get('conversation') threw: ${String(e)}`) }
        if (!conversation) return fail('host service "conversation" unavailable via ctx.get')
        let input: { state?: { getSnapshot?(): { draft?: string } }; setDraft?(text: string): void; actions?: { setDraft?(text: string): void } } | undefined
        try { input = conversation.input?.for?.(actx) } catch (e) { return fail(`conversation.input.for threw: ${String(e)}`) }
        if (!input) return fail('conversation.input.for(scope) returned nothing')
        try { input.state?.getSnapshot?.() } catch (e) { return fail(`input.state.getSnapshot threw: ${String(e)}`) }
        const setDraft = typeof input.setDraft === 'function' ? input.setDraft : input.actions?.setDraft
        if (typeof setDraft !== 'function') return fail('no setDraft on input face')
        try { setDraft.call(input, text) } catch (e) { return fail(`setDraft threw: ${String(e)}`) }
        return ''
      } catch (e) {
        return fail(`unexpected: ${String(e)}`)
      }
    }
    const disposers: Array<() => void> = []
    /** 边栏点击笔记/图谱节点 → 主区域打开"笔记"工作台标签。 */
    const openNote = (id: string, category: string, title: string): void => {
      betterSidebar?.openTab({ type: 'dsh-knj-obsidian:note', title, path: `${id}|${category}` })
    }
    // 边栏标签（浏览/图谱）
    disposers.push(betterSidebar.registerTab({
      id: 'dsh-knj-obsidian',
      title: '知识库',
      component: () => h(WikiSidebar, { openNote, workspaces, sessions, sendToAgent }),
    }))
    // 主区域工作台标签（笔记视图，读 tab.path 的 id|category）
    disposers.push(betterSidebar.registerTab({
      id: 'dsh-knj-obsidian:note',
      title: '笔记',
      component: (props: { tab?: { path?: string } }) => h(NoteWorkbench, { path: props.tab?.path }),
    }))
    return () => {
      for (const d of disposers) d()
      // 卸载/HMR 时移除注入的 <style>，避免旧版本 CSS 常驻 DOM
      removeWikiStyles()
    }
  }, 'dsh-knj-obsidian: sidebar tabs')
}
