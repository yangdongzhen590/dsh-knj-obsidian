// src/tools.ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { VaultStore } from './vault-store.ts'
import type { VaultProvider } from './types.ts'
import type { WikiCategory, Confidence, WikiPage } from './types.ts'
import { lintVault } from './lint.ts'
import { retrieve } from './retriever.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildGraph, exportGraphHtml } from './graph-engine.ts'
import { mineEnums, mineTables } from './code-miner.ts'
import { readProgress, markModule, pendingModules, progressFileFor } from './mining-progress.ts'

/** wiki_mine 输出的表候选 items（dbNew/dbChanged/dbUnchanged/tables 共用）。 */
const TABLE_ITEM_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    table: { type: 'string' }, module: { type: 'string' }, file: { type: 'string' },
    line: { type: 'number' }, hash: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' } },
    columns: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string' }, type: { type: 'string' },
          nullable: { type: 'boolean' }, comment: { type: 'string' },
          primaryKey: { type: 'boolean' }, line: { type: 'number' },
        },
      },
    },
    indexes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string' }, columns: { type: 'array', items: { type: 'string' } },
          unique: { type: 'boolean' }, line: { type: 'number' },
        },
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          from: { type: 'string' }, toTable: { type: 'string' },
          toColumn: { type: 'string' }, line: { type: 'number' },
        },
      },
    },
    comment: { type: 'string' },
  },
} as const

/** 每个工具执行时解析当前库（v7：agent 工具跟随 UI 切换的当前库）。 */
function currentStore(provider: VaultProvider): VaultStore {
  return provider.current() as VaultStore
}

