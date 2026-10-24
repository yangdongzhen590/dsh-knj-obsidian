// knowledge-distill.test.mjs — 「知识蒸馏」统一启动器契约（先红后绿）
// 分段：浏览 / 图谱 / 知识蒸馏（原「代码采集」更名并入「近期会话蒸馏」）
// 选项：枚举/常量字典、表结构、全部（字典+表结构）、近期会话蒸馏（近 3/7/30 天）
// 指令分别引用内置 wiki-collect / wiki-distill skill；预填当前对话 + 复制兜底；不直接写库。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CLIENT = join(import.meta.dirname, 'src', 'client')
const launcher = readFileSync(join(CLIENT, 'KnowledgeDistillLauncher.tsx'), 'utf8')
const sidebar = readFileSync(join(CLIENT, 'WikiSidebar.tsx'), 'utf8')
const lintPanel = readFileSync(join(CLIENT, 'LintPanel.tsx'), 'utf8')

test('单一写入授权规则：启动器与两个 skill 表述一致（无阻塞式二次确认）', () => {
  const collect = readFileSync(join(import.meta.dirname, 'wiki-collect', 'SKILL.md'), 'utf8')
  const distill = readFileSync(join(import.meta.dirname, 'wiki-distill', 'SKILL.md'), 'utf8')

  // 三方都必须要求还原点
  assert.match(launcher, /wiki_checkpoint/, '启动器指令必须要求还原点')
  assert.match(collect, /wiki_checkpoint/, 'wiki-collect 必须要求还原点')
  assert.match(distill, /wiki_checkpoint/, 'wiki-distill 必须要求还原点')
  // 三方都必须有写前清单，且都不是阻塞式确认
  assert.match(launcher, /写前清单/)
  assert.match(collect, /写前清单/)
  assert.match(distill, /写前清单/)
  assert.match(launcher, /不做阻塞式二次确认|列完即继续/)
  assert.match(collect, /不等待确认回复|不做阻塞式二次确认/)
  assert.match(distill, /列完即继续|不做阻塞式二次确认/)
  // 不得再出现互相矛盾的“等确认”措辞
  assert.doesNotMatch(launcher, /等(我|用户)确认/, '启动器不得要求阻塞式确认')
  assert.doesNotMatch(collect, /等(用户)?确认/, 'wiki-collect 不得要求阻塞式确认')
  assert.doesNotMatch(distill, /等(用户)?确认/, 'wiki-distill 不得要求阻塞式确认')
})

test('知识蒸馏启动器提供各选项并分别引用两个内置 skill', () => {
  assert.match(launcher, /枚举\/常量字典/)
  assert.match(launcher, /表结构/)
  assert.match(launcher, /系统功能挖掘/)
  assert.doesNotMatch(launcher, /全部（字典 \+ 表结构）/, '原“全部”选项已改名为系统功能挖掘')
  // 「近期会话蒸馏」与「指定会话蒸馏」已合并为单一入口「会话蒸馏」：由"有没有勾选会话"
  // 决定走时间范围还是指定会话，不再让用户为同一件事二选一。
  assert.match(launcher, /会话蒸馏/)
  assert.doesNotMatch(launcher, /'session-pick'/, '合并后不应再保留第二个并列的会话蒸馏模式')
  assert.match(launcher, /wiki-collect/)
  assert.match(launcher, /wiki-distill/)
})

