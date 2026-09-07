// src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { VaultManager } from './vault-manager.ts'
import { mountTools } from './tools.ts'
import { mountWikiRoutes, type WikiHost } from './routes.ts'

export const name = 'dsh-knj-obsidian'

export interface Config {
  /** vault 目录名（默认 .wiki）。v1 未实现：apply 忽略 config，目录名为 vault-store 硬编码常量；v2 接入。 */
  vaultDirName?: string
  /** vault 注册表文件路径（v7；默认 <DSH_HOME|~/.dsh>/knj-obsidian/vaults.json） */
  vaultRegistryFile?: string
}

/** 宿主工作区注册表（防御性读取；无此服务时回退 cwd 单库）。 */
interface WorkspaceRegistryLike {
  list(): Array<{ path: string; title?: string }>
}

function defaultRegistryPath(): string {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(dshHome, 'knj-obsidian', 'vaults.json')
}

export function apply(ctx: Context, config?: Config): void {
  // ⚠️ workspaceRegistry 是「可选」依赖，绝不能写进 inject 数组：cordis 对硬依赖缺失的
  // entry 置 INACTIVE，回调永不执行——routes 和 tools 会整体静默失效（宿主改名/移除该服务时）。
  // tools/webServer 由官方 base bundles 保证提供，是安全的核心依赖。
  ctx.inject(['tools', 'webServer'], (hostCtx: Context) => {
    const host = hostCtx as unknown as WikiHost
    // 防御性读取 workspaceRegistry：注入后容忍服务异常/缺失，失败仅回退 cwd 单库
    let workspaceRoots: Array<{ path: string; title?: string }> = []
    try {
      const withGet = hostCtx as unknown as { workspaceRegistry?: WorkspaceRegistryLike; get?: (name: string) => unknown }
      const registry = withGet.workspaceRegistry
        ?? (typeof withGet.get === 'function' ? withGet.get('workspaceRegistry') as WorkspaceRegistryLike | undefined : undefined)
      workspaceRoots = registry?.list() ?? []
    } catch {
      // 宿主未提供 workspaceRegistry：仅 cwd 种子，不阻塞启动
    }
    const manager = new VaultManager({
      registryFile: config?.vaultRegistryFile ?? defaultRegistryPath(),
      cwdRoot: process.cwd(),
      workspaceRoots,
    })
    const disposeTools = mountTools(hostCtx, manager)
    const disposeRoutes = mountWikiRoutes(host, manager)
    return () => {
      disposeTools()
      disposeRoutes()
    }
  })
}
