import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-knj-obsidian'

export interface Config {
  /** vault 目录名（默认 .wiki） */
  vaultDirName?: string
}

export function apply(ctx: Context, _config?: Config): void {
  ctx.inject(['tools'], (hostCtx: Context) => {
    // v1 工具在 Task 4-6 注册
    return () => {}
  })
}
