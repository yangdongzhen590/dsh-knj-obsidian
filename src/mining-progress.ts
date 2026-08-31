// src/mining-progress.ts
// 断点续传：模块级进度（pending/done/partial）。每模块完成后写回，
// 中断最多丢一个模块。文件落 vault _raw/_tools/progress-<kind>.json。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type MiningKind = 'enum' | 'db'
export type ModuleStateValue = 'pending' | 'done' | 'partial'

export interface ModuleState {
  state: ModuleStateValue
  updatedAt: string
}

export interface MiningProgress {
  version: 1
  kind: MiningKind
  modules: Record<string, ModuleState>
}

export function readProgress(progressFile: string, kind: MiningKind): MiningProgress {
  if (existsSync(progressFile)) {
    try {
      const parsed = JSON.parse(readFileSync(progressFile, 'utf8')) as MiningProgress
      if (parsed.version === 1 && parsed.kind === kind) return parsed
    } catch { /* 损坏文件按空进度处理 */ }
  }
  return { version: 1, kind, modules: {} }
}

export function markModule(progress: MiningProgress, module: string, state: ModuleStateValue, progressFile: string): void {
  progress.modules[module] = { state, updatedAt: new Date().toISOString() }
  writeFileSync(progressFile, JSON.stringify(progress, null, 2), 'utf8')
}

export function pendingModules(progress: MiningProgress): string[] {
  return Object.entries(progress.modules)
    .filter(([, s]) => s.state === 'pending' || s.state === 'partial')
    .map(([m]) => m)
}

export function progressFileFor(wikiRoot: string, kind: MiningKind): string {
  return join(wikiRoot, '_raw', '_tools', `progress-${kind}.json`)
}
