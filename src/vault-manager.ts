// src/vault-manager.ts
// v7 多 vault 管理：注册表（持久化）+ 当前库切换 + 新建/挂接/移除 + 工作区自动发现。
// 注册表只记录库的「身份与指向」，绝不移动/删除磁盘上的库文件。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
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
}

function defaultNameFor(root: string, seeds: WorkspaceSeed[]): string {
  const r = resolve(root)
  const hit = seeds.find((s) => resolve(s.path) === r)
  if (hit?.title?.trim()) return hit.title.trim()
  return basename(r) || r
}

export class VaultManager implements VaultProvider {
  private registry: RegistryFile = { version: 1, currentVaultId: null, vaults: [] }
  private readonly seeds: WorkspaceSeed[]

  constructor(private readonly opts: VaultManagerOptions) {
    this.seeds = opts.workspaceRoots ?? []
    this.load()
    this.seed()
    this.persist()
  }

  // ---------- 持久化 ----------

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
        }
      }
    } catch {
      // 损坏的注册表从空重建，不崩
    }
  }

  private persist(): void {
    mkdirSync(join(this.opts.registryFile, '..'), { recursive: true })
    writeFileSync(this.opts.registryFile, JSON.stringify(this.registry, null, 2), 'utf8')
  }

  // ---------- 种子（幂等，每次启动执行） ----------

  private seed(): void {
    const add = (root: string, source: VaultRecord['source']): void => {
      const r = resolve(root)
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
  }

  // ---------- VaultProvider ----------

  listVaults(): VaultListEntry[] {
    return this.registry.vaults.map((v) => ({ ...v, pageCount: this.countPages(v.root) }))
  }

  currentRecord(): VaultRecord | null {
    return this.find(this.registry.currentVaultId) ?? this.registry.vaults[0] ?? null
  }

  current(): VaultStore {
    const rec = this.currentRecord()
    if (!rec) {
      // 防御：seed 后至少存在 cwd 库；仍兜底直接以 cwd 建库
      const fallback = new VaultStore(this.opts.cwdRoot)
      fallback.ensure()
      return fallback
    }
    const store = new VaultStore(rec.root)
    store.ensure()
    return store
  }

  switchVault(id: string): VaultRecord | null {
    const rec = this.find(id)
    if (!rec) return null
    this.registry.currentVaultId = rec.id
    this.persist()
    return rec
  }

  activateRoot(root: string): VaultRecord {
    const r = resolve(root)
    const existing = this.registry.vaults.find((v) => resolve(v.root) === r)
    const rec = existing ?? this.attachRoot(r)
    this.registry.currentVaultId = rec.id
    this.persist()
    return rec
  }

  attachRoot(root: string, name?: string): VaultRecord {
    const r = resolve(root)
    // 目录不存在 → 自动创建（新建库）；已存在 → 直接挂接。库文件永不删除/移动。
    if (!existsSync(r)) mkdirSync(r, { recursive: true })
    new VaultStore(r).ensure() // 脚手架 .wiki（index/manifest/分类目录，零页面）
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
    // 工作区/cwd 种子库是「真实存在的库」，只允许从列表移除显式挂接的库
    if (this.registry.vaults[idx].source !== 'attached') return false
    this.registry.vaults.splice(idx, 1)
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
      return new VaultStore(root).listPagesReadonly().length
    } catch {
      return 0
    }
  }
}