test('批次纪律：还原点 + 查重 + 写前清单 + 质量评估报告', () => {
  assert.match(launcher, /wiki_checkpoint/, '入库前必须创建还原点')
  assert.match(launcher, /wiki_query/, '写前必须查重（防 -2 堆积）')
  assert.match(launcher, /写前清单/, '必须写前列清单再入库')
  assert.match(launcher, /质量评估报告/, '必须产出质量评估报告')
  assert.match(launcher, /还原点/, '报告需引用还原点 id 供回滚')
  // 幂等：逐会话哈希，禁止 catalog 整体哈希/日期区间 source
  assert.match(launcher, /该会话自己的摘要内容哈希|逐会话/, 'contentHash 必须逐会话')
  assert.doesNotMatch(launcher, /catalog\.json 文件的 SHA-256/, '不得使用 catalog 整体哈希')
  // 工作区硬约束：插件算好 project-filter 与 sessions 根
  assert.match(launcher, /projectFilterOf/, '应插件计算项目过滤')
  assert.match(launcher, /--D-workspace-|replace\(\/\[:\\\\\/\]/, '项目过滤应为路径转义形态')
})

test('还原点 UI：列出并可回滚（默认非破坏性 + 显式精确回滚）', () => {
  assert.match(launcher, /fetchCheckpoints/)
  assert.match(launcher, /restoreCheckpoint/)
  assert.match(launcher, /回滚（保留新页）/, '默认回滚应保留快照后新页')
  assert.match(launcher, /精确回滚（删新页）/, '精确回滚需显式按钮')
  assert.match(launcher, /doRestore\('merge'\)/)
  assert.match(launcher, /doRestore\('exact'\)/)
  assert.match(launcher, /maxHeight|overflowY/, '还原点列表应限高滚动')
})

test('未初始化库不得建会话：拦截 + 按钮禁用 + 引导初始化', () => {
  assert.match(launcher, /canStartSession/, '应有可建会话的统一条件')
  assert.match(launcher, /initialized === false/, '未初始化时要在 send 里拦截')
  assert.match(launcher, /当前库尚未初始化（磁盘上没有 \.wiki）/, '拦截时给出明确原因')
  assert.match(launcher, /!canStartSession/, '未初始化时禁用「新建会话并预填」')
})

test('切库后刷新（vault-changed）且清掉旧库的会话选择', () => {
  assert.match(launcher, /wiki:vault-changed/)
  assert.match(launcher, /setSessionIds\(\[\]\)/)
})

// v2026.10.173：系统功能挖掘从「预留位」转正——预留 chip/横幅/禁用一律撤掉，
// 改为要求真正的 capability 分支。这条测试的语义因此反转：以前守护「不许生成指令」，
// 现在守护「必须能生成指令」。
test('系统功能挖掘已转正（capability 范围可用、无预留横幅、按钮不禁用）', () => {
  // 枚举里真有这一档，且标签是人话
  assert.match(launcher, /value: 'capability'/, '范围枚举应含 capability')
  assert.match(launcher, /label: '系统功能挖掘'/, '标签应为系统功能挖掘')
  // 指令生成器存在且引用内置 wiki-capability skill
  assert.match(launcher, /buildCapabilityTrigger/, '应有 capability 指令生成器')
  assert.match(launcher, /wiki-capability/, '指令应引用内置 wiki-capability skill')
  assert.match(launcher, /scope === 'capability'/, 'deliver 应显式处理 capability 分支')
  // 预留态彻底撤除：chip、横幅、常量、按范围禁用
  assert.doesNotMatch(launcher, /预留/, '不应再出现「预留」字样')
  assert.doesNotMatch(launcher, /RESERVED_NOTICE/, '不应再保留 RESERVED_NOTICE 常量')
  assert.doesNotMatch(launcher, /s\.reserved/, '不应再按 reserved 渲染 chip')
  assert.doesNotMatch(launcher, /disabled=\{scope === 'both'\}/, '不应按范围禁用动作')
  assert.doesNotMatch(launcher, /disabled=\{[^}]*capability/, 'capability 范围不得禁用动作')
})

test('会话蒸馏选项提供时间范围与归档边界说明', () => {
  assert.match(launcher, /近 ?3 ?天/)
  assert.match(launcher, /近 ?7 ?天/)
  assert.match(launcher, /近 ?30 ?天/)
  assert.match(launcher, /_system/)
  assert.match(launcher, /当前工作区/)
})

test('启动器如实披露代码侧支持范围并保留新建会话/复制双通道', () => {
  assert.match(launcher, /Java enum/)
  assert.match(launcher, /SQL DDL/)
  assert.match(launcher, /MyBatis XML/)
  assert.match(launcher, /JPA Entity/)
  assert.match(launcher, /TypeScript/)
  assert.match(launcher, /不支持/)
  assert.match(launcher, /startAgentSession/)
  assert.match(launcher, /新建会话并预填/, '主操作应是新建会话')
  assert.doesNotMatch(launcher, /填入当前对话输入框/, '不再填充当前会话窗口')
  assert.match(launcher, /复制触发指令/)
  assert.doesNotMatch(launcher, /已调用\s*AI|自动\s*写入/)
})

test('桥接：0.2 宿主没有 sessions.open —— 必须走 uiWorkspace 建会话并切过去', () => {
  const index = readFileSync(join(CLIENT, 'index.ts'), 'utf8')
  // 2026-10-24 实测：ISessions（@deepseek-ai/dsh-api-session-controller/client）
  // 只有 create/fork/scope/retain…，**没有 open**。旧写法 `sessions.open?.(newId)`
  // 是可选链静默 no-op：会话建出来了但界面不切、scope 不保留、预填必然失败，
  // 用户看到的就是「点了没反应」。0.2 的切换/新建+预填归 ui-workspace 的
  // UiWorkspace.openSession / startSession（startSession 内部 = 新建→切会话→初始化草稿）。
  assert.match(index, /uiWorkspace/, '应取宿主 uiWorkspace 服务')
  assert.match(index, /startSession/, '新建会话+预填应走宿主 startSession（不再自己拼 open）')
  assert.match(index, /openSession/, '旧宿主回退路径也应能切会话（openSession）')
  assert.match(index, /prompt/, '预填内容以 prompt 交给宿主草稿初始化')
  // 回退路径保留：宿主没有 uiWorkspace 时才用 create/scope/setDraft
  assert.match(index, /sessions\.create/, '旧宿主回退路径仍保留 create')
  assert.match(index, /setDraft/, '旧宿主回退路径仍保留 setDraft')
  assert.match(index, /cwd/, '新会话应归属当前库/工作区')
  // 宿主 startSession 会**复用**同 cwd 的空白会话（createInWorkspace 的 blank 分支）：
  // 只按「出现新 id」判定成功会假阴性（复用旧 blank 时永远等不到新 id）。
  assert.match(index, /blank/, '应兼容宿主复用空白会话，而不是只认新 id')
  // uiWorkspace 是后加载的插件服务：在 apply 时捕获会拿到 undefined 并永久保留
  // （2026-10-24 实测：面板仍报旧的 prefill not verified，说明走了回退路径）。
  // 必须调用时再取（uiWorkspaceFace()），并把解析结果写进 console 便于现场取证。
  assert.match(index, /uiWorkspaceFace/, '应在调用时解析 uiWorkspace，而不是 apply 时捕获')
  assert.match(index, /CLIENT_BUILD/, '应带客户端构建标记（人眼确认浏览器加载了哪次构建）')
})

test('初始化按钮必须真能跑（不得被「未初始化」守卫拦住）', () => {
  const src = readFileSync(join(CLIENT, 'KnowledgeDistillLauncher.tsx'), 'utf8')
  // 2026-10-24 实测：未初始化工作区里点「初始化知识库」什么都没发生——
  // initVault → send() 的两道守卫先 return：/vaults 的 current 为 null（vaultRoot=null），
  // 且 initialized !== true 时提示“请先点上面的初始化知识库”= 死循环。
  assert.match(src, /startInstruction/, '应有不带初始态守卫的启动函数')
  const at = src.indexOf('const initVault')
  assert.ok(at >= 0, '应有 initVault')
  const block = src.slice(at, at + 500)
  assert.doesNotMatch(block, /await send\(/, 'initVault 不得调用带 initialized/vaultRoot 守卫的 send')
  assert.match(src, /vaultRoot \?\? root/, '未初始化时 /vaults 无 current，库根应回退到会话工作区 root')
})

test('新建会话必须落到当前库所属工作区（workspaceId + cwd 读回校验）', () => {
  const index = readFileSync(join(CLIENT, 'index.ts'), 'utf8')
  assert.match(index, /workspaceId/, '应按库根匹配并传入 workspaceId')
  assert.match(index, /normalizePath/, '路径比较应归一化（大小写/斜杠）')
  assert.match(index, /byId/, '创建后应读回会话归属做校验')
  assert.match(index, /ok: true|ok: false/, '桥接应返回结构化结果（可带告警）')
  // 匹配不到工作区时：注册库根为工作区（幂等），再按 sessionIds 归属校验
  assert.match(index, /workspaces\?\.create|workspaces\.create/, '应能注册库根为工作区')
  assert.match(index, /sessionIds/, '应按工作区 sessionIds 归属校验新会话')
  // 宿主 WorkspaceView 的 id 字段名是 workspaceId（读 id 会拿到 undefined）
  assert.match(index, /hit\.workspaceId|workspaceId \?\?/, '应读 workspaceId 字段（兼容旧 id）')
  const header = readFileSync(join(CLIENT, 'VaultHeader.tsx'), 'utf8')
  // 2026-10-24：面板不再按 workspaceId 猜「当前工作区」，改为直接接收会话工作区根 root
  assert.match(header, /root\?: string/, 'VaultHeader 应按会话工作区根（root）取库')
  assert.doesNotMatch(header.replace(/\/\*[\s\S]*?\*\//g, ''), /recentWorkspaceId/, '不得再依赖 0.2 不存在的最近工作区字段')
})

test('边栏分段更名为「知识蒸馏」且不再保留两个旧分段', () => {
  assert.match(sidebar, /KnowledgeDistillLauncher/)
  assert.match(sidebar, /知识蒸馏/)
  assert.doesNotMatch(sidebar, /代码采集/)
  assert.doesNotMatch(sidebar, /SessionDistillLauncher/)
  assert.doesNotMatch(sidebar, /CodeCollectLauncher/)
})

test('底部工具面板不再重复旧的复制式蒸馏入口', () => {
  assert.doesNotMatch(lintPanel, /DISTILL_TRIGGER/)
  assert.doesNotMatch(lintPanel, /doDistill/)
})

test('会话蒸馏关联工作区（工作区 ↔ 知识库一一对应）', () => {
  assert.match(launcher, /DistillWorkspaceFace/, '应接收工作区服务面')
  assert.match(launcher, /workspaces/, '应使用工作区快照收敛会话')
  assert.match(launcher, /sessionIds/, '应按工作区 sessionIds 归属过滤会话')
  assert.match(launcher, /一一对应/, '界面应说明工作区与知识库一一对应')
  assert.match(launcher, /只蒸这个工作区的会话|不蒸其它工作区的会话/, '指令应限定只蒸当前工作区')
  assert.match(launcher, /不属于/, '指定会话时应校验归属并拒绝不属于本工作区的会话')
  const sidebar = readFileSync(join(CLIENT, 'WikiSidebar.tsx'), 'utf8')
  assert.match(sidebar, /workspaces=\{workspaces as never\}|workspaces=/, '边栏应把工作区面传给启动器')
})

test('会话蒸馏的指定会话能力：复选多个会话 + 列表可搜索/滚动，不长列表撑爆面板', () => {
  // 入口已并入「会话蒸馏」，但指定会话这条能力必须原样保留
  assert.match(launcher, /只蒸馏指定会话/, '合并后仍要有一个明确的"只蒸所选"入口')
  assert.match(launcher, /只蒸所选/)
  assert.match(launcher, /type="checkbox"/, '会话选择应为复选')
  assert.match(launcher, /已选/)
  assert.match(launcher, /搜索|过滤/, '会话多时应可搜索过滤')
  assert.match(launcher, /maxHeight|overflowY|overflow-y/, '列表应限制高度并可滚动')
  assert.match(launcher, /全选|清空/, '应提供批量选择/清空')
  // 指令侧：多会话用逗号分隔（提取器第 6 参数），并忽略时间下限
  assert.match(launcher, /join\(','\)/)
  assert.match(launcher, /1970-01-01T00:00:00Z/)
  assert.match(launcher, /session:/)
  // 合并后的分派：勾了会话走"指定会话"指令，没勾走"时间范围"指令
  assert.match(launcher, /effectiveIds\.length > 0/, '应由有无勾选决定走哪条指令')
})
