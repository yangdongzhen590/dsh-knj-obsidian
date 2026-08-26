/**
 * dsh-knj-obsidian client: registers the "知识库" tab in the right sidebar
 * (better-sidebar). Built by tsdown into client/client.js.
 */
import { createElement as h } from 'react'
import { WikiSidebar } from './WikiSidebar.tsx'

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
    render: (props: unknown) => unknown
  }): () => void
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
    return ctx.betterSidebar.registerTab({
      id: 'dsh-knj-obsidian',
      title: '知识库',
      render: () => h(WikiSidebar),
    })
  }, 'dsh-knj-obsidian: sidebar tab')
}
