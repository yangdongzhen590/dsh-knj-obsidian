/**
 * Session -> knowledge-base root resolution (pure, unit-testable).
 *
 * Why this file exists (2026-10-24): the sidebar used to follow the host
 * workspace via `sessions.list.getSnapshot().current` + `workspaces.list.
 * getSnapshot().recentWorkspaceId`. Neither field exists in DSH 0.2's client
 * snapshots (SessionListState = ids/byId/phase/projectionsBySession;
 * WorkspaceState = items/archivedSessionIds/pinnedSessionIds/state/phase/error),
 * so the follow step silently resolved to `undefined` and the panel stayed on
 * whatever global vault it had. The 0.2-native way is: the sidebar tab seat is
 * session-scoped and injects `sessionId` + a `useSessions` store hook; the
 * session row carries `cwd`. This module turns that into the workspace root.
 */

/** Minimal structural face of a DSH 0.2 workspace row (fields we rely on). */
export interface WorkspaceViewLike {
  workspaceId?: string
  id?: string
  title?: string
  path?: string
  sessionIds?: readonly string[]
}

/** Path comparison key: Windows case/separator insensitive, no trailing slash. */
export function normalizeRoot(path?: string): string {
  return (path ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export interface SessionRootInput {
  /** Current sidebar session id (injected by the 0.2 pane-tab seat). */
  sessionId?: string
  /** cwd of that session (from the sessions store, live). */
  cwd?: string
  /** Host workspace rows (from the workspaces service snapshot). */
  workspaces?: readonly WorkspaceViewLike[]
}

/**
 * Resolve the workspace root that a session's sidebar should read.
 *
 * Order:
 *   1. the workspace row that accounts the session (`sessionIds` contains it)
 *      -> that row's path (authoritative: a session may be re-homed);
 *   2. the deepest tracked workspace that is an ancestor of the session cwd
 *      (session cwd is often a subdirectory of the workspace);
 *   3. the cwd itself (an unregistered directory still gets its own answer).
 *
 * Returns undefined when the session has neither an owning workspace nor a cwd:
 * callers must then keep the old global behaviour instead of guessing.
 */
export function resolveSessionRoot(input: SessionRootInput): string | undefined {
  const items = input.workspaces ?? []
  const sessionId = (input.sessionId ?? '').trim()
  if (sessionId) {
    const owning = items.find((w) => Array.isArray(w.sessionIds) && w.sessionIds.includes(sessionId))
    if (owning && typeof owning.path === 'string' && owning.path.trim()) return owning.path
  }
  const cwd = (input.cwd ?? '').trim()
  if (!cwd) return undefined
  const key = normalizeRoot(cwd)
  let best: string | undefined
  let bestLength = -1
  for (const w of items) {
    if (typeof w.path !== 'string') continue
    const p = normalizeRoot(w.path)
    if (!p) continue
    if (key === p || key.startsWith(`${p}/`)) {
      if (p.length > bestLength) { best = w.path; bestLength = p.length }
    }
  }
  return best ?? cwd
}
