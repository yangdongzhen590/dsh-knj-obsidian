/**
 * 主库 + N 子库（2026-10-25）。
 *
 * 模型：本机唯一**主库**（默认 `~/.dsh/.wiki`）放跨项目通用知识；各工作区 `.wiki` 是**子库**，
 * 放项目知识。检索先匹配本工作区子库，候选不足时才扩主库（只补召回，不抢子库排序）。
 *
 * 为什么单独成模块：开关、默认主库位置、合并规则都是纯决策，工具层/路由/触发层共用同一份，
 * 不各写一遍（三次实现三次漂移是这类功能最常见的回归来源）。
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { RetrievalResult } from './retriever.ts'

/** 总开关：`off` 关闭主库能力（不注册、不扩展、UI 不显示）。默认开启。 */
export const SUBVAULTS_ENV = 'KNJ_OBSIDIAN_SUBVAULTS'
/** 主库位置覆盖（项目根目录，`.wiki` 在其下）。默认 `~/.dsh`（即 `~/.dsh/.wiki`）。 */
export const MAIN_ROOT_ENV = 'KNJ_OBSIDIAN_MAIN_VAULT_DIR'
/** 子库候选少于该数时才扩主库：与语义兜底同量级，只补召回。 */
export const MAIN_EXPANSION_MIN_CANDIDATES = 3
/** 主库展示名（registry 里可随时改；这里只是默认值）。 */
export const MAIN_VAULT_NAME = '主知识库'
/** 库名最大长度：L0 身份块每行都要短，超长名字会把提示挤成噪声。 */
export const VAULT_NAME_MAX = 80

type Env = Record<string, string | undefined>

/** 关闭开关的等价写法：用户手写 `false`/`0` 也是想关，不能只认 `off`（评审 R3）。 */
const OFF_VALUES = new Set(['off', 'false', '0', 'no', 'disabled'])

/** 主库能力是否开启（默认开；`off`/`false`/`0`/`no`/`disabled` 关闭）。 */
export function subVaultsEnabled(env: Env = process.env): boolean {
  return !OFF_VALUES.has((env[SUBVAULTS_ENV] ?? '').trim().toLowerCase())
}

/**
 * 库名清洗：**注册名会原样进 L0 身份块**，换行/控制字符能凭空造出一条伪造的 `[系统]` 行，
 * 污染所有项目会话的提示（评审 R5）。这里只做「单行 + 去控制字符 + 限长」，
 * 不改语义（不转义、不加引号），因为名字是给人看的标签。
 *
 * @param name - 原始名字（可能为空/全是控制字符）
 * @param fallback - 清洗后为空时的兜底（通常是目录名）
 */
export function sanitizeVaultName(name: string, fallback = ''): string {
  const oneLine = name
    .replace(/[\u0000-\u001f\u007f]+/g, ' ') // C0 控制字符（含 \r\n\t）
    .replace(/\s+/g, ' ')
    .trim()
  if (oneLine) return oneLine.slice(0, VAULT_NAME_MAX)
  return fallback.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, VAULT_NAME_MAX)
}

/** 主库项目根：默认 `~/.dsh`（其下 `.wiki` 即主库），可被环境变量覆盖。 */
export function defaultMainRoot(env: Env = process.env): string {
  const custom = (env[MAIN_ROOT_ENV] ?? '').trim()
  return resolve(custom || join(homedir(), '.dsh'))
}

/** 合并结果：**整体按分数降序**（同分子库在前），主库命中标 `vault: 'main'`。 */
export interface MergedRetrieval extends RetrievalResult {
  /** 本次是否真的从主库补到了候选 */
  expanded: boolean
  /** 从主库补入的候选数 */
  mainHits: number
}

/**
 * 子库结果 + 主库结果合并。
 *
 * 规则（评审 R8 已把这四条统一到实现，别再按"子库永远在前"理解）：
 * - **整体按分数降序**：子库不是整块垫在前面，而是参与同一次排序；只有**同分**时才子库在前
 *   （稳定排序的输入顺序），主库是「跨项目通用知识」，不能因为"来自主库"就被排到后面；
 * - **按 id 去重**：同一 id 的页以子库版本为准（项目版本更贴近当前上下文）；
 * - **不超 maxCandidates**：子库结果已占满时主库没有空位，`expanded=false`；
 * - **只补实召回不足时**：要不要扩主库看 `shouldExpandToMain`（语义噪声不算"子库有货"）。
 */
