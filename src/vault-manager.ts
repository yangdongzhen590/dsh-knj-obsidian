// src/vault-manager.ts
// v7 多 vault 管理：注册表（持久化）+ 当前库切换 + 新建/挂接/移除 + 工作区自动发现。
// 注册表只记录库的「身份与指向」，绝不移动/删除磁盘上的库文件。
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { VaultStore } from './vault-store.ts'
import { vaultIdOf } from './types.ts'
import type { VaultListEntry, VaultProvider, VaultRecord } from './types.ts'

/** 宿主工作区种子（path=工作区根目录，title=展示名） */
export interface WorkspaceSeed {
  path: string
  title?: string
}

export interface VaultManagerOptions {
  /** 注册表文件路径（默认 <DSH_HOME|~/.dsh>/knj-obsidian/vaults.json） */
  registryFile: string
  /** 宿主进程启动目录（cwd 种子，保证「打开就有库」） */
  cwdRoot: string
  /** 宿主工作区列表（自动发现每个工作区的库） */
  workspaceRoots?: WorkspaceSeed[]
}

interface RegistryFile {
  version: 1
  currentVaultId: string | null
  vaults: VaultRecord[]
  /** 用户显式移除过的库根目录（resolve 后）：种子每次启动都会重加，必须记住移除决定 */
  removedRoots?: string[]
}

function defaultNameFor(root: string, seeds: WorkspaceSeed[]): string {
  const r = resolve(root)
  const hit = seeds.find((s) => resolve(s.path) === r)
  if (hit?.title?.trim()) return hit.title.trim()
  return basename(r) || r
}

/**
 * 从某个目录向上找最近的 `.wiki`（含自身），但**不得越过注册过的工作区/库根边界**。
 *
 * 为什么需要它：会话的 `header.cwd` 是**会话工作目录**，而库在工作区根；cwd 可能是子目录。
 * 只按 cwd 精确匹配根会漏掉「在子目录里跑会话」这种常见情况，于是提示又变成沉默/答偏。
 *
 * 为什么必须有边界（2026-09-28 实测踩到）：无边界时会一路走到 `C:\Users\<user>\.wiki`
 * ——用户的 home 本身被宿主注册成了「工作区库」，于是「在 A 项目里问 A 的事」被 home 库命中。
 * 边界规则（自内向外，先到先判）：
 *   - 命中 .wiki → 就是它；
 *   - 命中「已注册的根」（工作区或库）却没 .wiki → 该工作区没有库，**不再向外走**；
 *   - 走到盘符根/上限 → 没有。
 *
 * @param from - 起始目录（绝对路径）
 * @param boundaryOf - 已注册根（resolve 后）的集合；undefined = 不设边界（仅限测试/单库场景）
 * @returns 含 `.wiki` 的最近祖先目录；找不到返回 undefined
 */
export function nearestVaultRoot(from: string, boundaryOf?: ReadonlySet<string>): string | undefined {
  let current = resolve(from)
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(current, '.wiki'))) return current
    if (boundaryOf?.has(current)) return undefined
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}

export class VaultManager implements VaultProvider {
  private registry: RegistryFile = { version: 1, currentVaultId: null, vaults: [] }
  private readonly seeds: WorkspaceSeed[]
  /** root → VaultStore 复用：VaultStore 携带 mtime 页缓存，按请求新建实例会让缓存永远失效 */
  private readonly stores = new Map<string, VaultStore>()

  constructor(private readonly opts: VaultManagerOptions) {
    this.seeds = opts.workspaceRoots ?? []
    this.load()
    this.seed()
  }

  // ---------- 持久化（tmp+rename 原子写；仅内容变化时写盘） ----------

  private load(): void {
    try {
      if (!existsSync(this.opts.registryFile)) return
      const raw = JSON.parse(readFileSync(this.opts.registryFile, 'utf8')) as Partial<RegistryFile>
      if (raw && Array.isArray(raw.vaults)) {
        this.registry = {
          version: 1,
          currentVaultId: typeof raw.currentVaultId === 'string' ? raw.currentVaultId : null,
          // 过滤畸形条目（root 必须存在）；id 缺失/不合法时按根重算
          vaults: raw.vaults
            .filter((v): v is VaultRecord => !!v && typeof v.root === 'string' && typeof v.name === 'string')
            .map((v) => ({ id: vaultIdOf(v.root), name: v.name, root: resolve(v.root), source: v.source })),
          removedRoots: Array.isArray(raw.removedRoots) ? raw.removedRoots.filter((r) => typeof r === 'string') : [],
        }
      }
    } catch {
      // 损坏的注册表从空重建，不崩
    }
  }

  /** 原子写：tmp + rename（崩溃不会留下截断的半份注册表；Windows rename 被占用时回退直接写）。 */
  private persist(): void {
    mkdirSync(dirname(this.opts.registryFile), { recursive: true })
    const json = JSON.stringify(this.registry, null, 2)
    const tmp = this.opts.registryFile + '.tmp-' + Date.now()
    writeFileSync(tmp, json, 'utf8')
    try {
      renameSync(tmp, this.opts.registryFile)
    } catch {
      try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
      writeFileSync(this.opts.registryFile, json, 'utf8')
    }
  }

