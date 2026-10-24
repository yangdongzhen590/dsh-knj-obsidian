import { useEffect, useMemo, useState } from 'react'
import { fetchCheckpoints, fetchVaults, restoreCheckpoint, type CheckpointMeta } from './api.ts'
import { IconCopy, IconSparkles } from './icons.tsx'
import { SemanticIndexPanel } from './SemanticIndexPanel.tsx'

/** 蒸馏范围：代码侧（enum/db）走 wiki-collect；capability=系统功能挖掘（走内置 wiki-capability skill）；
 *  sessions=会话蒸馏——**单一入口**：默认按时间范围蒸当前工作区，也可复选指定会话只蒸所选
 *  （二者曾是两个并列选项「近期会话蒸馏 / 指定会话蒸馏」，合并后由"有没有勾选会话"决定走哪条，
 *  避免用户为了同一件事在两个入口之间选择）。均走 wiki-distill。 */
export type DistillScope = 'enum' | 'db' | 'both' | 'capability' | 'sessions'
export type DistillRange = '3' | '7' | '30'

/** 宿主会话服务的最小结构面（仅取列表；缺失时降级为手填 session id）。 */
export interface DistillSessionFace {
  list: {
    getSnapshot(): {
      current?: string
      items?: ReadonlyArray<{ id: string; title?: string }>
      byId?: Record<string, { cwd?: string; title?: string }>
    }
  }
}

/** 宿主工作区服务最小面：用于把会话蒸馏限定在「当前知识库所属工作区」。 */
export interface DistillWorkspaceFace {
  list: {
    getSnapshot(): {
      items?: ReadonlyArray<{
        workspaceId?: string
        id?: string
        title?: string
        path?: string
        sessionIds?: readonly string[]
      }>
    }
  }
}

