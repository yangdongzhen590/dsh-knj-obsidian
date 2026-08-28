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
  // workspaceRegistry：宿主工作区注册表（dsh-workspace），用于自动发现各工作区的库
  ctx.inject(['tools', 'webServer', 'workspaceRegistry'], (hostCtx: Context) => {
    const host = hostCtx as unknown as WikiHost
    // 防御性读取：即使注入后也容忍服务异常，失败仅回退 cwd 单库
    let workspaceRoots: Array<{ path: string; title?: string }> = []
    try {
      const registry = (hostCtx as unknown as { workspaceRegistry?: WorkspaceRegistryLike }).workspaceRegistry
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