  private persistIfChanged(before: string): void {
    if (JSON.stringify(this.registry) !== before) this.persist()
  }

  // ---------- 种子（幂等，每次启动执行；尊重 removedRoots 的移除决定） ----------

  private seed(): void {
    const before = JSON.stringify(this.registry)
    const removed = new Set((this.registry.removedRoots ?? []).map((r) => resolve(r)))
    const add = (root: string, source: VaultRecord['source']): void => {
      const r = resolve(root)
      if (removed.has(r)) return
      if (this.registry.vaults.some((v) => resolve(v.root) === r)) return
      this.registry.vaults.push({ id: vaultIdOf(r), name: defaultNameFor(r, this.seeds), root: r, source })
    }
    add(this.opts.cwdRoot, 'cwd')
    for (const w of this.seeds) {
      // 目录已消失的已注册工作区跳过，避免幽灵库
      if (!existsSync(w.path)) continue
      add(w.path, 'workspace')
    }
    const current = this.registry.vaults.find((v) => v.id === this.registry.currentVaultId)
    if (!current) {
      const first = this.registry.vaults.find((v) => resolve(v.root) === resolve(this.opts.cwdRoot)) ?? this.registry.vaults[0]
      this.registry.currentVaultId = first?.id ?? null
    }
    this.persistIfChanged(before)
  }

  // ---------- VaultProvider ----------

  listVaults(): VaultListEntry[] {
    return this.registry.vaults.map((v) => ({
      ...v,
      pageCount: this.countPages(v.root),
      // 未初始化 = 磁盘上还没有 .wiki（注册≠建库；初始化只由显式动作或首次写入触发）
      initialized: existsSync(join(v.root, '.wiki')),
    }))
  }

  currentRecord(): VaultRecord | null {
    return this.find(this.registry.currentVaultId) ?? this.registry.vaults[0] ?? null
  }

  /** 按根取复用的 VaultStore（首次创建时可选 ensure 脚手架）。 */
  private storeFor(root: string, ensure: boolean): VaultStore {
    const r = resolve(root)
    let store = this.stores.get(r)
    if (!store) {
      store = new VaultStore(r)
      this.stores.set(r, store)
      if (ensure) store.ensure()
    }
    return store
  }

  current(): VaultStore {
    const rec = this.currentRecord()
    if (!rec) {
      // 防御：seed 后至少存在 cwd 库；仍兜底直接以 cwd 建库
      return this.storeFor(this.opts.cwdRoot, true)
    }
    return this.storeFor(rec.root, true)
  }

  /** 只读视图：返回复用 store，绝不 ensure()/mkdir（GET 端点零写副作用）。 */
  currentReadonly(): VaultStore {
    const rec = this.currentRecord()
    if (!rec) return this.storeFor(this.opts.cwdRoot, false)
    return this.storeFor(rec.root, false)
  }

  /**
   * 按目录取**只读**库（会话级绑定用，L0）。
   *
   * 契约（与 currentReadonly 同族，比它更严）：**零写盘**——不 ensure()、不建目录、不写注册表。
   * 这是必要的：会话级绑定发生在 `agent/session-start`，如果它会写盘，等在一个还没有知识库的
   * 工作区里就会凭空长出 `.wiki` 和 7 个分类目录（trigger.ts 的只读契约明确禁止）。
   *
   * 解析顺序：
   *   1) 已注册的库根（拿注册名）；
   *   2) 向上找最近的 `.wiki`（cwd 常是工作区子目录）；
   *   3) 磁盘上确实存在 `.wiki` 的根（未注册也能用，名取目录名）。
   *
   * @param root - 会话工作目录（绝对路径）
   * @returns 只读库 + 展示名；无库返回 undefined
   */
  readonlyVaultForRoot(root: string): { store: VaultStore; name: string } | undefined {
    const r = resolve(root)
    const registered = this.registry.vaults.find((v) => resolve(v.root) === r)
    if (registered && existsSync(join(registered.root, '.wiki'))) {
      return { store: this.storeFor(registered.root, false), name: registered.name }
    }
    const nearest = nearestVaultRoot(r, this.knownRoots())
    if (!nearest) return undefined
    const hit = this.registry.vaults.find((v) => resolve(v.root) === nearest)
    return {
      store: this.storeFor(nearest, false),
      name: hit?.name ?? defaultNameFor(nearest, this.seeds),
    }
  }

  /** 向上查找的边界：所有已注册的库根 + 工作区种子（都不会被越过）。 */
  private knownRoots(): Set<string> {
    const roots = new Set<string>()
    roots.add(resolve(this.opts.cwdRoot))
    for (const v of this.registry.vaults) roots.add(resolve(v.root))
    for (const s of this.seeds) roots.add(resolve(s.path))
    return roots
  }

