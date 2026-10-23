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
 * DSH 0.2 原生右侧栏的扩展面（结构类型，不 import 宿主包）。
 *
 * 0.2.x 自带 `@deepseek-ai/dsh-client-ui-sidebar-right`，它对外开四个 slot seat：
 *   - `sidebar.right.tab.menu.item`  往「+」菜单/动作菜单加条目
 *   - `sidebar.right.pane.tab`       **keyed**：按 tab 类型定义的 `id` 注册内容面板
 *   - `sidebar.right.pane.tab.title` 同上的标题（可选，缺省用注册时捕获的 title）
 *   - `sidebar.right.tab.guide(.entry)` 引导页卡片
 * 类型定义本身注册到 `ctx.sidebarRightTabs`，其中 `kind` 是 openTab 用的判别式、
 * `id` 是 pane.tab / pane.tab.title 两个 seat 的 key（两者可以是同一个字符串）。
 * 见 packages/client/ui-sidebar-right/lib/types/client/{tab-registry,contract/slots}.d.ts
 */
interface NativeTabDefinition {
  /** 实现身份：唯一，且是 body/title 注册时的 key。 */
  id: string
  /** 类型判别式：openTab 用它。 */
  kind: string
  /** 'extension' = 第三方类型，优先级最高，可覆盖同 kind 的 builtin。 */
  priority?: 'extension' | 'builtin' | 'fallback'
  /** 每个 tab 是否独立内容（缺省＝每个 pane 里同 kind 只留一页）。 */
  multiple?: boolean
  /** 页签标题（每次渲染都重新读，所以语言切换无需重注册）。 */
  title: () => string
  /** 引导页上的入口卡片。 */
  guide?: ReadonlyArray<{
    id: string
    order: number
    title: () => string
    description?: () => string
  }>
}

interface SidebarRightTabsService {
  register(definition: NativeTabDefinition): () => void
}

/** 右侧栏的打开入口（`ctx.sidebarRight`）：按 kind 开页，`params` 进 navigation.params。 */
interface SidebarRightService {
  openTab(kind: string, options?: { params?: Record<string, unknown> }): void
}

/** `sidebar.right.pane.tab(.title)` 两个 keyed seat 交给组件的东西（只用得到 useTabInfo）。 */
interface PaneTabProps {
  /** 返回 { tab: { ..., navigation: { address, params } } }；未提交的 tab 会抛。 */
  useTabInfo?: () => { tab?: { navigation?: { params?: Record<string, unknown> } } }
}

interface SlotsService {
  /** keyed seat：key = 类型定义的 id。组件按 seat 契约收 props（这里用泛型保持调用方类型）。 */
  register<P = unknown>(descriptor: { name: string; key?: string; locale?: string }, component: (props: P) => unknown): () => void
  /** 等宿主提供该 seat 后再注册（宿主未提供时不注册，也不抛）。 */
  inject(name: string, register: () => () => void): void
}

/** 插件内使用的 tab 类型标识（id 与 kind 取同一个值，便于排查）。 */
const WIKI_TAB = 'dsh-knj-obsidian:wiki'
/** 笔记工作台：由侧栏里点节点触发，靠 openTab 的 params 传 id|category。 */
const NOTE_TAB = 'dsh-knj-obsidian:note'

/** The client context shape this plugin relies on (structural). */
interface ClientContext {
  /** 0.2 原生右侧栏的类型注册表、slot 服务与打开入口（0.1.x 没有，走降级路径）。 */
  slots?: SlotsService
  sidebarRightTabs?: SidebarRightTabsService
  sidebarRight?: SidebarRightService
  /**
   * 新版宿主 client 用 ctx.get('workspaces'/'sessions') + exports.inject 声明才能
   * 取到服务（属性访问在新版 Loader 下不可见）。旧版回退 ctx[name]。
   */
  get?(name: string): unknown
  effect(callback: () => unknown, label?: string): void
}

/**
 * v9 桥接面：better-sidebar tab 宿主把当前会话的 composer 草稿写入能力暴露为
 * `conversation.input.for(sessionScope).setDraft(text)`（可见、可编辑、用户回车发送）。
 * 结构类型：不 import dsh-better-sidebar 类型（junction 无该包）。
 */