export function mountTools(ctx: Context, provider: VaultProvider): () => void {
  ctx.tools.register(defineTool({
    name: 'wiki_ingest',
    description: '把 agent 提取好的知识页写入项目 wiki（.wiki/）。入参 pages 为页面数组；source 为源材料标识。同一 source 重新导入时覆盖更新（保留 frontmatter 的 created，更新 updated）；库内已有同 id 页面但来自不同 source 时不覆盖，自动加 -2/-3 后缀新建（防止跨源静默丢失旧内容）。传入 contentHash（源内容 SHA-256）且与 manifest 记录一致时整体跳过本次 ingest。',
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
            category: { type: 'string', required: true, enum: ['concepts', 'entities', 'references', 'synthesis', 'projects', 'dictionaries', 'tables'] },
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
      const store = currentStore(provider)
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
        // 跨源同 id 冲突避让（与 importer.ts 语义一致）：旧页来自别的 source 时不覆盖——
        // 覆盖会让旧源内容静默丢失，且旧源在 manifest 里的 content_hash 仍匹配，重导被 skip，无恢复路径。
        let id = p.id
        let reused = existing // 用于保留 created 的已有页（同源原 id，或本源的 -N 页）
        if (existing && existing.source !== args.source) {
          // 先复用「本 source 已建立的 -N 页」更新，找不到才在第一个空后缀新建。
          // 否则本 source 每次重导都再避让一次 → -3/-4/-5… 无限膨胀、旧页陈旧。
          let own: WikiPage | null = null
          let free = ''
          for (let suffix = 2; !own && !free; suffix++) {
            const candidate = store.readPage(`${p.id}-${suffix}`, cat)
            if (!candidate) free = `${p.id}-${suffix}`
            else if (candidate.source === args.source) own = candidate
          }
          if (own) { id = own.id; reused = own }
          else id = free
        }
        const page = {
          id,
          title: p.title,
          category: cat,
          tags: p.tags ?? [],
          source: args.source,
          confidence: conf,
          created: reused && reused.source === args.source ? reused.created : now,
          updated: now,
          body: p.body,
        }
        const res = store.writePage(page)
        if (res.created) created.push(id); else updated.push(id)
        produced.push(id)
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
      category: { type: 'string', enum: ['concepts', 'entities', 'references', 'synthesis', 'projects', 'dictionaries', 'tables'] },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { page: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `已沉淀到 ${value.page}` }],
    },
    async execute(args) {
      const store = currentStore(provider)
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
      return lintVault(currentStore(provider))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_query',
    description: '从项目 wiki（.wiki/）检索知识。分层：L1 index 快速层（index-only 模式）→ L2 标题/标签 → L3 正文 → L4 wikilink 图谱邻居。只读，不修改任何页面。返回候选页面与引用，答案由调用者基于候选合成。',
    parameters: {
      query: { type: 'string', required: true, description: '检索词' },
      mode: { type: 'string', enum: ['auto', 'index-only'], description: 'auto=分层检索；index-only=只查 index.md（快速）' },
      maxCandidates: { type: 'number', description: '最多返回候选数（默认 10）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          candidates: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                page: { type: 'string', required: true },
                id: { type: 'string', required: true },
                category: { type: 'string', required: true },
                title: { type: 'string', required: true },
                confidence: { type: 'string', required: true },
                snippet: { type: 'string', required: true },
                matchedBy: { type: 'string', required: true },
              },
            },
          },
          strategy: { type: 'string', required: true },
          totalPages: { type: 'number', required: true },
        },
      },
      render: (_args, value) => value.candidates.length === 0
        ? [{ type: 'text', text: `wiki 无匹配（${value.totalPages} 页）。可以说「把 XX 吸收进 wiki」来添加知识。` }]
        : [{ type: 'text', text: `检索到 ${value.candidates.length} 条候选（${value.strategy}）：${value.candidates.map((c) => c.id).join('、')}` }],
    },
    async execute(args) {
      return retrieve(currentStore(provider), args.query, {
        mode: args.mode === 'index-only' ? 'index-only' : 'auto',
        maxCandidates: args.maxCandidates ?? 10,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_export',
    description: '把 wiki 的 wikilink 图谱导出为 graph.json（结构化数据）或 graph.html（单文件交互可视化，浏览器可开）。写入 <项目根>/.wiki/wiki-export/，返回路径相对 .wiki/。',
    parameters: {
      format: { type: 'string', enum: ['html', 'json'], description: 'html=交互图谱；json=结构化图数据' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          file: { type: 'string', required: true },
          nodeCount: { type: 'number', required: true },
          edgeCount: { type: 'number', required: true },
        },
      },
      render: (_args, value) => {
        const base = `图谱已导出：${value.nodeCount} 节点 / ${value.edgeCount} 边 → ${value.file}`
        // FM1：空 vault / <2 页 → 导出仍成功，但附加图谱过小提示（spec 失败模式承诺）
        const hint = value.nodeCount < 2 ? ' 图谱过小（<2 页），图谱意义有限——先吸收几份文档再导出' : ''
        return [{ type: 'text', text: base + hint }]
      },
    },
    async execute(args) {
      const store = currentStore(provider)
      const format = args.format === 'json' ? 'json' : 'html'
      const graph = buildGraph(store)
      const exportDir = join(store.wikiRoot, 'wiki-export')
      mkdirSync(exportDir, { recursive: true })
      const file = format === 'json' ? 'graph.json' : 'graph.html'
      const content = format === 'json' ? JSON.stringify(graph, null, 2) : exportGraphHtml(graph)
      writeFileSync(join(exportDir, file), content, 'utf8')
      return { file: `wiki-export/${file}`, nodeCount: graph.nodes.length, edgeCount: graph.edges.length }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wiki_mine',
    description: '从当前工作区项目静态挖掘代码结构候选（枚举字典/表结构），供蒸馏后经 wiki_ingest 入库。大纲→细节两阶段；每次运行输出枚举级对账报告（new/changed/unchanged/deleted）：未挖=new、挖过无变=unchanged、有变化=changed、代码已删=deleted。resume 时按 progress.json 只处理未完成模块，断点续传。',
    parameters: {
      kind: { type: 'string', enum: ['enum', 'db', 'both'], description: '挖掘类型：enum=枚举字典；db=表结构（M2 实现）；both=两者' },
      module: { type: 'string', description: '模块过滤（可选）：只挖指定模块' },
      resume: { type: 'boolean', description: '断点续传：读 progress.json 只处理 pending/partial 模块' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          enums: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string' }, module: { type: 'string' }, file: { type: 'string' },
                line: { type: 'number' }, kind: { type: 'string' }, hash: { type: 'string' },
                values: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      name: { type: 'string' }, code: { type: 'string' },
                      label: { type: 'string' }, line: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
          new: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string' }, module: { type: 'string' }, file: { type: 'string' },
                line: { type: 'number' }, kind: { type: 'string' }, hash: { type: 'string' },
                values: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      name: { type: 'string' }, code: { type: 'string' },
                      label: { type: 'string' }, line: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
          changed: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string' }, module: { type: 'string' }, file: { type: 'string' },
                line: { type: 'number' }, kind: { type: 'string' }, hash: { type: 'string' },
                values: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      name: { type: 'string' }, code: { type: 'string' },
                      label: { type: 'string' }, line: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
          unchanged: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string' }, module: { type: 'string' }, file: { type: 'string' },
                line: { type: 'number' }, kind: { type: 'string' }, hash: { type: 'string' },
                values: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      name: { type: 'string' }, code: { type: 'string' },
                      label: { type: 'string' }, line: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
          deleted: { type: 'array', items: { type: 'string' }, required: true },
          tables: { type: 'array', required: true, items: TABLE_ITEM_SCHEMA },
          dbNew: { type: 'array', required: true, items: TABLE_ITEM_SCHEMA },
          dbChanged: { type: 'array', required: true, items: TABLE_ITEM_SCHEMA },
          dbUnchanged: { type: 'array', required: true, items: TABLE_ITEM_SCHEMA },
          dbDeleted: { type: 'array', items: { type: 'string' }, required: true },
          outline: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                module: { type: 'string' }, fileCount: { type: 'number' }, enumEstimate: { type: 'number' },
              },
            },
          },
          modules: { type: 'array', items: { type: 'string' }, required: true },
          remaining: { type: 'number', required: true },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const enumPart = value.enums.length > 0 ? `枚举 ${value.new.length} 新 · ${value.changed.length} 变 · ${value.unchanged.length} 无变 · ${value.deleted.length} 删` : ''
        const dbPart = value.tables.length > 0 ? `表 ${value.dbNew.length} 新 · ${value.dbChanged.length} 变 · ${value.dbUnchanged.length} 无变 · ${value.dbDeleted.length} 删` : ''
        const base = `挖掘：${value.modules.length} 模块 / ${[enumPart, dbPart].filter(Boolean).join('；')}，剩 ${value.remaining} 模块待挖`
        return [{ type: 'text', text: value.enums.length === 0 && value.tables.length === 0 && value.deleted.length === 0 && value.dbDeleted.length === 0 ? `${base}（${value.note ?? ''}）` : base }]
      },
    },
    async execute(args) {
      const store = currentStore(provider)
      const projectRoot = join(store.wikiRoot, '..') // .wiki 的父目录 = 项目根
      const kind = args.kind ?? 'both'
      const progressFile = progressFileFor(store.wikiRoot, 'enum')
      const progress = readProgress(progressFile, 'enum')
      const resumeOnly = args.resume ? new Set(pendingModules(progress)) : null

      // ---- 枚举分支 ----
      const enumResult = (kind === 'enum' || kind === 'both')
        ? mineEnums(projectRoot, args.module)
        : { enums: [], outline: [], modules: [] }
      let enums = enumResult.enums
      if (resumeOnly && enums.length > 0) enums = enums.filter((e) => resumeOnly.has(e.module))
      const newE: typeof enums = []
      const changedE: typeof enums = []
      const unchangedE: typeof enums = []
      const scannedFiles = new Set(enums.map((e) => e.file))
      for (const e of enums) {
        const prev = store.manifestEntry(`mine:enum:${e.file}`)
        if (!prev) newE.push(e)
        else if (prev.content_hash === e.hash) unchangedE.push(e)
        else changedE.push(e)
      }
      const deleted: string[] = []
      for (const src of store.manifestSources()) {
        if (src.startsWith('mine:enum:') && !scannedFiles.has(src.slice('mine:enum:'.length))) {
          deleted.push(src.slice('mine:enum:'.length))
        }
      }

      // ---- 表结构分支（M2） ----
      const tableResult = (kind === 'db' || kind === 'both')
        ? mineTables(projectRoot, args.module)
        : { tables: [], outline: [], modules: [] }
      let tables = tableResult.tables
      if (resumeOnly && tables.length > 0) tables = tables.filter((t) => resumeOnly.has(t.module))
      const dbNew: typeof tables = []
      const dbChanged: typeof tables = []
      const dbUnchanged: typeof tables = []
      const scannedDbFiles = new Set(tables.map((t) => t.file))
      for (const t of tables) {
        const prev = store.manifestEntry(`mine:db:${t.file}`)
        if (!prev) dbNew.push(t)
        else if (prev.content_hash === t.hash) dbUnchanged.push(t)
        else dbChanged.push(t)
      }
      const dbDeleted: string[] = []
      for (const src of store.manifestSources()) {
        if (src.startsWith('mine:db:') && !scannedDbFiles.has(src.slice('mine:db:'.length))) {
          dbDeleted.push(src.slice('mine:db:'.length))
        }
      }

      const note = enums.length === 0 && deleted.length === 0 && tables.length === 0 && dbDeleted.length === 0
        ? '当前项目未发现枚举/常量类或数据库表结构' : undefined
      return {
        enums, new: newE, changed: changedE, unchanged: unchangedE, deleted,
        tables, dbNew, dbChanged, dbUnchanged, dbDeleted,
        outline: [...enumResult.outline, ...tableResult.outline],
        modules: [...enumResult.modules, ...tableResult.modules],
        remaining: resumeOnly ? resumeOnly.size : (enumResult.modules.length + tableResult.modules.length), note,
      }
    },
  }))

  return () => {}
}
