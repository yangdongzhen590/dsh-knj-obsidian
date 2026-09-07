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

export const inject = ['betterSidebar', 'workspaces', 'sessions']

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
    const sessions = hostService<SessionFace>(ctx, 'sessions')
    const disposers: Array<() => void> = []
    /** 边栏点击笔记/图谱节点 → 主区域打开"笔记"工作台标签。 */
    const openNote = (id: string, category: string, title: string): void => {
      betterSidebar?.openTab({ type: 'dsh-knj-obsidian:note', title, path: `${id}|${category}` })
    }
    // 边栏标签（浏览/图谱）
    disposers.push(betterSidebar.registerTab({
      id: 'dsh-knj-obsidian',
      title: '知识库',
      component: () => h(WikiSidebar, { openNote, workspaces, sessions }),
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
