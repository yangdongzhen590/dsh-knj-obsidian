// src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { VaultStore } from './vault-store.ts'
import { mountTools } from './tools.ts'

export const name = 'dsh-knj-obsidian'

export interface Config {
  /** vault 目录名（默认 .wiki）。v1 未实现：apply 忽略 config，目录名为 vault-store 硬编码常量；v2 接入。 */
  vaultDirName?: string
}

export function apply(ctx: Context, _config?: Config): void {
  ctx.inject(['tools'], (hostCtx: Context) => {
    const store = new VaultStore(process.cwd())
    store.ensure()
    const disposeTools = mountTools(hostCtx, store)
    return () => disposeTools()
  })
}