  /** 注册表里按根查库（拿展示名；零写盘）。 */
  recordForRoot(root: string): VaultRecord | undefined {
    const r = resolve(root)
    return this.registry.vaults.find((v) => resolve(v.root) === r)
  }

  switchVault(id: string): VaultRecord | null {
    const rec = this.find(id)
    if (!rec) return null
    this.registry.currentVaultId = rec.id
    this.persist()
    return rec
  }

  /**
   * 自动跟随（工作区激活）：只注册 + 切换当前库，**不写盘建库**。
   * 建库是显式动作（边栏「初始化知识库」→ agent 调 wiki_init，或用户显式挂接/首次真实写入）。
   */
  activateRoot(root: string): VaultRecord {
    const r = resolve(root)
    const existing = this.registry.vaults.find((v) => resolve(v.root) === r)
    const rec = existing ?? this.registerRoot(r)
    this.registry.currentVaultId = rec.id
    this.persist()
    return rec
  }

  /** 只登记进注册表（零写盘）：未注册目录的自动发现路径用。makeCurrent=false 供 ensureVaultAt（不抢占全局当前库）。 */
  private registerRoot(root: string, name?: string, makeCurrent = true): VaultRecord {
    const r = resolve(root)
    const removed = this.registry.removedRoots ?? []
    if (removed.some((x) => resolve(x) === r)) {
      this.registry.removedRoots = removed.filter((x) => resolve(x) !== r)
    }
    const already = this.registry.vaults.find((v) => resolve(v.root) === r)
    if (already) return already
    const rec: VaultRecord = { id: vaultIdOf(r), name: name?.trim() || basename(r) || r, root: r, source: 'workspace' }
    this.registry.vaults.push(rec)
    if (makeCurrent) this.registry.currentVaultId = rec.id
    this.persist()
    return rec
  }

  /**
   * 会话级绑定（P0）：为某个根确保库可写——注册（不抢占全局当前库）+ ensure 脚手架。
   *
   * wiki_init 在会话工作区里初始化库时用：注册是必要的（否则边栏看不到、下次启动种子也不含它），
   * 但**绝不**像 attachRoot/registerRoot 默认那样把 currentVaultId 切过去——那是全局单值，
   * 切了就会把其它工作区会话（以及依赖 currentReadonly 的 UI 路径）一起带偏，
   * 正是 [[会话级知识库绑定]] 记录的「内存/磁盘不一致」家族问题的另一半。
   */
  ensureVaultAt(root: string): VaultStore {
    const r = resolve(root)
    const existing = this.registry.vaults.find((v) => resolve(v.root) === r)
    if (!existing) this.registerRoot(r, undefined, false)
    return this.storeFor(r, true)
  }

  attachRoot(root: string, name?: string): VaultRecord {
    const r = resolve(root)
    // 目录不存在 → 自动创建（新建库）；已存在 → 直接挂接。库文件永不删除/移动。
    if (!existsSync(r)) mkdirSync(r, { recursive: true })
    this.storeFor(r, true).ensure() // 脚手架 .wiki（index/manifest/分类目录，零页面）
    // 显式挂接是最强的回来意图：清除历史移除标记
    const removed = this.registry.removedRoots ?? []
    if (removed.some((x) => resolve(x) === r)) {
      this.registry.removedRoots = removed.filter((x) => resolve(x) !== r)
    }
    const existing = this.registry.vaults.find((v) => resolve(v.root) === r)
    if (existing) {
      if (name?.trim()) {
        existing.name = name.trim()
        this.persist()
      }
      return existing
    }
    const rec: VaultRecord = { id: vaultIdOf(r), name: name?.trim() || basename(r) || r, root: r, source: 'attached' }
    this.registry.vaults.push(rec)
    this.registry.currentVaultId = rec.id
    this.persist()
    return rec
  }

  removeVault(id: string): boolean {
    const idx = this.registry.vaults.findIndex((v) => v.id === id)
    if (idx === -1) return false
    // 任何来源的库都可移除：cwd/workspace 种子每次启动会重新尝试加入，
    // 因此把根目录记入 removedRoots 才能让移除在重启后仍然生效（显式 attach 可解除）。
    const removedRoot = resolve(this.registry.vaults[idx].root)
    this.registry.vaults.splice(idx, 1)
    this.registry.removedRoots = [...(this.registry.removedRoots ?? []), removedRoot]
    if (this.registry.currentVaultId === id) {
      this.registry.currentVaultId = this.registry.vaults[0]?.id ?? null
    }
    this.persist()
    return true
  }

  // ---------- 内部 ----------

  private find(id: string | null): VaultRecord | undefined {
    if (!id) return undefined
    return this.registry.vaults.find((v) => v.id === id)
  }

  private countPages(root: string): number {
    try {
      return this.storeFor(root, false).listPagesReadonly().length
    } catch {
      return 0
    }
  }
}