export function mergeMainCandidates(
  child: RetrievalResult,
  main: RetrievalResult | undefined,
  maxCandidates = 10,
): MergedRetrieval {
  if (!main) return { ...child, expanded: false, mainHits: 0 }
  const seen = new Set(child.candidates.map((c) => c.id))
  const room = Math.max(0, maxCandidates - child.candidates.length)
  const extra = main.candidates
    .filter((c) => !seen.has(c.id))
    .slice(0, room)
    .map((c) => ({ ...c, vault: 'main' as const }))
  // 合并后按分数降序（稳定排序，同分保持子库在前）。
  // 为什么不能只是「子库整体在前」：实测子库会留下 0.1 分的语义兜底噪声，把 4.8 分的主库真命中
  // 压到噪声后面 = 用户看到一堆无关候选。相关性排序优先，子库优势体现在同分时的稳定顺序。
  const candidates = [...child.candidates, ...extra]
  candidates.sort((a, b) => b.score - a.score)
  return {
    candidates,
    strategy: extra.length > 0 ? `${child.strategy}+main` : child.strategy,
    totalPages: child.totalPages,
    expanded: extra.length > 0,
    mainHits: extra.length,
  }
}

/**
 * 实召回候选数：**只排除语义兜底（semantic）通道**。
 *
 * `graph`(0.5)/`body`(1)/`summary`(2)/`title`(10) 都算实召回——它们有词面或结构证据；
 * 唯独 semantic 是"向量近似"，稀疏库里必然返回一堆 0.0x 分噪声，不能算作证据。
 *
 * 为什么不能直接数 candidates.length（2026-10-25 实测）：稀疏子库里语义兜底会返回
 * 5 条 0.0x 分的噪声，把「子库候选 ≥3」判成"够了"，于是最该扩主库的场景反而不扩。
 * 语义层本来就只补召回、不保证相关性，不能拿它当"子库有货"的证据。
 */
export function solidCandidateCount(candidates: ReadonlyArray<{ matchedBy?: string }>): number {
  return candidates.filter((c) => c.matchedBy !== 'semantic').length
}

/** 子库是否"不足"（需要扩主库）：只数实召回；阈值默认 3，可配置。 */
export function shouldExpandToMain(
  candidates: ReadonlyArray<{ matchedBy?: string }>,
  threshold = MAIN_EXPANSION_MIN_CANDIDATES,
): boolean {
  return solidCandidateCount(candidates) < threshold
}

/**
 * 主库扩展的**决策骨架**：阈值判定 + 静默回退，都在这一处。
 *
 * 为什么抽成纯函数（评审 R9）：这段逻辑此前散在 `tools.ts` 的 `expandWithMain` 里，
 * 夹着 provider 解析和真实检索，导致"≥3 不调用主库"这条最关键的行为**零测试覆盖**，
 * 而设计文档却宣称有 stub 断言。现在把「要不要扩」和「取不到时怎么办」变成
 * 可注入 `fetchMain` 的纯逻辑：
 * - 实召回 ≥ 阈值：`fetchMain` **一次都不调用**（这是省算力的核心契约，也是回归重点）；
 * - 子库不足：调用一次，交给 `mergeMainCandidates` 合并/去重/截断；
 * - `fetchMain` 抛错或返回 undefined：静默回退子库结果（主库坏了不能让查询失败）。
 *
 * @param fetchMain - 取主库检索结果；主库未初始化时返回 undefined
 */
export function expandMainCandidates(
  child: RetrievalResult,
  fetchMain: () => RetrievalResult | undefined,
  maxCandidates = 10,
  threshold = MAIN_EXPANSION_MIN_CANDIDATES,
): MergedRetrieval {
  if (!shouldExpandToMain(child.candidates, threshold)) {
    return { ...child, expanded: false, mainHits: 0 }
  }
  try {
    return mergeMainCandidates(child, fetchMain(), maxCandidates)
  } catch {
    return { ...child, expanded: false, mainHits: 0 }
  }
}
