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
