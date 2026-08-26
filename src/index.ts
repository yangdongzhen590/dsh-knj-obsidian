// src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { VaultStore } from './vault-store.ts'
import { mountTools } from './tools.ts'
import { mountWikiRoutes, type WikiHost } from './routes.ts'

export const name = 'dsh-knj-obsidian'

export interface Config {
  /** vault 目录名（默认 .wiki）。v1 未实现：apply 忽略 config，目录名为 vault-store 硬编码常量；v2 接入。 */
  vaultDirName?: string
}

export function apply(ctx: Context, _config?: Config): void {
  ctx.inject(['tools', 'webServer'], (hostCtx: Context) => {
    const host = hostCtx as unknown as WikiHost
    const store = new VaultStore(process.cwd())
    store.ensure()
    const disposeTools = mountTools(hostCtx, store)
    const disposeRoutes = mountWikiRoutes(host, store)
    return () => {
      disposeTools()
      disposeRoutes()
    }
  })
}