interface ConversationInputFace {
  for?(actx: unknown): {
    state?: { getSnapshot?(): { draft?: string } }
    setDraft?(text: string): void
    actions?: { setDraft?(text: string): void }
  } | undefined
}
interface ConversationFace { input?: ConversationInputFace }
/** sessions 真实运行时面（窄化 face 之外还有 create/open/refresh；全部特性检测）。 */
interface SessionServiceFace extends SessionFace {
  scope?(id: string): unknown
  /** Create or adopt a Session on the Host；返回新会话 id。 */
  create?(opts?: { workspaceId?: string; cwd?: string; sessionId?: string }): Promise<string>
  /** Select a session as current（UI 切到该会话）。 */
  open?(id: string): void
  refresh?(): Promise<void> | void
}

/**
 * 只声明本插件硬依赖的宿主服务：slots / sidebarRightTabs / sidebarRight（都在 0.2 的
 * ui-sidebar-right 里提供）。workspaces / sessions / conversation 继续用
 * ctx.get 惰性取，缺了只降级不置 INACTIVE。
 */
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight']

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
    const slots = ctx.slots
    const tabs = ctx.sidebarRightTabs
    const sidebarRight = ctx.sidebarRight
    if (!slots || !tabs) {
      // 0.1.x 宿主没有原生右侧栏（或本插件被放在无侧栏的壳里）：服务端那半
      // （wiki 工具 / HTTP 路由 / skill）不受影响，只是不挂 UI。
      console.info('[knj-obsidian] native right sidebar unavailable; skipping client UI')
      return () => { removeWikiStyles() }
    }
    // v8.1：防御性读取宿主工作区/会话运行时；不可用时降级为手动切换（不阻塞标签渲染）
    const workspaces = hostService<WorkspaceFace>(ctx, 'workspaces')
    const sessions = hostService<SessionServiceFace>(ctx, 'sessions')
    const conversation = hostService<ConversationFace>(ctx, 'conversation')
    /**
     * v11：把受限指令交给 Agent —— **新建一个会话**并预填指令（可见可编辑，用户回车发送）。
     * 返回 { ok:false, message } = 失败原因（UI 显示并退回复制）；ok:true 可带告警 message。
     * 宿主契约（dsh-api-session-controller client ISessions）：
     *   await sessions.create({ workspaceId, cwd }) → newId → sessions.open(newId)
     *   → 轮询 sessions.scope(newId) → conversation.input.for(actx)
     *   → input.state.getSnapshot()（物化输入态）→ input.setDraft(text) → 读回校验
     * 归属：先按库根从 workspaces 快照匹配 workspaceId 一并传入（只传 cwd 时宿主可能按“当前工作区”处理），
     * 创建后再从会话列表读回 cwd 校验，不一致时如实告警而不是假装成功。
     */
    const normalizePath = (p?: string): string =>
      (p ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

    const matchWorkspaceId = (root?: string): { id: string; title?: string } | undefined => {
      if (!root) return undefined
      try {
        const snap = workspaces?.list.getSnapshot() as { items?: ReadonlyArray<Record<string, unknown>> } | undefined
        const want = normalizePath(root)
        const hit = snap?.items?.find((w) => normalizePath(typeof w.path === 'string' ? w.path : undefined) === want)
        if (!hit) return undefined
        // 宿主契约字段是 workspaceId（旧版/窄化面可能给 id）
        const id = (typeof hit.workspaceId === 'string' && hit.workspaceId) || (typeof hit.id === 'string' && hit.id) || ''
        if (!id) {
          console.warn('[knj] workspace matched but has no id field; keys=', Object.keys(hit))
          return undefined
        }
        return { id, title: typeof hit.title === 'string' ? hit.title : undefined }
      } catch { return undefined }
    }

    const readSessionCwd = (id: string): string | undefined => {
      try {
        const snap = sessions?.list.getSnapshot() as { byId?: Record<string, { cwd?: string }>; items?: ReadonlyArray<{ id: string; cwd?: string }> } | undefined
        return snap?.byId?.[id]?.cwd ?? snap?.items?.find((s) => s.id === id)?.cwd
      } catch { return undefined }
    }

    /**
     * 解析当前库根对应的工作区 id：
     * 1) 先在工作区快照里按归一化路径匹配（可能需要等基线就绪，最多 ~2s）
     * 2) 匹配不到就调 workspaces.create({ path }) 把库根注册成工作区（幂等）
     * 都失败则返回 undefined（调用方据此只按 cwd 建会话并如实告警）。
     */
    const ensureWorkspaceId = async (root?: string): Promise<{ id: string; via: 'matched' | 'created' } | undefined> => {
      if (!root) return undefined
      const want = normalizePath(root)
      for (let i = 0; i < 20; i++) {
        const hit = matchWorkspaceId(root)
        if (hit) return { id: hit.id, via: 'matched' }
        const ready = (() => {
          try {
            const snap = workspaces?.list.getSnapshot() as { baselinesReady?: boolean; phase?: string } | undefined
            return Boolean(snap?.baselinesReady) || snap?.phase === 'ready'
          } catch { return false }
        })()
        if (ready) break
        await new Promise((r) => setTimeout(r, 100))
      }
      try {
        const created = await workspaces?.create?.({ path: root })
        const createdId = created ? ((created as Record<string, unknown>).workspaceId ?? (created as Record<string, unknown>).id) : undefined
        if (typeof createdId === 'string' && createdId) {
          console.info('[knj] workspace registered for vault root', { root, workspaceId: createdId })
          return { id: createdId, via: 'created' }
        }
      } catch (e) {
        console.warn('[knj] workspaces.create failed:', String(e))
      }
      void want
      return undefined
    }

    /** 读回新会话实际归属的工作区 id（工作区快照的 sessionIds 归属账；字段名 workspaceId/id 兼容）。 */
    const readSessionWorkspaceId = (id: string): string | undefined => {
      try {
        const snap = workspaces?.list.getSnapshot() as { items?: ReadonlyArray<Record<string, unknown>> } | undefined
        const hit = snap?.items?.find((w) => Array.isArray(w.sessionIds) && (w.sessionIds as readonly string[]).includes(id))
        if (!hit) return undefined
        const wsId = (typeof hit.workspaceId === 'string' && hit.workspaceId) || (typeof hit.id === 'string' && hit.id) || ''
        return wsId || undefined
      } catch { return undefined }
    }

    const startAgentSession = async (text: string, cwd?: string): Promise<{ ok: boolean; message?: string }> => {
      const fail = (reason: string): { ok: false; message: string } => {
        console.warn('[knj] startAgentSession failed:', reason)
        return { ok: false, message: reason }
      }
      try {
        if (!text) return fail('empty instruction')
        if (!sessions) return fail('host service "sessions" unavailable')
        if (typeof sessions.create !== 'function') return fail('sessions.create unavailable (host too old)')
        const workspace = await ensureWorkspaceId(cwd)
        let newId: string
        try {
          newId = await sessions.create(workspace ? { workspaceId: workspace.id, cwd } : (cwd ? { cwd } : {}))
        } catch (e) { return fail(`sessions.create threw: ${String(e)}`) }
        if (!newId) return fail('sessions.create returned no id')
        try { sessions.open?.(newId) } catch (e) { return fail(`sessions.open threw: ${String(e)}`) }
        try { await sessions.refresh?.() } catch { /* 列表刷新失败不影响预填 */ }

        // 归属校验：优先比对「会话挂在工作区下」（sessionIds），再退回 cwd 比对；拿不到实际值时不误报
        let mismatch = ''
        if (cwd) {
          const actualWs = readSessionWorkspaceId(newId)
          const actualCwd = readSessionCwd(newId)
          if (workspace && actualWs && actualWs !== workspace.id) {
            mismatch = `新会话工作区可能不对：期望工作区 ${workspace.id}，实际挂在 ${actualWs}`
          } else if (workspace && !actualWs) {
            mismatch = `新会话暂未出现在目标工作区（${workspace.id}）的会话列表下，请确认左侧工作区`
          } else if (!workspace && actualCwd && normalizePath(actualCwd) !== normalizePath(cwd)) {
            mismatch = `新会话工作区可能不对：期望 ${cwd}，实际 ${actualCwd}（未能把库根注册成工作区）`
          } else if (!workspace) {
            mismatch = `未能把 ${cwd} 注册/匹配成工作区，已按 cwd 创建新会话，请确认左侧工作区`
          }
        }

        // 新会话的作用域 / composer 输入面是懒挂载的：轮询 + 写入后**读回校验**（最多 ~6s）
        const marker = text.slice(0, 12)
        let lastErr = ''
        let draftSeen = ''
        let conversationCache: ConversationFace | undefined
        for (let i = 0; i < 40; i++) {
          let actx: unknown
          try { actx = sessions.scope?.(newId) } catch (e) { lastErr = `sessions.scope threw: ${String(e)}` }
          if (actx === undefined || actx === null) {
            lastErr = lastErr || `sessions.scope("${newId}") not available yet`
            await new Promise((r) => setTimeout(r, 150))
            continue
          }
          if (!conversationCache) {
            try { conversationCache = (typeof ctx.get === 'function' ? ctx.get('conversation') : undefined) as ConversationFace } catch (e) { lastErr = `ctx.get('conversation') threw: ${String(e)}` }
            if (!conversationCache) { lastErr = 'host service "conversation" unavailable via ctx.get'; await new Promise((r) => setTimeout(r, 150)); continue }
          }
          let input: ReturnType<NonNullable<ConversationInputFace['for']>> | undefined
          try { input = conversationCache.input?.for?.(actx) } catch (e) { lastErr = `conversation.input.for threw: ${String(e)}` }
          if (!input) { lastErr = 'conversation.input.for(scope) not available yet'; await new Promise((r) => setTimeout(r, 150)); continue }
          const setDraft = typeof input.setDraft === 'function' ? input.setDraft : input.actions?.setDraft
          if (typeof setDraft !== 'function') { lastErr = 'no setDraft on input face'; await new Promise((r) => setTimeout(r, 150)); continue }
          // 规范顺序：先物化输入态（getSnapshot），再写 draft（否则新 shell 内部 projection 未就绪）
          try { input.state?.getSnapshot?.() } catch (e) { lastErr = `input.state.getSnapshot threw: ${String(e)}` }
          try { setDraft.call(input, text) } catch (e) { lastErr = `setDraft threw: ${String(e)}` }
          try {
            const draft = input.state?.getSnapshot?.()?.draft ?? ''
            draftSeen = draft.slice(0, 60)
            if (draft.includes(marker)) {
              console.info('[knj] startAgentSession: prefill verified', {
                sessionId: newId,
                workspaceId: workspace?.id,
                workspaceVia: workspace?.via,
                actualWorkspaceId: readSessionWorkspaceId(newId),
                cwd,
                attempt: i + 1,
              })
              return { ok: true, message: mismatch || undefined }
            }
            // 用户已经开始在这个新会话里输入（草稿非空且不含我们的标记）→ 立即停手，
            // 不要再 setDraft 覆盖他刚敲的字。仅从第二轮起判定：第一轮刚写完，
            // 非空但无标记更可能是写入未生效（继续重试而不是误报“用户输入”）。
            if (i > 0 && draft.trim() !== '') {
              console.warn('[knj] startAgentSession: user typing detected, stop prefill retries', { sessionId: newId, draft: draft.slice(0, 40) })
              return { ok: true, message: `检测到新会话里已有你的输入，已停止自动预填（指令请用「复制触发指令」）${mismatch ? '；' + mismatch : ''}` }
            }
            lastErr = lastErr || `draft not observed after setDraft (draft="${draftSeen}")`
          } catch (e) { lastErr = `readback threw: ${String(e)}` }
          await new Promise((r) => setTimeout(r, 150))
        }
        return fail(`prefill not verified after retries (lastError=${lastErr}; draftSeen="${draftSeen}")`)
      } catch (e) {
        return fail(`unexpected: ${String(e)}`)
      }
    }
    const disposers: Array<() => void> = []
    /** 点侧栏里的笔记/图谱节点 → 按 kind 开一个「笔记」页，种子走 params（id|category + 标题）。 */
    const openNote = (id: string, category: string, title: string): void => {
      if (!sidebarRight) {
        console.warn('[knj-obsidian] ctx.sidebarRight 不可用，无法打开笔记工作台')
        return
      }
      try {
        sidebarRight.openTab(NOTE_TAB, { params: { path: `${id}|${category}`, title } })
      } catch (e) {
        console.warn('[knj-obsidian] openTab(note) failed:', String(e))
      }
    }

    /** 从 seat props 里读回 openTab 带过来的导航参数（navigation.params）。 */
    const readParams = (props: PaneTabProps): Record<string, unknown> | undefined => {
      try {
        return props.useTabInfo?.()?.tab?.navigation?.params
      } catch {
        // 未提交的 tab 会抛：此时按"无参数"降级，不炸整个面板
        return undefined
      }
    }

    /** 笔记工作台内容：读 params.path（id|category），交给 NoteWorkbench。 */
    const NoteBody = (props: PaneTabProps) => {
      const params = readParams(props)
      const path = typeof params?.path === 'string' ? params.path : undefined
      return h(NoteWorkbench, { path, onPagesChanged: () => { /* 侧栏树下次展开时再拉 */ } })
    }

    /** 笔记页签的动态标题：用 params.title（缺省回落到注册时捕获的「笔记」）。 */
    const NoteTitle = (props: PaneTabProps) => {
      const params = readParams(props)
      const title = typeof params?.title === 'string' && params.title ? params.title : '笔记'
      return h('span', null, title)
    }

    // ---- 类型定义（tab 的静态面：身份 id / 判别式 kind / 标题 / 引导卡片）----
    const disposeWikiType = tabs.register({
      id: WIKI_TAB,
      kind: WIKI_TAB,
      priority: 'extension',
      title: () => '知识库',
      guide: [
        {
          id: 'wiki',
          order: 10,
          title: () => '知识库',
          description: () => '浏览 / 图谱 / 知识蒸馏（dsh-knj-obsidian）',
        },
      ],
    })
    if (typeof disposeWikiType === 'function') disposers.push(disposeWikiType)

    // 笔记是"由侧栏点击打开"的页，不进引导页（无 guide）；multiple 让每篇笔记各自一页。
    const disposeNoteType = tabs.register({
      id: NOTE_TAB,
      kind: NOTE_TAB,
      priority: 'extension',
      multiple: true,
      title: () => '笔记',
    })
    if (typeof disposeNoteType === 'function') disposers.push(disposeNoteType)

    // ---- 内容面板：`sidebar.right.pane.tab` keyed seat，key 就是类型定义的 id ----
    const disposeWikiBody = slots.inject('sidebar.right.pane.tab', () =>
      slots.register({ name: 'sidebar.right.pane.tab', key: WIKI_TAB }, () =>
        h(WikiSidebar, { openNote, workspaces, sessions, startAgentSession }),
      ),
    )
    if (typeof disposeWikiBody === 'function') disposers.push(disposeWikiBody)

    const disposeNoteBody = slots.inject('sidebar.right.pane.tab', () =>
      slots.register({ name: 'sidebar.right.pane.tab', key: NOTE_TAB }, NoteBody),
    )
    if (typeof disposeNoteBody === 'function') disposers.push(disposeNoteBody)

    // 页签标题 seat（可选）：让每篇笔记的 chip 显示笔记名而不是笼统的「笔记」。
    const disposeNoteTitle = slots.inject('sidebar.right.pane.tab.title', () =>
      slots.register({ name: 'sidebar.right.pane.tab.title', key: NOTE_TAB }, NoteTitle),
    )
    if (typeof disposeNoteTitle === 'function') disposers.push(disposeNoteTitle)

    return () => {
      for (const d of disposers) d()
      // 卸载/HMR 时移除注入的 <style>，避免旧版本 CSS 常驻 DOM
      removeWikiStyles()
    }
  }, 'dsh-knj-obsidian: sidebar tabs')
}
