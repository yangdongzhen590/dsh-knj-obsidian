// src/tools.ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { VaultStore } from './vault-store.ts'
import type { WikiCategory, Confidence } from './types.ts'
import { lintVault } from './lint.ts'

export function mountTools(ctx: Context, store: VaultStore): () => void {
  ctx.tools.register(defineTool({
    name: 'wiki_ingest',
    description: '把 agent 提取好的知识页写入项目 wiki（.wiki/）。入参 pages 为页面数组；source 为源材料标识。存在同 id 页面时合并正文（保留 frontmatter 的 created，更新 updated）。传入 contentHash（源内容 SHA-256）且与 manifest 记录一致时整体跳过本次 ingest。',
    parameters: {
      source: { type: 'string', required: true, description: '源材料标识：文件路径 / URL / agent:<source>' },
      contentHash: { type: 'string', description: '源内容 SHA-256；与 manifest 记录一致时跳过本次 ingest' },
      pages: {
        type: 'array', required: true, description: '提取出的页面',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', required: true, description: 'kebab-case 稳定 id' },
            title: { type: 'string', required: true },
            category: { type: 'string', required: true, enum: ['concepts', 'entities', 'references', 'synthesis', 'projects'] },
            tags: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'string', enum: ['extracted', 'inferred', 'ambiguous'] },
            body: { type: 'string', required: true, description: 'markdown 正文，不含 frontmatter' },
          },
          additionalProperties: false,
        },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          created: { type: 'array', items: { type: 'string' }, required: true },
          updated: { type: 'array', items: { type: 'string' }, required: true },
          skipped: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => value.skipped
        ? [{ type: 'text', text: '内容未变化，跳过本次 ingest' }]
        : [{ type: 'text', text: `写入 wiki：新建 ${value.created.length} 页，更新 ${value.updated.length} 页` }],
    },
    async execute(args) {
      if (args.contentHash) {
        const prev = store.manifestEntry(args.source)
        if (prev && prev.content_hash === args.contentHash) {
          return { created: [], updated: [], skipped: true }
        }
      }
      const created: string[] = []
      const updated: string[] = []
      const now = new Date().toISOString()
      const produced: string[] = []
      for (const p of args.pages) {
        const cat = p.category as WikiCategory
        const conf = (p.confidence ?? 'extracted') as Confidence
        const existing = store.readPage(p.id, cat)
        const page = {
          id: p.id,
          title: p.title,
          category: cat,
          tags: p.tags ?? [],
          source: args.source,
          confidence: conf,
          created: existing?.created ?? now,
          updated: now,
          body: p.body,
        }
        const res = store.writePage(page)
        if (res.created) created.push(p.id); else updated.push(p.id)
        produced.push(p.id)
      }
      const hash = args.contentHash ?? store.sha256(args.source + JSON.stringify(args.pages))
      store.updateManifest(args.source, {
        content_hash: hash,
        last_ingested: now,
        pages_produced: produced,
      })
      return { created, updated, skipped: false }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_capture',
    description: '把当前讨论沉淀成一条知识页（quick 模式写入 references/ 单页）。',
    parameters: {
      title: { type: 'string', required: true },
      body: { type: 'string', required: true, description: '声明式知识内容（非对话记录）' },
      category: { type: 'string', enum: ['concepts', 'entities', 'references', 'synthesis', 'projects'] },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { page: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `已沉淀到 ${value.page}` }],
    },
    async execute(args) {
      const now = new Date().toISOString()
      // kebab-case（保留 CJK 字符）：id 直接用作文件名，VaultStore 校验通过即可
      const id = args.title.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '') || `note-${Date.now()}`
      const cat = (args.category ?? 'references') as WikiCategory
      store.writePage({
        id, title: args.title, category: cat, tags: [], source: 'agent:capture',
        confidence: 'inferred', created: now, updated: now, body: args.body,
      })
      return { page: `${cat}/${id}.md` }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_lint',
    description: '检查 wiki 健康度：孤儿页、断链（[[wikilink]] 指向不存在页）、缺 frontmatter。',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          orphans: { type: 'array', items: { type: 'string' }, required: true },
          brokenLinks: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                from: { type: 'string', required: true },
                target: { type: 'string', required: true },
              },
            },
          },
          missingFrontmatter: { type: 'array', items: { type: 'string' }, required: true },
          pageCount: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `lint：${value.pageCount} 页，孤儿 ${value.orphans.length}，断链 ${value.brokenLinks.length}，缺 frontmatter ${value.missingFrontmatter.length}` }],
    },
    async execute() {
      return lintVault(store)
    },
  }))

  return () => {}
}
