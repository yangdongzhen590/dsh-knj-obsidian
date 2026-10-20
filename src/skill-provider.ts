// src/skill-provider.ts
/**
 * 把包内随发的 skill bundle（wiki-collect / wiki-mine / wiki-distill / wiki-init / wiki-query）
 * 注册进宿主 skill registry。
 *
 * 为什么必须有它：DSH 的 filesystem skill provider 只扫 5 个本地根
 * （`<项目根>/.dsh/skills`、`<项目根>/.agents/skills`、customSkillDirs、`~/.dsh/skills`、`~/.agents/skills`），
 * 且**不发现嵌套的 `**\/SKILL.md`**；本包把 skill 放在包根各自目录下，不注册就永远进不了模型 catalog
 * （GUI 触发指令把规则内联进提示词，所以功能"看着能用"，skill 本体对模型不可见）。
 *
 * 优先级：rank = `BUNDLED_SKILL_RANK`(600)，低于用户根(400)/项目根(100)。
 * 因此本地或项目里的同名副本优先，包内版本只做兜底，且随插件升级自动更新兜底版本。
 *
 * 失败语义（刻意选静默降级）：单个 bundle 缺失/解析失败只跳过该条并 warn；
 * `skills` 服务缺失或注册抛错只让 skill 不可见，**绝不影响 tools / routes / trigger**
 * （因此 `'skills'` 绝不加进顶层 inject 数组——cordis 对硬依赖缺失的 entry 置 INACTIVE）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

/** 与 `@deepseek-ai/dsh-skill` 的 `BUNDLED_SKILL_RANK` 同值；硬编码以免为取一个常量新增 peerDep。 */
export const BUNDLED_SKILL_RANK = 600

/** provider 名（宿主 skill registry 内的唯一标识）。 */
export const SKILL_PROVIDER_NAME = 'dsh-knj-obsidian'

/**
 * 随包分发的 skill bundle 目录（相对包根）。
 * 白名单而非"把包根交给 filesystem provider"：包根还有 `README.md`、`taxonomy.base.md`，
 * 会被按 flat `<name>.md` 扫成 skill 并每轮产生非法名警告。
 */
export const SKILL_BUNDLE_DIRS: readonly string[] = [
  'wiki-collect',
  'wiki-mine',
  'wiki-distill',
  'wiki-init',
  'wiki-query',
  'wiki-capability',
]

/** skill 名规范（与宿主 filesystem provider 一致）。 */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 宽松布尔词表：与宿主同语义（`true/false`、`yes/no`、`on/off`、`1/0`，大小写不敏感）。 */
const BOOLEAN_TOKENS: Record<string, boolean> = {
  true: true,
  yes: true,
  on: true,
  '1': true,
  false: false,
  no: false,
  off: false,
  '0': false,
}

export interface SkillInvocation {
  /** false = 不进模型 catalog（只留人类斜杠命令）。 */
  modelInvocable: boolean
  /** false = 不出现在人类命令面板。 */
  userInvocable: boolean
}

export interface SkillBundle {
  name: string
  description: string
  invocation: SkillInvocation
  /** bundle 目录（作为 resourceBase，供 SKILL.md 里按相对路径取用同目录资源）。 */
  dir: string
  /** SKILL.md 绝对路径。 */
  path: string
  /** 去掉 frontmatter 后的正文。 */
  body: string
}

export type SkillWarn = (message: string) => void

const defaultWarn: SkillWarn = (message) => {
  console.warn(`[${SKILL_PROVIDER_NAME}] ${message}`)
}

/**
 * 包根：本模块编译后位于 `<包根>/lib/`，开发期位于 `<包根>/src/`，上一级即包根。
 * @returns 包根绝对路径
 */
export function packageRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url))
}

interface Frontmatter {
  data: Record<string, string | boolean>
  body: string
}

/**
 * 极简 frontmatter 解析：只覆盖本包 5 个 SKILL.md 的写法
 * （`name` / `description`（含 `>` 折叠块）/ 可选两个布尔键），不引入 yaml 依赖，
 * 页内其它 YAML 一概不解析。
 * @param raw - 文件全文
 * @returns 解析结果；无合法 frontmatter 时 undefined
 */
