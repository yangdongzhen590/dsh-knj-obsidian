/**
 * dsh-knj-obsidian client: registers the "知识库" sidebar tab and the
 * "笔记" workbench tab (A3 hybrid form) in the right sidebar (better-sidebar).
 * Built by tsdown into client/client.js.
 */
import { createElement as h } from 'react'
import { WikiSidebar } from './WikiSidebar.tsx'
import { NoteWorkbench } from './NoteWorkbench.tsx'

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
  effect(callback: () => unknown, label?: string): void
}

export const inject = ['betterSidebar']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    if (!ctx.betterSidebar) return
    const disposers: Array<() => void> = []
    /** 边栏点击笔记/图谱节点 → 主区域打开"笔记"工作台标签。 */
    const openNote = (id: string, category: string, title: string): void => {
      ctx.betterSidebar?.openTab({ type: 'dsh-knj-obsidian:note', title, path: `${id}|${category}` })
    }
    // 边栏标签（浏览/图谱）
    disposers.push(ctx.betterSidebar.registerTab({
      id: 'dsh-knj-obsidian',
      title: '知识库',
      component: () => h(WikiSidebar, { openNote }),
    }))
    // 主区域工作台标签（笔记视图，读 tab.path 的 id|category）
    disposers.push(ctx.betterSidebar.registerTab({
      id: 'dsh-knj-obsidian:note',
      title: '笔记',
      component: (props: { tab?: { path?: string } }) => h(NoteWorkbench, { path: props.tab?.path }),
    }))
    return () => { for (const d of disposers) d() }
  }, 'dsh-knj-obsidian: sidebar tabs')
}