/** 路径归一化（比较用）：统一斜杠、去尾斜杠、忽略大小写。 */
function normPath(p?: string): string {
  return (p ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 列表一次最多渲染多少条（其余靠搜索缩小；避免几百个会话撑爆面板）。 */
const MAX_RENDERED_SESSIONS = 50

const SCOPE_LABELS: Array<{ value: DistillScope; label: string; detail: string }> = [
  { value: 'enum', label: '枚举/常量字典', detail: 'Java enum + public static final 常量 → dictionaries' },
  { value: 'db', label: '表结构', detail: 'SQL DDL / MyBatis XML / JPA Entity → tables' },
  {
    value: 'capability',
    label: '系统功能挖掘',
    detail: '代码 → 功能知识页（入口枚举 + 调用链 + 行级引用）。四步：入口枚举 → 任务清单 → 串行挖掘 → 状态机续跑',
  },
  {
    value: 'sessions',
    label: '会话蒸馏',
    detail: '当前工作区的 DSH 会话 → 按主题蒸馏入库。默认按时间范围；也可在下方复选指定会话，只蒸所选（忽略时间范围，按会话 id 过滤）',
  },
]

const RANGE_LABELS: Array<{ value: DistillRange; label: string }> = [
  { value: '3', label: '近 3 天' },
  { value: '7', label: '近 7 天' },
  { value: '30', label: '近 30 天' },
]

/** 库根 → sessionsRoot 下的项目目录转义形态（盘符:与路径分隔符替换为 -，两端加 --）。
 *  由插件算好写进指令，不让 agent 猜。例：D:\workspace\iobs_pro → --D-workspace-iobs_pro-- */
export function projectFilterOf(root?: string | null): string {
  if (!root) return '(未知)'
  return '--' + root.replace(/[:\\/]+/g, '-') + '--'
}

const SESSIONS_ROOT_HINT = '%USERPROFILE%\\.dsh\\sessions（Windows；即 ~/.dsh/sessions）'

/** 通用批次纪律：还原点 → 查重 → 写前清单（信息性预览）→ 入库 → 质量评估报告。
 *  单一写入规则：按用户决策**不做阻塞式二次确认**（点击启动器 = 授权）；
 *  写前清单是“看得见、可打断”的信息性预览，列完即继续，不等待确认回复。 */
const BATCH_DISCIPLINE = [
  '批次纪律（必须按序执行，不得跳步）：',
  '1) 【还原点】入库前先调用 wiki_checkpoint 工具创建还原点，记下返回的 id；',
  '2) 【查重】对每个将要产出的主题页，先用 wiki_query 检索同名/近似页：已存在 → 更新该页（保留 created），不要新建；确实没有 → 才新建；',
  '3) 【写前清单】写入任何页之前，先在对话里列出清单：将创建 X 页 / 更新 Y 页（每页一行：id、category、一句话理由、来源）。',
  '   这是信息性预览（本流程不做阻塞式二次确认）：列完即继续执行 wiki_ingest，用户可随时打断；',
  '4) 【入库】wiki_ingest 逐页写入，每页带 contentHash；',
  '5) 【质量评估报告】完成后输出结构化报告（这是批次的质量凭证）：还原点 id、创建/更新页清单（id、category、confidence、新增 [[wikilink]] 数）、查重决策（复用了哪些既有页）、跳过项与原因；若质量不佳，用户可凭还原点 id 在边栏「知识蒸馏 → 还原点」一键回滚。',
].join('\n')

/** 代码结构采集指令（引用内置 wiki-collect skill）。 */
function buildCollectTrigger(scope: 'enum' | 'db' | 'both'): string {
  return [
    '请使用内置 wiki-collect skill 在当前工作区执行代码结构采集：',
    `采集类型 = ${scope}（enum=Java 枚举/常量字典；db=SQL DDL/MyBatis/JPA 表结构）。`,
    '步骤：用 wiki_mine 扫描并对账存量知识（new/changed/unchanged/deleted，含同名近似页提醒）→ 蒸馏 → 入库。',
    '规则：仅支持 Java enum、Java public static final、SQL DDL、MyBatis XML、JPA Entity；不支持 TypeScript/Python/Go/任意 ORM/JSON Schema。',
    '不得读取 .dsh 会话归档等非代码源；未知/推断字段保持 unknown/inferred，不得补造成事实；不得覆盖他源页面。',
    BATCH_DISCIPLINE,
    '完成后按第 5 步格式输出质量评估报告。',
  ].join('\n')
}

/** 系统功能挖掘指令（引用内置 wiki-capability skill；把代码逆向为功能知识页）。 */
function buildCapabilityTrigger(vaultRoot?: string | null): string {
  return [
    '请使用内置 wiki-capability skill 在当前工作区执行系统功能挖掘（代码 → 功能知识页）：',
    `范围：当前知识库根目录 ${vaultRoot ?? '(未知)'} 对应的代码仓库。`,
    '四步流程（严格按序，不得跳步）：',
    '1) 【入口枚举】node wiki-capability/scripts/enumerate-entries.mjs --project <工作区根> → entries.json；',
    '2) 【功能树与任务清单】node wiki-capability/scripts/generate-task-list.mjs --project <根> → tasks.yml + 功能树.md；',
    '   若功能聚类需要人工判断，先写 .wiki/_system/capability-mining/功能映射.yml 再重跑；',
    '3) 【串行挖掘】逐任务：node scripts/process-task.mjs get_next → 读线索导航声明的文件 → 写功能知识页（五节结构，见 SKILL.md）',
    '   → node scripts/check-capability.mjs 校验 I1–I4 → 过则 update_complete，不过则修或 update_failed；',
    '4) 【断点续跑】中断后用 get_next 自动重置超时任务（10 分钟阈值，最多 3 次重试）。',
    '规则：每页 category=projects、confidence=inferred、tags 用词表已有词（先用 concept）；',
    '  行号必须由 grep 核对、不得凭记忆写；只引用实际读过的文件；保留测试文件作为行为证据。',
    BATCH_DISCIPLINE,
    '完成后按第 5 步格式输出质量评估报告。',
  ].join('\n')
}

/** 近期会话蒸馏指令（引用内置 wiki-distill skill，按时间范围；限定当前工作区）。 */
function buildDistillTrigger(range: DistillRange, vaultRoot?: string | null): string {
  return [
    `请使用内置 wiki-distill skill 蒸馏【当前工作区/知识库】近 ${range} 天的 DSH 会话进知识库：`,
    `范围限定：当前知识库根目录 ${vaultRoot ?? '(未知)'}；工作区与知识库一一对应——只蒸这个工作区的会话。`,
    `硬约束（插件已算好，直接使用，不要自行推导）：sessions 根 = ${SESSIONS_ROOT_HINT}；`,
    `  项目过滤 = ${projectFilterOf(vaultRoot)}（库根的转义形态）。`,
    `时间下限 = 现在往前 ${range} 天的 ISO 时间（提取器第 5 参数）。`,
    '入库 source 逐会话用 `session:<会话id>`，contentHash 用【该会话自己的摘要内容哈希】（不是 catalog 整体哈希）——',
    '这样同一会话重复蒸馏自动跳过，滑动窗口推移也不会重蒸旧会话。',
    BATCH_DISCIPLINE,
    '边界：原始会话归档只写入 <vault>/_system/dsh-sessions/，不参与知识检索；不读取其他工作区/项目的会话；',
    '不得把会话原文整段抄成页面，只沉淀可复用结论；未知/不确定内容标注 inferred，不得写成事实。',
    '完成后按第 5 步格式输出质量评估报告（含逐会话产出明细）。',
  ].join('\n')
}

/** 指定若干会话蒸馏：提取器第 6 参数按会话 id 过滤（逗号分隔），且不使用时间下限；同样限定当前工作区。 */
function buildSelectedSessionsTrigger(ids: string[], vaultRoot?: string | null): string {
  const list = ids.join(',')
  return [
    `请使用内置 wiki-distill skill 只蒸馏【指定会话】共 ${ids.length} 个（当前知识库「${vaultRoot ?? '(未知)'}」，不蒸馏其它会话）：`,
    `会话 id：${ids.join('、')}`,
    `硬约束（插件已算好，直接使用）：sessions 根 = ${SESSIONS_ROOT_HINT}；项目过滤 = ${projectFilterOf(vaultRoot)}。`,
    '1) 用会话提取器时把会话 id 列表作为第 6 个过滤参数（逗号分隔），并把时间下限显式设为 1970-01-01T00:00:00Z（忽略时间下限，避免老会话被 mtime 过滤掉）：',
    `   node <vault>/_system/tools/extract-dsh-sessions.cjs ${SESSIONS_ROOT_HINT} <vault>/_system/dsh-sessions ${JSON.stringify(projectFilterOf(vaultRoot))} 1970-01-01T00:00:00Z "${list}"`,
    '2) 只蒸馏这些会话；每会话入库 source=`session:<id>`，contentHash 用【该会话自己的摘要内容哈希】（逐会话判重，重复自动跳过）；',
    BATCH_DISCIPLINE,
    '边界：不读取其它工作区会话；原始归档只落 <vault>/_system/dsh-sessions/，不参与检索；未知内容标注 inferred。',
    '完成后按第 5 步格式输出质量评估报告（逐会话列出 id 与产出明细）。',
  ].join('\n')
}

function parseManualIds(text: string): string[] {
  return text.split(',').map((s) => s.trim()).filter(Boolean)
}

/** 知识蒸馏启动器：代码结构采集 / 会话蒸馏统一入口，新建会话把指令交给 Agent。 */
export function KnowledgeDistillLauncher({ startAgentSession, sessions, workspaces, root }: {
  startAgentSession?: (instruction: string, cwd?: string) => Promise<{ ok: boolean; message?: string }>
  sessions?: DistillSessionFace
  workspaces?: DistillWorkspaceFace
  /** 当前会话工作区根：库身份/还原点/初始化状态都按它取（不读全局当前库）。 */
  root?: string
}) {
  const [scope, setScope] = useState<DistillScope>('enum')
  const [range, setRange] = useState<DistillRange>('3')
  const [sessionIds, setSessionIds] = useState<string[]>([])
  const [manualIds, setManualIds] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [initialized, setInitialized] = useState<boolean | null>(null)
  const [vaultRoot, setVaultRoot] = useState<string | null>(null)
  const [sessionOptions, setSessionOptions] = useState<Array<{ id: string; title?: string; cwd?: string }>>([])
  const [checkpoints, setCheckpoints] = useState<CheckpointMeta[]>([])
  const [cpOpen, setCpOpen] = useState(false)

  // 蒸馏结果都写入当前库：检测初始化状态 + 库根；监听库切换（P1：切换后信息不得陈旧）
  useEffect(() => {
    let alive = true
    const refresh = () => {
      fetchVaults(root)
        .then((r) => {
          if (!alive) return
          setVaultRoot(r.current?.root ?? null)
          // ⚠️ 这里**不能**用 `?? true` 兜底（2026-10-13 实测踩到）：
          // 当前库在注册表里找不到时 `initialized` 变成「未知」，而下游只拦 `=== false`，
          // 于是"未知"被当成"已初始化"，照样预填一个**不存在的库路径**——蒸馏会话因此空转约 20 次
          // 探测、并当场把库建在别处。未知必须与未初始化同样对待：`canStartSession` 只在 `=== true` 时放行。
          setInitialized(r.vaults.find((v) => v.id === r.current?.id)?.initialized ?? null)
        })
        .catch(() => { if (alive) setInitialized(null) })
      fetchCheckpoints(root)
        .then((cs) => { if (alive) setCheckpoints(cs) })
        .catch(() => { /* 还原点列表读取失败不阻塞主流程 */ })
    }
    refresh()
    const onFocus = () => refresh()
    const onVaultChanged = () => {
      // 切库后清掉上一个库的会话选择与手填 id，避免带着旧库的选择蒸馏
      setSessionIds([])
      setManualIds('')
      refresh()
    }
    window.addEventListener('wiki:pages-changed', refresh)
    window.addEventListener('wiki:vault-changed', onVaultChanged)
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      window.removeEventListener('wiki:pages-changed', refresh)
      window.removeEventListener('wiki:vault-changed', onVaultChanged)
      window.removeEventListener('focus', onFocus)
    }
  }, [root])

  // 会话列表（指定会话蒸馏用）：先取全部，再按「当前知识库所属工作区」收敛（工作区 ↔ 知识库一一对应）
  useEffect(() => {
    let alive = true
    const read = () => {
      try {
        const snap = sessions?.list.getSnapshot()
        const byId = snap?.byId ?? {}
        const items = snap?.items?.length
          ? snap.items.map((s) => ({ id: s.id, title: s.title, cwd: byId[s.id]?.cwd }))
          : Object.entries(byId).map(([id, v]) => ({ id, title: v.title, cwd: v.cwd }))
        if (alive) setSessionOptions(items)
      } catch { if (alive) setSessionOptions([]) }
    }
    read()
    const onFocus = () => read()
    const onChanged = () => read()
    window.addEventListener('focus', onFocus)
    window.addEventListener('wiki:pages-changed', onChanged)
    return () => {
      alive = false
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('wiki:pages-changed', onChanged)
    }
  }, [sessions])

  /** 当前库根对应的工作区（path 归一化匹配；工作区 id 字段名以 workspaceId 为准）。 */
  const workspace = useMemo(() => {
    if (!vaultRoot) return undefined
    try {
      const items = workspaces?.list.getSnapshot()?.items ?? []
      const want = normPath(vaultRoot)
      return items.find((w) => normPath(w.path) === want)
    } catch { return undefined }
  }, [vaultRoot, workspaces, sessionOptions])

  /** 只保留当前工作区的会话：优先用工作区 sessionIds 归属账；退化用 cwd 前缀匹配。 */
  const scopedSessions = useMemo(() => {
    if (!vaultRoot) return { items: sessionOptions, scoped: false as const }
    const owned = new Set(workspace?.sessionIds ?? [])
    if (owned.size > 0) return { items: sessionOptions.filter((s) => owned.has(s.id)), scoped: true as const }
    const root = normPath(vaultRoot)
    const byCwd = sessionOptions.filter((s) => s.cwd && normPath(s.cwd).startsWith(root))
    if (byCwd.length > 0) return { items: byCwd, scoped: true as const }
    return { items: sessionOptions, scoped: false as const }
  }, [sessionOptions, workspace, vaultRoot])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return scopedSessions.items
    return scopedSessions.items.filter((s) => s.id.toLowerCase().includes(q) || (s.title ?? '').toLowerCase().includes(q))
  }, [scopedSessions, query])
  const shown = filtered.slice(0, MAX_RENDERED_SESSIONS)
  const effectiveIds = useMemo(
    () => [...new Set([...sessionIds, ...parseManualIds(manualIds)])],
    [sessionIds, manualIds],
  )

  /** 允许建会话的唯一条件：库根已知**且已确认初始化**。
   *  库根未知或未初始化/状态未知时宁可不建会话——未初始化库上入库会隐式 ensure 建库，
   *  与「注册 ≠ 初始化」契约冲突（初始化是显式的 wiki_init 动作）；而"状态未知"曾被 `?? true`
   *  兜底成"已初始化"，导致预填一个不存在的库路径（2026-10-13 实测）。 */
  const canStartSession = Boolean(vaultRoot) && initialized === true

  /**
   * 真正把指令交给 Agent（新建会话 + 预填）：**不检查已初始化态**。
   *
   * 为什么必须单独拆出来（2026-10-24 实测）：未初始化工作区里点「初始化知识库」什么都
   * 没发生——旧实现 initVault 走 send()，而 send() 开头两道守卫先 return：
   *   1) /vaults 对未初始化工作区返回 current=null → vaultRoot=null → "未能确定库根"；
   *   2) initialized !== true → 提示"请先点上面的「初始化知识库」"→ 点初始化让你先点初始化（死循环）。
   * 初始化动作本身必须能跑，库根在未初始化时回退到会话工作区 root（面板已知）。
   */
  const startInstruction = async (text: string, okText: string) => {
    const targetRoot = vaultRoot ?? root
    if (!targetRoot) {
      setMessage('未能确定当前库根目录（/vaults 读取失败且宿主未给会话工作区）：请点刷新后重试，或改用「复制触发指令」。')
      return
    }
    const res = startAgentSession
      ? await startAgentSession(text, targetRoot)
      : { ok: false, message: '宿主未提供新建会话能力' }
    if (!res.ok) {
      try { await navigator.clipboard.writeText(text) } catch { /* 指令仍可在下方复制 */ }
      setMessage(`无法新建会话（${res.message ?? '未知原因'}）：触发指令已复制到剪贴板，请粘贴到对话发送给 Agent。`)
      return
    }
    setMessage(res.message ? `${okText}（注意：${res.message}）` : okText)
  }

  const send = async (text: string, okText: string) => {
    // 新会话必须归属当前库所在工作区：库根未知时宁可不建，也不要落到默认工作区
    if (!vaultRoot) {
      setMessage('未能确定当前库根目录（/vaults 读取失败）：请点刷新后重试，或改用「复制触发指令」。')
      return
    }
    // 未初始化（或状态未知）：蒸馏会写库，拒绝预填；初始化请走上面的「初始化知识库」
    if (initialized !== true) {
      setMessage(initialized === false
        ? '当前库尚未初始化（磁盘上没有 .wiki）：请先点上面的「初始化知识库」，建好后再蒸馏；也可「复制触发指令」自行处理。'
        : '当前库的初始化状态未知（/vaults 未返回该库）：请点刷新后重试；为避免把知识写进一个不存在的库，这里不预填指令。')
      return
    }
    await startInstruction(text, okText)
  }

  const initVault = async () => {
    const text = [
      '请初始化当前工作区的知识库：调用 wiki_init 工具创建 .wiki 脚手架',
      '（index.md / .manifest.json / concepts、entities、references、synthesis、projects、dictionaries、tables 目录）。',
      '完成后报告：库根路径、是否新建、当前页数。不要在此步骤采集或写入知识页。',
    ].join('')
    // 初始化不能被「未初始化」守卫拦住：直接走不带守卫的通道。
    await startInstruction(text, '已新建会话并预填初始化指令：切到该新会话后回车发送，Agent 会用 wiki_init 建库，建好后回来看板蒸馏')
  }

  const toggleSession = (id: string) => {
    setSessionIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const deliver = async (copyOnly: boolean) => {
    let text: string
    if (scope === 'sessions') {
      // 合并后的单一入口：勾了会话就只蒸所选（忽略时间范围），没勾就按时间范围蒸当前工作区。
      // 这样「蒸馏近期」与「蒸馏指定会话」不再是两个要用户二选一的入口。
      text = effectiveIds.length > 0
        ? buildSelectedSessionsTrigger(effectiveIds, vaultRoot)
        : buildDistillTrigger(range, vaultRoot)
    } else if (scope === 'capability') {
      text = buildCapabilityTrigger(vaultRoot)
    } else {
      text = buildCollectTrigger(scope)
    }
    if (copyOnly) {
      try { await navigator.clipboard.writeText(text) } catch { /* 展示兜底文本 */ }
      setMessage('触发指令已复制到剪贴板，请粘贴到对话发送给 Agent（未创建新会话）。')
      return
    }
    const okText = scope === 'sessions'
      ? '已新建会话并预填指令：切到该新会话后回车发送，Agent 会用 wiki-distill 蒸馏并入库。'
      : scope === 'capability'
        ? '已新建会话并预填指令：切到该新会话后回车发送，Agent 会用 wiki-capability 挖掘功能知识页并入库。'
        : '已新建会话并预填指令：切到该新会话后回车发送，Agent 会用 wiki-collect 采集并直接入库。'
    await send(text, okText)
  }

  return <div className="knj-vcol" style={{ padding: 12, gap: 10 }}>
    <div className="knj-banner knj-banner--info">
      <span><strong>知识蒸馏</strong>：把当前工作区的代码结构或会话沉淀成知识页。
        选择范围后点击，触发指令会交给当前对话 Agent——代码结构走 <code>wiki-collect</code> skill，
        会话蒸馏走 <code>wiki-distill</code> skill，两者都经 <code>wiki_ingest</code> 入库。
        本视图不产生草稿状态，也不直接写库。</span>
    </div>
    <div className="knj-pop__hint">代码侧支持：Java enum、Java public static final、SQL DDL、MyBatis XML、JPA Entity；
      不支持：TypeScript、Python、Go、任意 ORM、JSON Schema。
      <br />会话侧：原始归档只写入 <code>&lt;vault&gt;/_system/dsh-sessions/</code>，不读取其他工作区会话、不参与知识检索。</div>

    {initialized !== true && (
      <div className="knj-banner knj-banner--warn">
        <span className="knj-vcol" style={{ gap: 6 }}>
          {initialized === false ? (
            <span><strong>当前库尚未初始化</strong>：磁盘上还没有 <code>.wiki</code>，蒸馏结果无处入库。</span>
          ) : (
            <span><strong>无法确认当前库的初始化状态</strong>：<code>/vaults</code> 没返回该库。为避免把知识写进一个不存在的库，这里不预填蒸馏指令。</span>
          )}
          <span className="knj-pop__row">
            <button type="button" className="knj-btn knj-btn--primary" onClick={initVault}>初始化知识库</button>
            <span className="knj-pop__hint">把初始化指令交给当前对话 Agent（调用 wiki_init），建好后回来蒸馏。</span>
          </span>
        </span>
      </div>
    )}

    <div className="knj-pop__hint">
      当前知识库与工作区一一对应：<strong>{workspace?.title?.trim() || vaultRoot || '(未确定)'}</strong>
      {workspace ? <span> · 工作区 {(workspace.workspaceId ?? workspace.id ?? '').slice(0, 8)}</span> : <span>（未匹配到工作区，请刷新）</span>}
      {vaultRoot ? <><br />库根：<code>{vaultRoot}</code></> : null}
    </div>

    <div className="knj-vcol" style={{ gap: 6 }}>
      {SCOPE_LABELS.map((s) => (
        <label key={s.value} className="knj-result-item" style={{ cursor: 'pointer' }}>
          <span className="knj-hrow" style={{ gap: 7 }}>
            <input type="radio" name="distill-scope" checked={scope === s.value} onChange={() => setScope(s.value)} />
            <span style={{ fontWeight: 500 }}>{s.label}</span>
          </span>
          <span className="knj-pop__hint">{s.detail}</span>
        </label>
      ))}
    </div>

    {scope === 'capability' && (
      <div className="knj-banner knj-banner--info">
        <span className="knj-vcol" style={{ gap: 4 }}>
          <span><strong>系统功能挖掘</strong>：把工作区代码逆向为功能知识页（一功能一页：概念定义 / 系统事实 / 功能树与入口映射 / 调用链路 / 附录）。</span>
          <span className="knj-pop__hint">四步管线由 <code>wiki-capability</code> skill 驱动：入口枚举（确定性）→ 任务清单 → 串行挖掘 → 状态机续跑。
            产物落 <code>projects/capability-*.md</code>，每页带行级引用与 <code>[[wikilink]]</code>，过 I1–I4 四条不变量才入库。</span>
        </span>
      </div>
    )}

    {scope === 'sessions' && (
      <div className="knj-pop__row" style={{ flexWrap: 'wrap' }}>
        <span className="knj-pop__hint">时间范围：</span>
        {RANGE_LABELS.map((r) => (
          <button key={r.value} type="button"
            className={`knj-btn knj-btn--sm${range === r.value && effectiveIds.length === 0 ? ' knj-btn--primary' : ' knj-btn--subtle'}`}
            onClick={() => setRange(r.value)}>{r.label}</button>
        ))}
        {effectiveIds.length > 0 && (
          <span className="knj-pop__hint">（已勾选 {effectiveIds.length} 个会话 → 忽略时间范围，只蒸所选；清空勾选即回到按时间范围）</span>
        )}
      </div>
    )}

    {scope === 'sessions' && (
      <div className="knj-vcol" style={{ gap: 6 }}>
        <div className="knj-pop__row">
          <button type="button" className="knj-btn knj-btn--sm knj-btn--subtle" onClick={() => setPickerOpen((v) => !v)}>
            {pickerOpen ? '收起会话列表' : '只蒸馏指定会话（可选）'}
          </button>
          <span className="knj-pop__hint">
            已选 {effectiveIds.length} 个 · {scopedSessions.scoped ? `本工作区 ${scopedSessions.items.length} 个会话` : `共 ${sessionOptions.length} 个会话（未按工作区收敛）`}
          </span>
          {(sessionIds.length > 0 || manualIds.trim()) && (
            <button type="button" className="knj-btn knj-btn--sm" onClick={() => { setSessionIds([]); setManualIds('') }}>清空</button>
          )}
        </div>

        {effectiveIds.length > 0 && (
          <div className="knj-pop__hint" style={{ wordBreak: 'break-all' }}>已选：{effectiveIds.join('、')}</div>
        )}

        {pickerOpen && scopedSessions.scoped === false && sessionOptions.length > 0 && (
          <div className="knj-banner knj-banner--warn">
            <span>未能在宿主工作区里匹配到本库根目录，下面列出的是<strong>全部会话</strong>（可能含其它工作区）。
              请只勾选确属本知识库的会话——工作区与知识库是一一对应的。</span>
          </div>
        )}
        {pickerOpen && (scopedSessions.items.length === 0 ? (
          <span className="knj-pop__hint">
            {sessionOptions.length === 0
              ? '宿主未提供会话列表：在下面直接粘贴 session id（逗号分隔可多个）。'
              : `当前工作区没有会话（宿主共 ${sessionOptions.length} 个会话，均不属于本工作区）；可粘贴 session id，但应确属本知识库。`}
          </span>
        ) : (
          <>
            <input className="knj-input" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={`搜索会话（标题或 id，本工作区 ${scopedSessions.items.length} 个）`} spellCheck={false} />
            <div className="knj-pop__row">
              <button type="button" className="knj-btn knj-btn--sm knj-btn--subtle"
                onClick={() => setSessionIds((prev) => [...new Set([...prev, ...shown.map((s) => s.id)])])}>全选当前结果</button>
              <span className="knj-pop__hint">
                显示 {shown.length}/{filtered.length}{filtered.length > MAX_RENDERED_SESSIONS ? '（可搜索缩小范围）' : ''}
              </span>
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--knj-border-soft)', borderRadius: 8, padding: 4 }}>
              {shown.map((s) => (
                <label key={s.id} className="knj-result-item" style={{ cursor: 'pointer' }}>
                  <span className="knj-hrow" style={{ gap: 7 }}>
                    <input type="checkbox" checked={sessionIds.includes(s.id)} onChange={() => toggleSession(s.id)} />
                    <span style={{ fontWeight: 500 }}>{s.title?.trim() || '(无标题会话)'}</span>
                  </span>
                  <span className="knj-pop__hint">{s.id}</span>
                </label>
              ))}
              {shown.length === 0 && <span className="knj-pop__hint">没有匹配的会话，换个关键词试试。</span>}
            </div>
          </>
        ))}

        <input className="knj-input" value={manualIds} onChange={(e) => setManualIds(e.target.value)}
          placeholder="也可粘贴 session id（逗号分隔多个）" spellCheck={false} />
      </div>
    )}

    <div className="knj-pop__row">
      <button type="button" className="knj-btn knj-btn--primary" disabled={!canStartSession}
        title={!canStartSession ? '当前库尚未初始化：请先点「初始化知识库」' : undefined}
        onClick={() => deliver(false)}>
        <IconSparkles size={14} />新建会话并预填
      </button>
      <button type="button" className="knj-btn knj-btn--subtle"
        onClick={() => deliver(true)}>
        <IconCopy size={14} />复制触发指令
      </button>
    </div>
    <div className="knj-pop__hint">会新建一个会话（cwd = 当前库根目录）并把触发指令预填进它的输入框，你切过去按回车即发送给 Agent。
      {!canStartSession && <><br /><strong>当前库未初始化</strong>：先用上方「初始化知识库」，或改用「复制触发指令」自行处理。</>}</div>

    <div className="knj-vcol" style={{ gap: 4 }}>
      <div className="knj-pop__row">
        <button type="button" className="knj-btn knj-btn--sm knj-btn--subtle" onClick={() => setCpOpen((v) => !v)}>
          还原点{checkpoints.length > 0 ? `（${checkpoints.length}）` : ''}
        </button>
        <span className="knj-pop__hint">批次入库前 Agent 会自动创建；质量不佳时可在此回滚（默认保留快照之后的新页）</span>
      </div>
      {cpOpen && (
        <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--knj-border-soft)', borderRadius: 8, padding: 4 }}>
          {checkpoints.length === 0 && <span className="knj-pop__hint">还没有还原点。蒸馏指令会要求 Agent 入库前先调用 wiki_checkpoint。</span>}
          {checkpoints.map((cp) => {
            const doRestore = async (mode: 'merge' | 'exact') => {
              const question = mode === 'merge'
                ? `回滚到还原点 ${cp.id}？\n只撤销该快照内页面的改动（批次改坏的恢复原样），快照之后新增的页面会保留。`
                : `精确回滚到还原点 ${cp.id}？\n整库回到该快照：快照之后新增的页面会被删除（可能是其它会话的正当产物）。`
              if (!window.confirm(question)) return
              try {
                const r = await restoreCheckpoint(cp.id, mode, root)
                setMessage(mode === 'merge'
                  ? `已回滚到 ${cp.id}：恢复 ${r.restored} 页，保留快照后新页 ${r.keptNewer} 页（现 ${r.pageCount} 页），索引已重建`
                  : `已精确回滚到 ${cp.id}（现 ${r.pageCount} 页，快照后新增页已删除），索引已重建`)
                window.dispatchEvent(new CustomEvent('wiki:pages-changed'))
              } catch (e) {
                setMessage(`回滚失败：${e instanceof Error ? e.message : String(e)}`)
              }
            }
            return (
              <div key={cp.id} className="knj-result-item">
                <span className="knj-hrow" style={{ gap: 7 }}>
                  <span style={{ fontWeight: 500 }}>{cp.id}</span>
                  <span className="knj-pop__hint">{cp.pageCount} 页</span>
                </span>
                <span className="knj-pop__hint">{cp.createdAt}</span>
                <span className="knj-pop__row">
                  <button type="button" className="knj-btn knj-btn--sm knj-btn--ghost-danger" onClick={() => doRestore('merge')}>
                    回滚（保留新页）
                  </button>
                  <button type="button" className="knj-btn knj-btn--sm" onClick={() => doRestore('exact')}>
                    精确回滚（删新页）
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>

    {message && <div className="knj-banner knj-banner--info" style={{ color: 'var(--knj-text)' }}>{message}</div>}

    <SemanticIndexPanel root={root} />
  </div>
}
