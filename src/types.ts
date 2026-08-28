// src/types.ts
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/** 由规范化 root 派生的稳定 vault id（跨进程一致）。 */
export function vaultIdOf(root: string): string {
  return 'v-' + createHash('sha1').update(resolve(root)).digest('hex').slice(0, 12)
}

export type WikiCategory = 'concepts' | 'entities' | 'references' | 'synthesis' | 'projects'

export type Confidence = 'extracted' | 'inferred' | 'ambiguous'

export interface WikiPage {
  /** 稳定 id（通常为文件 basename 去扩展名，kebab-case） */
  id: string
  title: string
  category: WikiCategory
  tags: string[]
  /** 来源：文件路径 / URL / agent:<capture-source> */
  source: string
  confidence: Confidence
  created: string
  updated: string
  /** markdown 正文（不含 frontmatter） */
  body: string
}

export interface ManifestEntry {
  /** SHA-256 源内容哈希，增量跳过的主信号 */
  content_hash: string
  last_ingested: string
  /** 本源产出的页面 id 列表 */
  pages_produced: string[]
}

export interface VaultManifest {
  version: 1
  sources: Record<string, ManifestEntry>
}

/** 单个 vault 的注册信息（root = 项目根目录，.wiki 位于其下）。 */
export interface VaultRecord {
  /** 稳定 id（由规范化的 root 派生，跨进程稳定） */
  id: string
  /** 展示名（默认取目录 basename，可显式命名） */
  name: string
  /** vault 根目录绝对路径（含 .wiki 的项目目录） */
  root: string
  /** 来源：cwd=宿主启动目录种子；workspace=工作区自动发现；attached=用户显式新建/挂接 */
  source: 'cwd' | 'workspace' | 'attached'
}

/** vault 列表条目（含只读页数，供「内容规模」展示） */
export interface VaultListEntry extends VaultRecord {
  pageCount: number
}

/**
 * vault 存取面：路由/工具统一通过它拿「当前库」。
 * VaultStore 自身是单库实现（current() 返回自身）；VaultManager 是多库实现。
 */
export interface VaultProvider {
  current(): VaultStoreLike
  currentRecord(): VaultRecord | null
  listVaults(): VaultListEntry[]
  /** 多库专有：切换 / 按目录激活 / 新建挂接 / 移除（单库实现无这些方法） */
  switchVault?(id: string): VaultRecord | null
  activateRoot?(root: string): VaultRecord
  attachRoot?(root: string, name?: string): VaultRecord
  removeVault?(id: string): boolean
}

/**
 * VaultStore 暴露给路由/工具的最小面（避免 types.ts 反向依赖 vault-store 成环）。
 * 路由内通过 provider.current() 后按 VaultStore 的公开方法调用（duck typing）。
 */
export interface VaultStoreLike {
  readonly wikiRoot: string
  ensure(): void
  listPages(): { id: string; category: WikiCategory; title: string }[]
  listPagesReadonly(): { id: string; category: WikiCategory; title: string }[]
  readPage(id: string, category: WikiCategory): WikiPage | null
  readRawPage(id: string, category: WikiCategory): string | null
  saveRawPage(id: string, category: WikiCategory, rawText: string): WikiPage
  writePage(page: WikiPage): { created: boolean }
  manifestEntry(source: string): ManifestEntry | undefined
  updateManifest(source: string, entry: ManifestEntry): void
  sha256(text: string): string
}
