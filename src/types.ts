// src/types.ts
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/** 由规范化 root 派生的稳定 vault id（跨进程一致）。 */
export function vaultIdOf(root: string): string {
  return 'v-' + createHash('sha1').update(resolve(root)).digest('hex').slice(0, 12)
}

export type WikiCategory = 'concepts' | 'entities' | 'references' | 'synthesis' | 'projects' | 'dictionaries' | 'tables'

export type Confidence = 'extracted' | 'inferred' | 'ambiguous'

/**
 * 页面重要性分层（frontmatter `tier:`）。检索打分按此加权：
 * core 1.3 / supporting 1.0 / peripheral 0.7；缺省或无法识别的值一律视为 supporting。
 */
export type WikiTier = 'core' | 'supporting' | 'peripheral'

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
  /**
   * 一句话摘要（frontmatter `summary:`）。本地检索打分与外部工具（obsidian-wiki
   * graph-query 的 index_only 快路径）都读它，缺了就没有摘要能力。
   * 写入端缺省时由 writePage 从正文首行派生；**读取端不派生**——磁盘上没有该字段
   * 就按「无摘要」处理，与外部读者看到的一致。
   */
  summary?: string
  /** 重要性分层（frontmatter `tier:`），检索打分的权重来源。缺省视为 supporting。 */
  tier?: WikiTier
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

/** vault 列表条目（含只读页数与是否已初始化 .wiki，供「内容规模」与初始化引导展示） */
export interface VaultListEntry extends VaultRecord {
  pageCount: number
  /** 磁盘上是否已有 .wiki（注册 ≠ 建库；未初始化时 UI 提供初始化入口） */
  initialized: boolean
}

/**
 * vault 存取面：路由/工具统一通过它拿「当前库」。
 * VaultStore 自身是单库实现（current() 返回自身）；VaultManager 是多库实现。
 */
export interface VaultProvider {
  current(): VaultStoreLike
  /** 只读路径专用（GET 端点/检索）：返回的 store 绝不触发 ensure()/mkdir 写副作用。 */
  currentReadonly(): VaultStoreLike
  currentRecord(): VaultRecord | null
  listVaults(): VaultListEntry[]
  /** 多库专有：切换 / 按目录激活 / 新建挂接 / 移除（单库实现无这些方法） */
  switchVault?(id: string): VaultRecord | null
  activateRoot?(root: string): VaultRecord
  attachRoot?(root: string, name?: string): VaultRecord
  removeVault?(id: string): boolean
  /**
   * 会话级绑定（P0，2026-10-21）：按会话 cwd 只读解析库（零写盘；未注册/无 .wiki 返回 undefined）。
   * 工具侧与触发层（trigger.ts 的 L0）共用同一语义：**给了 cwd 解析不出库绝不回退全局当前库**——
   * 回退正是「在 A 工作区问 A 的事、被 B 库答偏」的来源（实测见 .wiki/concepts/会话级知识库绑定）。
   */
  readonlyVaultForRoot?(root: string): { store: VaultStoreLike; name: string } | undefined
  /** 注册表里按根查库（拿展示名与来源；零写盘）。会话级作用域下用于回填 current 信息。 */
  recordForRoot?(root: string): VaultRecord | undefined
  /**
   * 为某个根确保库可写（wiki_init 专用）：注册（**不抢占全局当前库**）+ ensure 脚手架。
   * 与 attachRoot 的区别：attach 是用户显式动作、会把当前库切过去；本方法服务于
   * 「会话在自己工作区里初始化库」，不应改变别的会话/UI 看到的当前库。
   */
  ensureVaultAt?(root: string): VaultStoreLike
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
