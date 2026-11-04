// src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { VaultManager } from './vault-manager.ts'
import { mountTools } from './tools.ts'
import { mountWikiRoutes, type WikiHost } from './routes.ts'
import { installTrigger, type TriggerHost } from './trigger.ts'
import { mountSkillProvider } from './skill-provider.ts'

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

/** 读包自身版本（lib/index.js → ../package.json）：避免版本号在代码里再抄一份。 */
function pluginVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    return (JSON.parse(raw) as { version?: string }).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export function apply(ctx: Context, config?: Config): void {
  // 启动自检（2026.11.12 起）：本包**不再**声明 @deepseek-ai/dsh-llm|dsh-tools 的 peerDependency
  // —— 那两条在预发布宿主（如 0.2.1-rc.5）上必然让 npm 安装期 ERESOLVE，而对运行时毫无作用。
  // 代价是安装期不再有版本闸门，所以这一行成为唯一的可观测信号：
  // **插件没被加载时它不会出现**（例如 Cordis 因 package.json 带 BOM 静默跳过整个 bundle）。
  console.log(`[dsh-knj-obsidian] v${pluginVersion()} loaded (node ${process.version}, cwd ${process.cwd()})`)
  // skill 注册：包内 5 个 skill 只有注册过才进模型 catalog（详见 src/skill-provider.ts）。
  // 刻意用**独立的** ctx.inject(['skills'])：'skills' 绝不并入下面那支 inject——
  // 硬依赖缺失会让该 entry 置 INACTIVE，连带 tools/routes/trigger 一起静默失效；
  // 独立注入最坏只是 skill 不可见（provider 内部还会吞掉异常）。
  const disposeSkills = mountSkillProvider(ctx)
  // ⚠️ workspaceRegistry 是「可选」依赖，绝不能写进 inject 数组：cordis 对硬依赖缺失的
  // entry 置 INACTIVE，回调永不执行——routes 和 tools 会整体静默失效（宿主改名/移除该服务时）。
  // tools/webServer 由官方 base bundles 保证提供，是安全的核心依赖。
  ctx.inject(['tools', 'webServer'], (hostCtx: Context) => {
    const host = hostCtx as unknown as WikiHost
    // 防御性读取 workspaceRegistry：注入后容忍服务异常/缺失，失败仅回退 cwd 单库。
    // 传**取值函数**而不是数组快照：宿主工作区会在运行期新增，快照之外的新工作区不是
    // 查找边界，它下面的 cwd 会越过它命中祖先库（评审 2026-11-05 P1-3）。
    const workspaceSeeds = (): Array<{ path: string; title?: string }> => {
      try {
        const withGet = hostCtx as unknown as { workspaceRegistry?: WorkspaceRegistryLike; get?: (name: string) => unknown }
        const registry = withGet.workspaceRegistry
          ?? (typeof withGet.get === 'function' ? withGet.get('workspaceRegistry') as WorkspaceRegistryLike | undefined : undefined)
        return registry?.list() ?? []
      } catch {
        // 宿主未提供 workspaceRegistry：仅 cwd 种子，不阻塞启动
        return []
      }
    }
    const manager = new VaultManager({
      registryFile: config?.vaultRegistryFile ?? defaultRegistryPath(),
      cwdRoot: process.cwd(),
      workspaceRoots: workspaceSeeds,
    })
    const disposeTools = mountTools(hostCtx, manager)
    const disposeRoutes = mountWikiRoutes(host, manager)
    // 任务级知识触发（L1）+ 回合级沉淀提醒（L5）：只读、不阻断，KNJ_OBSIDIAN_TRIGGER=off 可关。
    const disposeTrigger = installTrigger(hostCtx as unknown as TriggerHost, manager)
    return () => {
      disposeTools()
      disposeRoutes()
      disposeTrigger()
      disposeSkills()
    }
  })
}