export function parseFrontmatter(raw: string): Frontmatter | undefined {
  const lines = raw.split(/\r?\n/)
  if (lines[0] !== '---') return undefined
  let closing = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') {
      closing = i
      break
    }
  }
  if (closing < 0) return undefined

  const data: Record<string, string | boolean> = {}
  let i = 1
  while (i < closing) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(lines[i] ?? '')
    if (!match) {
      i += 1
      continue
    }
    const key = match[1] ?? ''
    let value = (match[2] ?? '').trim()
    i += 1
    if (value === '>' || value === '|') {
      const block: string[] = []
      while (i < closing && ((lines[i] ?? '').trim() === '' || /^[ \t]/.test(lines[i] ?? ''))) {
        block.push((lines[i] ?? '').trim())
        i += 1
      }
      value = value === '>' ? block.join(' ').trim() : block.join('\n').trim()
      data[key] = value
      continue
    }
    data[key] = coerceValue(value)
  }
  return { data, body: lines.slice(closing + 1).join('\n').trim() }
}

/** 去引号 + 布尔词表匹配；未登记的词原样当字符串返回（由调用方决定是否算非法）。 */
function coerceValue(value: string): string | boolean {
  const unquoted = /^(['"])(.*)\1$/.exec(value)?.[2] ?? value
  const lowered = unquoted.trim().toLowerCase()
  if (lowered in BOOLEAN_TOKENS) return BOOLEAN_TOKENS[lowered] as boolean
  return unquoted
}

function asString(value: string | boolean | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

type BooleanRead = { ok: true; value: boolean | undefined } | { ok: false }

/** 严格布尔：给了值但不是布尔词表里的写法即非法（宁可不注册，也不默默放行）。 */
function readBoolean(
  value: string | boolean | undefined,
  key: string,
  label: string,
  warn: SkillWarn,
): BooleanRead {
  if (value === undefined) return { ok: true, value: undefined }
  if (typeof value === 'boolean') return { ok: true, value }
  warn(`跳过 ${label}：${key} 的值 "${value}" 不是布尔（支持 true/false、yes/no、on/off、1/0）`)
  return { ok: false }
}

/**
 * 读取 5 个白名单 bundle（每个目录一个 SKILL.md）。
 * 单个失败只跳过该条并 warn——不抛错，保证插件其余功能不受影响。
 * @param root - 包根（测试可传夹具目录）
 * @param dirs - bundle 目录白名单（测试可缩小）
 * @param warn - 警告出口
 * @returns 按 name 升序的 bundle 列表
 */
export function readSkillBundles(
  root: string,
  dirs: readonly string[] = SKILL_BUNDLE_DIRS,
  warn: SkillWarn = defaultWarn,
): SkillBundle[] {
  const bundles: SkillBundle[] = []
  for (const dir of dirs) {
    const skillPath = join(root, dir, 'SKILL.md')
    let raw: string
    try {
      raw = readFileSync(skillPath, 'utf8')
    } catch {
      warn(`跳过 ${dir}：读不到 ${skillPath}`)
      continue
    }
    const parsed = parseFrontmatter(raw)
    if (parsed === undefined) {
      warn(`跳过 ${dir}：${skillPath} 缺少合法 frontmatter`)
      continue
    }
    const name = asString(parsed.data.name)
    const description = asString(parsed.data.description)
    if (name === undefined || description === undefined) {
      warn(`跳过 ${dir}：frontmatter 需要非空的 name 与 description`)
      continue
    }
    if (!SKILL_NAME_RE.test(name)) {
      warn(`跳过 ${dir}：非法 skill 名 "${name}"`)
      continue
    }
    const modelFlag = readBoolean(parsed.data['disable-model-invocation'], 'disable-model-invocation', dir, warn)
    if (!modelFlag.ok) continue
    const userFlag = readBoolean(parsed.data['user-invocable'], 'user-invocable', dir, warn)
    if (!userFlag.ok) continue
    bundles.push({
      name,
      description,
      invocation: {
        modelInvocable: modelFlag.value !== true,
        userInvocable: userFlag.value !== false,
      },
      dir: join(root, dir),
      path: skillPath,
      body: parsed.body,
    })
  }
  return bundles.sort((left, right) => left.name.localeCompare(right.name))
}

/** 宿主 `ctx.skills` 的候选/定义形状（只声明用到的字段，避免新增 peerDep）。 */
function toCandidate(bundle: SkillBundle): Record<string, unknown> {
  return {
    name: bundle.name,
    description: bundle.description,
    invocation: bundle.invocation,
    provider: SKILL_PROVIDER_NAME,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: bundle.dir },
    rank: BUNDLED_SKILL_RANK,
    locator: bundle.path,
    path: bundle.path,
  }
}

/**
 * 构造 provider（每次 discovery/get 重新读盘，改 SKILL.md 无需重启）。
 * @param root - 包根
 * @param warn - 警告出口
 */
export function createSkillProvider(root: string, warn: SkillWarn = defaultWarn): {
  name: string
  list: () => Promise<Array<Record<string, unknown>>>
  get: (candidate: { name?: string } | undefined) => Promise<Record<string, unknown> | undefined>
} {
  return {
    name: SKILL_PROVIDER_NAME,
    async list() {
      return readSkillBundles(root, SKILL_BUNDLE_DIRS, warn).map(toCandidate)
    },
    async get(candidate) {
      const bundle = readSkillBundles(root, SKILL_BUNDLE_DIRS, warn)
        .find((entry) => entry.name === candidate?.name)
      if (bundle === undefined) return undefined
      return { ...toCandidate(bundle), content: bundle.body }
    },
  }
}

export interface MountSkillProviderOptions {
  /** 包根覆盖（测试用）。 */
  root?: string
  /** 警告出口覆盖（测试用）。 */
  warn?: SkillWarn
}

/**
 * 挂载 skill provider：独立的 `ctx.inject(['skills'])`，与 tools/routes 互不牵连。
 * @param ctx - 插件 context（apply 期）
 * @param options - 包根/警告出口覆盖
 * @returns dispose（卸载 provider；失败也不抛错）
 */
export function mountSkillProvider(ctx: Context, options: MountSkillProviderOptions = {}): () => void {
  const root = options.root ?? packageRoot()
  const warn = options.warn ?? defaultWarn
  let dispose: (() => void) | undefined
  /** `registerProvider` 返回的注销函数（真实注册表契约：返回 `() => void`）。 */
  let unregister: (() => void) | undefined
  try {
    const inject = (ctx as unknown as {
      inject?: (deps: string[], callback: (injected: Context) => unknown) => unknown
    }).inject
    if (typeof inject !== 'function') {
      warn('宿主未提供 ctx.inject，跳过 skill 注册（tools/routes 不受影响）')
      return () => {}
    }
    const maybeDispose = inject.call(ctx, ['skills'], (skillCtx: Context) => {
      try {
        const registry = (skillCtx as unknown as {
          skills?: { registerProvider?: (factory: () => unknown) => unknown }
        }).skills
        if (registry === undefined || typeof registry.registerProvider !== 'function') {
          warn('skills 服务不可用：skill 不可见（tools/routes 不受影响）')
          return undefined
        }
        const maybeUnregister = registry.registerProvider(() => createSkillProvider(root, warn))
        if (typeof maybeUnregister === 'function') unregister = maybeUnregister as () => void
      } catch (error) {
        warn(`skill 注册失败（tools/routes 不受影响）：${error instanceof Error ? error.message : String(error)}`)
      }
      return undefined
    })
    if (typeof maybeDispose === 'function') dispose = maybeDispose as () => void
  } catch (error) {
    warn(`skill 注入失败（tools/routes 不受影响）：${error instanceof Error ? error.message : String(error)}`)
  }
  return () => {
    try {
      unregister?.()
    } catch {
      // 注销失败不影响其它清理
    }
    try {
      dispose?.()
    } catch {
      // 卸载失败不影响其它清理
    }
  }
}
