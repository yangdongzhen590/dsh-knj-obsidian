// trigger.test.mjs
// 任务级知识触发（L1）与回合级沉淀提醒（L5）的契约测试。
//
// 设计要点（2026-09-20）：
//  - 触发时机是「任务」而不是「每次工具调用」——用户明确否掉了挂在 edit/write 前（太频繁）。
//  - 匹配用「页面侧词表扫任务原文 + 绝对命中数」，不用 retrieve() 的占比打分：
//    任务句长、分母大，占比天然偏低（实测「怎么避免定时器在错误的时钟下工作」占比近 0）。
//  - 最高危失败模式是**自激循环**：本插件注入的提醒本身就是一条 user 消息，
//    若被当成新任务就会在下一 pre-step 再次触发。A3 用例把这条钉死。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { VaultStore } from './lib/vault-store.js'
import { VaultManager } from './lib/vault-manager.js'
import {
  matchTaskPages, renderTaskReminder, renderCaptureReminder,
  latestDirectUserTask, foldTurnFacts, triggerEnabled, installTrigger,
  currentTurnOf, turnToolCalls, injectedNotices, taskSummaryOf, CAPTURE_SUMMARY,
  subagentTriggerEnabled, delegationDepthOf,
  resolveSessionVault, renderVaultIdentity, foldHintOutcome, fullTextSummaryOf,
  taskSeqOfSummary, fullTextStageEnabled, vaultIdentityEnabled,
  TASK_SUMMARY_PREFIX, FULLTEXT_SUMMARY_PREFIX, VAULT_IDENTITY_SUMMARY,
  failureSignatureOf, foldFailureFrequency, recurringFailures, renderRecurrenceReminder,
  recurrenceSummaryOf, recurrenceEnabled, RECURRENCE_THRESHOLD,
  gateModeOf, isMutationCall, isHighRiskTarget, highRiskPathsFromVault, consultedVaultSince,
  latestNoticeByPrefix, writeGateModeOf, vaultCanHelp, recurrenceHintOf,
} from './lib/trigger.js'

const NOW = '2026-08-25T00:00:00.000Z'

function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-trigger-'))
  const store = new VaultStore(dir)
  store.ensure()
  return { dir, store }
}

/**
 * 「会话工作区」夹具：库的根 = 一个带 .wiki 的目录，且会话 cwd 就是它
 * ——与真实布局一致（工作区根下有 .wiki，会话 header.cwd 指向工作区根）。
 * L0 的解析走**真实** VaultManager（向上找 .wiki、只读不建库都是它的职责，不该被夹具替掉）。
 */
function makeWorkspace(t, label) {
  const dir = mkdtempSync(join(tmpdir(), `dsh-obsidian-ws-${label}-`))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new VaultStore(dir)
  store.ensure()
  mkdirSync(join(dir, 'src', 'deep'), { recursive: true })
  const manager = new VaultManager({ registryFile: join(dir, 'registry.json'), cwdRoot: dir })
  return { dir, store, manager }
}

function seed(store) {
  store.writePage({
    id: 'dsh-plugin-dev-pitfalls', title: 'DSH 插件开发踩坑手册', category: 'references',
    tags: ['dsh', 'pitfall'], source: 'agent:session-2026-08-27', confidence: 'extracted', created: NOW, updated: NOW,
    body: '## Cron 时区被强制成 UTC\n\ndsh-scheduler 的 cron 表达式按 UTC 解释。',
  })
  store.writePage({
    id: 'rate-limiting', title: 'Rate Limiting 踩坑', category: 'concepts',
    tags: ['rate-limiting', 'api'], source: 's', confidence: 'extracted', created: NOW, updated: NOW,
    body: '429 处理要指数退避。',
  })
}

/** user/message 事件：`source.kind === 'user'` 才是「直接用户任务」（权威判据见 dsh-doublecheck）。 */
function userEvent(seq, text, kind = 'user') {
  return { type: 'user/message', seq, data: { source: { kind }, content: [{ type: 'text', text }] } }
}
/**
 * tool/call 事件：真实宿主在 turn/step/tool 事件上都带 `data.turn`，并且**带 `callId`**
 * （见 dsh-session 的 SessionEventMap）——回合边界靠 turn，而失败签名的「工具名 + 命令指纹」
 * 靠 `tool/result → message.source.callId → tool/call.callId` 回连拿到。
 * 夹具早年漏了 callId，于是回连永远失败、签名退化成 `tool::`，任何"按真实签名建的库页/断言"都对不上
 * （2026-10-13 实测踩到，排查花了很久）。
 */
function toolCall(seq, name, args, turn = 1) {
  return { type: 'tool/call', seq, data: { callId: 'call_' + seq, name, arguments: JSON.stringify(args), turn } }
}
/** 本插件自己注入过的提醒（落盘后回放时会出现在事件流里）。
 *  DSH 0.2.x 会话 V4 的物理行准入拒绝 `kind: 'plugin'`，所以新日志写 producer-owned 的包名 kind。 */
function injectedNoticeEvent(seq, summary) {
  return { type: 'user/message', seq, data: { source: { kind: 'dsh-knj-obsidian', form: 'notice', summary } } }
}
/** 升级前写进旧日志的原始包装（V3→V4 迁移会把它升格为 plugin:<name>；进程内的旧数组仍可能是原样）。 */
function legacyInjectedNoticeEvent(seq, summary) {
  return { type: 'user/message', seq, data: { source: { kind: 'plugin', plugin: 'dsh-knj-obsidian', form: 'notice', summary } } }
}

test('matchTaskPages：任务原话提到术语时召回相关页（页面侧词表扫文本，绝对命中数）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  const hits = matchTaskPages(store, '帮我看看 dsh-scheduler 的 cron 时区问题，插件里定时任务没触发')
  const ids = hits.map((h) => h.id)
  assert.ok(ids.includes('dsh-plugin-dev-pitfalls'), '应召回踩坑手册')
  assert.ok(hits[0].hits.length > 0, '每条候选必须给出命中词（模型据此判断要不要读）')
  assert.ok(hits[0].source.length > 0, '候选需带 source 以便追溯')
})

test('matchTaskPages：无关任务必须完全静默（宁可不说是第一原则）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  assert.deepEqual(matchTaskPages(store, '帮我把这张图片的尺寸改成 800x600'), [])
  assert.deepEqual(matchTaskPages(store, '今天天气怎么样'), [])
})

test('泛词降权回归（2026-10-14 实测）：dsh/web 这类生态名不得单独撑起命中', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  // 构造实测场景：一个"宽相关"的索引页，标题同时含 dsh 与 web（于是 web 在小库里 df=1 拿满权重）
  store.writePage({
    id: 'dsh-web-index', title: 'dsh-web 排查会话索引', category: 'references',
    tags: ['index'], source: 's', confidence: 'extracted', created: NOW, updated: NOW,
    body: '## 本批会话\n\ndsh web 相关排查的溯源清单与待办。',
  })

  // 只有 dsh+web 两个泛词可命中、没有任何主题词 → 必须沉默
  // （无降权时：web(df=1)=1.0 + dsh(df=2)=0.7 = 1.7 ≥ 1，会误触发并传导进二档正文注入）
  assert.deepEqual(matchTaskPages(store, '语义检索是 dsh web 启动预热还是冷启动'), [],
    '生态名不是区分信号；这类"宽相关"索引页不得被弱命中')

  // 主题词在场时不受影响：真命中的分数由主题词撑起
  const hits = matchTaskPages(store, '帮我看看 dsh-scheduler 的 cron 时区问题，插件里定时任务没触发')
  assert.ok(hits.length > 0 && hits.some((h) => h.id === 'dsh-plugin-dev-pitfalls'), '主题词（cron/时区/定时）照常命中')
})

test('matchTaskPages：空库 / 空任务文本不得抛错，返回空数组', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.deepEqual(matchTaskPages(store, 'dsh 插件的时区问题'), [])
  seed(store)
  assert.deepEqual(matchTaskPages(store, '   '), [])
})

test('matchTaskPages：结果有上限且按分降序（不把整库倒给模型）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  const hits = matchTaskPages(store, 'dsh 插件 dsh 插件 dsh 插件 pitfall 踩坑 时区 cron', { max: 1 })
  assert.equal(hits.length, 1)
})

test('A3 防自激循环：插件注入的消息绝不被当成新任务', (t) => {
  const events = [
    userEvent(1, '帮我修一下 dsh-scheduler 的时区问题'),
    // 本插件自己注入的提醒（形态对齐 createUserMessage({ source: { kind: 'plugin', ... } })）
    userEvent(2, '[知识库提示] 相关页面：dsh-plugin-dev-pitfalls', 'plugin'),
    // 宿主注入的 AGENTS.md 基线
    userEvent(3, '## 动手前先看知识库', 'agent-instructions'),
    userEvent(4, 'DSH file policy snapshot', 'runtime-context'),
  ]
  const latest = latestDirectUserTask(events)
  assert.equal(latest.seq, 1, '只有 source.kind === \'user\' 的才算任务')
  assert.match(latest.text, /时区问题/)
})

test('latestDirectUserTask：取最后一条直接用户消息；没有则返回 undefined', () => {
  assert.equal(latestDirectUserTask([]), undefined)
  assert.equal(latestDirectUserTask([userEvent(1, '', 'plugin')]), undefined)
  const events = [userEvent(1, '第一件事'), userEvent(2, '第二件事')]
  assert.equal(latestDirectUserTask(events).seq, 2)
})

test('L5 foldTurnFacts：读过库 + 改过库外文件 + 没写回库 → 三者齐备才提醒', (t) => {
  // 齐备
  const full = foldTurnFacts([
    toolCall(1, 'read', { file_path: 'D:\\workspace\\iobs_pro\\.wiki\\index.md' }),
    toolCall(2, 'edit', { file_path: 'D:\\workspace\\iobs_pro\\plugins\\x\\src\\a.ts' }),
  ])
  assert.deepEqual(full, { readVault: true, mutatedOutside: true, wroteVault: false })

  // 已写回 → 不再提醒
  const captured = foldTurnFacts([
    toolCall(1, 'read', { file_path: '.wiki\\index.md' }),
    toolCall(2, 'edit', { file_path: 'plugins\\x\\src\\a.ts' }),
    toolCall(3, 'wiki_capture', { title: 'x' }),
  ])
  assert.equal(captured.wroteVault, true)

  // 没读过库 → 不提醒
  const noRead = foldTurnFacts([toolCall(1, 'edit', { file_path: 'plugins\\x\\src\\a.ts' })])
  assert.equal(noRead.readVault, false)

  // 只改了库内的页面（属于知识维护本身）→ 不算「改了代码」
  const onlyVaultEdit = foldTurnFacts([
    toolCall(1, 'read', { file_path: '.wiki\\index.md' }),
    toolCall(2, 'edit', { file_path: '.wiki\\references\\a.md' }),
  ])
  assert.equal(onlyVaultEdit.mutatedOutside, false)

  // 语义检索也算「用过库」
  const semantic = foldTurnFacts([toolCall(1, 'wiki_search_semantic', { query: 'x' }), toolCall(2, 'write', { file_path: 'plugins\\y.ts' })])
  assert.equal(semantic.readVault, true)
})

test('renderTaskReminder / renderCaptureReminder：文案含关键动作与可追溯信息', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  const text = renderTaskReminder(matchTaskPages(store, 'dsh-scheduler 的 cron 时区问题'))
  assert.match(text, /dsh-plugin-dev-pitfalls/)
  assert.match(text, /忽略|无关/, '必须给模型「可以忽略」的出口，否则会把提醒当命令')
  assert.ok(!/\bMUST\b|必须读/.test(text), '不得写成命令式（它不是门禁）')

  const capture = renderCaptureReminder()
  assert.match(capture, /wiki_capture|wiki_ingest/)
})

test('A6 开关：KNJ_OBSIDIAN_TRIGGER=off 时整体关闭', () => {
  assert.equal(triggerEnabled({}), true)
  assert.equal(triggerEnabled({ KNJ_OBSIDIAN_TRIGGER: 'off' }), false)
  assert.equal(triggerEnabled({ KNJ_OBSIDIAN_TRIGGER: ' OFF ' }), false)
  assert.equal(triggerEnabled({ KNJ_OBSIDIAN_TRIGGER: 'on' }), true)
})

// ---------------------------------------------------------------------------
// 接线层（installTrigger）：用假 host / 假 agent 断言真实行为。
// 注入文本走注入点 deps.createNotice —— 默认实现会动态 import 宿主的 @deepseek-ai/dsh-llm，
// 在插件仓库里解析不到，因此测试必须注入（也正是它可注入的原因）。
// ---------------------------------------------------------------------------

function fakeHost() {
  const handlers = new Map()
  return { on: (event, handler) => handlers.set(event, handler), handlers }
}
function fakeAgent(events, { delegationDepth, cwd } = {}) {
  const injected = []
  const session = { snapshotEvents: () => events }
  if (delegationDepth !== undefined) session.header = { delegationDepth }
  // L0：会话工作目录取自 SessionHeader.cwd（宿主契约）
  if (cwd !== undefined) session.header = { ...(session.header ?? {}), cwd }
  // inject 挂在 **agent** 上（不是 session 上）：宿主注入接口就是 agent.inject
  // 真实宿主会把注入的消息落进会话日志（producer-owned kind 的 user/message）——
  // 这正是 L1 二档/跨重启去重的判据来源，夹具必须还原这一步，否则测的不是真实链路。
  let seq = 10_000
  const inject = (m) => {
    injected.push(m)
    events.push({
      type: 'user/message',
      seq: (seq += 1),
      data: { source: { kind: 'dsh-knj-obsidian', form: 'notice', summary: m.summary } },
    })
  }
  return { injected, agent: { session, inject } }
}
const notice = (text, summary) => ({ text, summary })

async function preStep(host, agent) {
  return host.handlers.get('agent/pre-step')({ agent }, async () => ({ kind: 'ok' }))
}

/**
 * 触发 L2 的 tools/pre-execute 并返回 host 的决定。
 * `nextCalls` 用于断言「我们确实把决定权先交给了宿主」（waterfall 顺序契约）。
 */
async function gateExecute(host, agent, name, args) {
  let nextCalls = 0
  const decision = await host.handlers.get('tools/pre-execute')(
    { name, arguments: JSON.stringify(args), agent },
    async () => { nextCalls += 1; return { kind: 'allow' } },
  )
  return { decision, nextCalls }
}

test('A2 L1 接线：新任务命中 → 注入一次；同一任务后续步骤不再注入；无命中则完全静默', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  const host = fakeHost()
  installTrigger(host, { currentReadonly: () => store }, { createNotice: async (text, summary) => notice(text, summary) })

  const events = [userEvent(1, '帮我看看 dsh-scheduler 的 cron 时区问题，插件里定时任务没触发')]
  const { agent, injected } = fakeAgent(events)

  await preStep(host, agent)
  assert.equal(injected.length, 1, '新任务命中应注入一次')
  assert.match(injected[0].text, /dsh-plugin-dev-pitfalls/, '提醒必须给出候选页 id')
  assert.match(injected[0].text, /命中：/, '提醒必须给出「为什么提这一页」（命中词）——只给 id 等于让模型盲猜')
  assert.match(injected[0].text, /忽略|无关/)
  assert.equal(injected[0].summary, taskSummaryOf(1), '摘要带任务 seq：重启后据此判定同一任务已提醒')

  // 同一任务的后续步骤（或多个 pre-step）不得重复注入
  await preStep(host, agent)
  await preStep(host, agent)
  assert.equal(injected.length, 1, '同一个任务只提醒一次')

  // 新任务但无关 → 静默
  events.push(userEvent(2, '帮我把这张图片的尺寸改成 800x600'))
  await preStep(host, agent)
  assert.equal(injected.length, 1, '无关任务必须静默')
})

test('A3 接线：只有插件/宿主注入的消息时不得触发（防自激循环）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  const host = fakeHost()
  installTrigger(host, { currentReadonly: () => store }, { createNotice: async (text) => notice(text) })

  const events = [
    userEvent(1, 'dsh 插件的 cron 时区问题', 'plugin'),
    userEvent(2, '## 动手前先看知识库', 'agent-instructions'),
  ]
  const { agent, injected } = fakeAgent(events)
  await preStep(host, agent)
  assert.equal(injected.length, 0, '非直用户消息绝不能当成任务（否则会自激循环）')
})

test('A5 已移除（2026-10-13）：三者齐备也不得注入任何沉淀提醒', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  const host = fakeHost()
  installTrigger(host, { currentReadonly: () => store }, { createNotice: async (text) => notice(text) })
  const events = [
    userEvent(1, 'dsh 插件的时区问题'),
    toolCall(2, 'read', { file_path: 'D:\\workspace\\iobs_pro\\.wiki\\index.md' }),
    toolCall(3, 'edit', { file_path: 'D:\\workspace\\iobs_pro\\plugins\\x\\src\\a.ts' }),
  ]
  const { agent, injected } = fakeAgent(events)
  const turnStopping = host.handlers.get('agent/turn-stopping')

  // 旧版本这里会注入「沉淀提醒」，而真实日志显示它把模型推去自主写库（wiki_capture + wiki_lint）。
  // 用户决策：沉淀完全交给 UI 蒸馏通道（那条通道走 wiki_ingest，由用户点击触发）。
  await turnStopping({ agent })
  assert.equal(injected.length, 0, '触发层不得再有任何沉淀/写库的推动')
  await turnStopping({ agent })
  assert.equal(injected.length, 0, '反复触发也不得出现')
})

test('A5 接线：已写回库 / 只改库内页面 时不得提醒', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  const host = fakeHost()
  installTrigger(host, { currentReadonly: () => store }, { createNotice: async (text) => notice(text) })
  const { agent, injected } = fakeAgent([
    toolCall(1, 'read', { file_path: '.wiki\\index.md' }),
    toolCall(2, 'edit', { file_path: 'plugins\\x\\src\\a.ts' }),
    toolCall(3, 'wiki_capture', { title: 'x' }),
  ])
  await host.handlers.get('agent/turn-stopping')({ agent })
  assert.equal(injected.length, 0, '已写回则不再提醒')
})

test('A6 接线：KNJ_OBSIDIAN_TRIGGER=off 时 L1/L5 都不注入，且**一次都不检索**', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  const saved = process.env.KNJ_OBSIDIAN_TRIGGER
  process.env.KNJ_OBSIDIAN_TRIGGER = 'off'
  t.after(() => {
    if (saved === undefined) delete process.env.KNJ_OBSIDIAN_TRIGGER
    else process.env.KNJ_OBSIDIAN_TRIGGER = saved
  })

  const host = fakeHost()
  // 取库这一步是「检索」的入口：计数即可断言「关掉开关 = 连库都不取」
  let providerCalls = 0
  installTrigger(host, { currentReadonly: () => { providerCalls += 1; return store } }, { createNotice: async (text, summary) => notice(text, summary) })
  const { agent, injected } = fakeAgent([
    userEvent(1, 'dsh 插件的 cron 时区问题'),
    toolCall(2, 'read', { file_path: '.wiki\\index.md' }),
    toolCall(3, 'edit', { file_path: 'plugins\\x\\src\\a.ts' }),
  ])
  await preStep(host, agent)
  await host.handlers.get('agent/turn-stopping')({ agent })
  assert.equal(injected.length, 0, '开关关闭时不得注入任何东西')
  assert.equal(providerCalls, 0, '开关关闭时不得检索（取库次数必须为 0）')
})

test('接线：provider 不可用 / 注入点抛错都不得打断主流程', async () => {
  const host = fakeHost()
  installTrigger(
    host,
    { currentReadonly: () => { throw new Error('vault 不可用') } },
    { createNotice: async () => { throw new Error('注入失败') } },
  )
  const { agent } = fakeAgent([userEvent(1, 'dsh 插件的 cron 时区问题')])
  const decision = await preStep(host, agent)
  assert.deepEqual(decision, { kind: 'ok' }, 'pre-step 必须原样返回 decision（触发层不阻断）')
})

// ---------------------------------------------------------------------------
// 对抗审查（2026-09-21）发现的四处缺陷，逐条钉死：
//  1) L5 回合边界：原来按「seq 水位线」折叠，进程重启后水位线是 -1 → 第一次
//     turn-stopping 把**整份历史**当一个回合，把几天前的读库+改码误报成本回合。
//  2) 一次语义：原来只在进程内的 WeakMap 里，重启/恢复会话即可再次注入。
//  3) 只读保证：currentVault() 曾经回退 provider.current()，那条路径会 ensure() 建 .wiki。
//  4) 安装健壮性：ctx.on 抛错会冒泡出插件 apply。
// ---------------------------------------------------------------------------

test('L5 回合边界：本回合只读了代码（上一回合才读过库+改过码）→ 必须静默', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  const host = fakeHost()
  installTrigger(host, { currentReadonly: () => store }, { createNotice: async (text, summary) => notice(text, summary) })
  const { agent, injected } = fakeAgent([
    // 回合 1：读过库 + 改了代码（旧实现会在这里置位，且把这份历史带进回合 2）
    toolCall(1, 'read', { file_path: '.wiki\\index.md' }, 1),
    toolCall(2, 'edit', { file_path: 'plugins\\x\\src\\a.ts' }, 1),
    // 回合 2：只读了一个源码文件——本回合没有「用过库」
    userEvent(3, '继续'),
    toolCall(4, 'read', { file_path: 'plugins\\x\\src\\a.ts' }, 2),
  ])
  await host.handlers.get('agent/turn-stopping')({ agent })
  assert.equal(injected.length, 0, '上一回合的事实不得算进本回合（否则每个新回合都会误报）')
})

test('L5 一次语义可跨重启：日志里已有沉淀提醒 → 新装的实例不得再注入', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  const host = fakeHost()
  installTrigger(host, { currentReadonly: () => store }, { createNotice: async (text, summary) => notice(text, summary) })
  const { agent, injected } = fakeAgent([
    toolCall(1, 'read', { file_path: '.wiki\\index.md' }, 1),
    toolCall(2, 'edit', { file_path: 'plugins\\x\\src\\a.ts' }, 1),
    injectedNoticeEvent(3, CAPTURE_SUMMARY), // 重启前那次提醒已经落盘
  ])
  await host.handlers.get('agent/turn-stopping')({ agent })
  assert.equal(injected.length, 0, '会话日志里已有提醒 → 重启后不得重复注入（WeakMap 会丢，日志不会）')
})

test('L1 一次语义可跨重启：日志里已有该任务的提示 → 同一任务不得再注入', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  const host = fakeHost()
  installTrigger(host, { currentReadonly: () => store }, { createNotice: async (text, summary) => notice(text, summary) })
  const { agent, injected } = fakeAgent([
    userEvent(1, 'dsh 插件的 cron 时区问题'),
    injectedNoticeEvent(2, taskSummaryOf(1)),
  ])
  await preStep(host, agent)
  assert.equal(injected.length, 0, '同一任务（seq 1）在重启后不得重复注入')
})

test('只读保证：provider 缺 currentReadonly 时不得回退 current()（那条路径会建 .wiki）', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-trigger-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new VaultStore(dir)
  store.ensure() // 库本身存在；要断言的是「触发层不会再去建/改任何东西」

  let currentCalls = 0
  const host = fakeHost()
  installTrigger(
    host,
    { current: () => { currentCalls += 1; return store } },
    { createNotice: async (text, summary) => notice(text, summary) },
  )
  const { agent, injected } = fakeAgent([
    userEvent(1, 'dsh 插件的 cron 时区问题'),
    toolCall(2, 'read', { file_path: '.wiki\\index.md' }, 1),
    toolCall(3, 'edit', { file_path: 'plugins\\x\\src\\a.ts' }, 1),
  ])
  const decision = await preStep(host, agent)
  assert.equal(currentCalls, 0, '缺 currentReadonly 时必须静默，不得走会 ensure() 的写路径')
  assert.equal(injected.length, 0, '没有只读取库能力 → L1 不触发')
  // L5 不依赖库（只折叠事件），它照常工作——这里只再确认它也没碰写路径
  await host.handlers.get('agent/turn-stopping')({ agent })
  assert.equal(currentCalls, 0, 'L5 同样不得取写路径的库')
  assert.deepEqual(decision, { kind: 'ok' }, '仍不得阻断主流程')
})

test('安装健壮性：宿主 ctx.on 抛错时安装不冒泡，且另一条监听仍生效', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  const handlers = new Map()
  const host = {
    on: (event, handler) => {
      if (event === 'agent/pre-step') throw new Error('宿主拒绝注册 pre-step')
      handlers.set(event, handler)
    },
  }
  assert.doesNotThrow(() => {
    installTrigger(host, { currentReadonly: () => store }, { createNotice: async (text, summary) => notice(text, summary) })
  }, '一条注册失败不得冒泡出插件的 apply（否则会打断后续链路）')

  const { agent, injected } = fakeAgent([
    userEvent(1, '修一下这个报错'),
    // 命令指纹（来自 tool/call）与失败文本都指向 seed 库页的主题（Cron 时区）——
    // 方案 A 用签名当查询串检索库，取的是**命令指纹**部分，因此两者必须同主题。
    // callId 必须与结果事件一致（用 call 的 seq）。
    toolCall(2, 'pwsh', { command: 'cron 时区 定时任务' }, 1),
    toolResult(3, 'Error: cron 定时任务时区没触发', { tool: 'pwsh', turn: 1, callId: 'call_2' }),
    toolCall(4, 'pwsh', { command: 'cron 时区 定时任务' }, 2),
    toolResult(5, 'Error: cron 定时任务时区没触发', { tool: 'pwsh', turn: 2, callId: 'call_4' }),
    toolCall(6, 'pwsh', { command: 'cron 时区 定时任务' }, 3),
    toolResult(7, 'Error: cron 定时任务时区没触发', { tool: 'pwsh', turn: 3, callId: 'call_6' }),
  ])
  await handlers.get('agent/turn-stopping')({ agent })
  // pre-step 注册失败后，turn-stopping 上的 L3 路径必须照常工作（用它做见证；
  // L5 已在 2026-10-13 移除，不再注入任何东西，因此不能再用它当见证）
  assert.equal(injected.length, 1, 'pre-step 注册失败不应影响 turn-stopping 的正常工作')
  assert.match(injected[0].text, /已出现 3 次/)
})

test('子代理策略：KNJ_OBSIDIAN_TRIGGER_SUBAGENT=off 时仅顶层会话触发', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  const saved = process.env.KNJ_OBSIDIAN_TRIGGER_SUBAGENT
  t.after(() => {
    if (saved === undefined) delete process.env.KNJ_OBSIDIAN_TRIGGER_SUBAGENT
    else process.env.KNJ_OBSIDIAN_TRIGGER_SUBAGENT = saved
  })

  // 默认：子代理同样触发（提醒不阻断，且子代理也需要知识）
  assert.equal(subagentTriggerEnabled({}), true)
  assert.equal(delegationDepthOf({ header: { delegationDepth: 2 } }), 2)
  assert.equal(delegationDepthOf({}), 0)

  const host = fakeHost()
  installTrigger(host, { currentReadonly: () => store }, { createNotice: async (text, summary) => notice(text, summary) })
  const events = [userEvent(1, 'dsh 插件的 cron 时区问题')]

  const sub = fakeAgent(events, { delegationDepth: 1 })
  await preStep(host, sub.agent)
  assert.equal(sub.injected.length, 1, '默认策略下子代理也会被提醒')

  process.env.KNJ_OBSIDIAN_TRIGGER_SUBAGENT = 'off'
  const sub2 = fakeAgent([userEvent(2, 'dsh 插件的 cron 时区问题')], { delegationDepth: 1 })
  await preStep(host, sub2.agent)
  assert.equal(sub2.injected.length, 0, '开关关闭后子代理不再触发')

  const top = fakeAgent([userEvent(3, 'dsh 插件的 cron 时区问题')], { delegationDepth: 0 })
  await preStep(host, top.agent)
  assert.equal(top.injected.length, 1, '顶层会话不受子代理开关影响')
})

test('纯函数：currentTurnOf / turnToolCalls / injectedNotices 的边界', () => {
  assert.equal(currentTurnOf([]), null)
  assert.equal(currentTurnOf([userEvent(1, 'x')]), null, 'user/message 不带回合号')
  assert.equal(currentTurnOf([toolCall(1, 'read', {}, 3), userEvent(2, 'x')]), 3, '取最后一条带回合号的事件')
  assert.equal(currentTurnOf([toolCall(1, 'read', {}, 1), toolCall(2, 'read', {}, 2)]), 2, '取最后一个回合号')

  const calls = turnToolCalls([toolCall(1, 'read', {}, 1), toolCall(2, 'edit', {}, 2), userEvent(3, 'x')], 2)
  assert.equal(calls.length, 1, '只留本回合的 tool/call')
  assert.equal(calls[0].data.name, 'edit')

  const notices = injectedNotices([
    injectedNoticeEvent(1, CAPTURE_SUMMARY),
    legacyInjectedNoticeEvent(2, taskSummaryOf(7)),
    { type: 'user/message', seq: 3, data: { source: { kind: 'plugin:dsh-knj-obsidian', form: 'notice', summary: '知识库提示全文#7' } } },
    { type: 'user/message', seq: 4, data: { source: { kind: 'plugin', plugin: 'other-plugin', summary: '别的插件' } } },
    userEvent(5, '人说的话'),
  ])
  assert.deepEqual(
    [...notices].sort(),
    [CAPTURE_SUMMARY, taskSummaryOf(7), '知识库提示全文#7'].sort(),
    '新形态（包名 kind）、迁移形态（plugin:<name>）、旧日志原样（kind:plugin）三种都要认；别的插件/用户消息不算',
  )
})

// ---------------------------------------------------------------------------
// L0（2026-09-28）：会话级库绑定与身份注入
//
// 治的病：触发层原先一律读 provider 的**全局当前库**，而那是宿主进程内存里的单值——实测内存与
// 磁盘注册表已经不一致（内存 iobs_pro / 磁盘 tap-taste）。于是「在 A 工作区问 A 的事」被 B 库的
// 页面命中，提示答偏 → 模型学会忽略 → 表现为「这个插件根本不查库」。
// ---------------------------------------------------------------------------

test('L0 接线：命中必须来自**本会话**的库，不是全局当前库', async (t) => {
  // 会话库：一个完整的工作区（库就在会话 cwd，与真实布局一致）
  const sessionWs = makeWorkspace(t, 'sess')
  sessionWs.store.writePage({
    id: 'session-vault-page', title: '会话库里的主题 甲', category: 'concepts',
    tags: ['sessiononly'], source: 's', confidence: 'extracted', created: NOW, updated: NOW,
    body: '## 会话库专属小节 甲\n\n正文。',
  })
  // 全局当前库：另一个库，放一页同样能被任务文本命中的页面（旧实现就会答成它）
  const globalVault = makeVault()
  t.after(() => rmSync(globalVault.dir, { recursive: true, force: true }))
  globalVault.store.writePage({
    id: 'global-vault-page', title: '全局库里的主题 乙', category: 'concepts',
    tags: ['globalonly'], source: 's', confidence: 'extracted', created: NOW, updated: NOW,
    body: '## 全局库专属小节 乙\n\n正文。',
  })

  const provider = {
    currentReadonly: () => globalVault.store,
    readonlyVaultForRoot: (root) => sessionWs.manager.readonlyVaultForRoot(root),
  }
  const host = fakeHost()
  installTrigger(host, provider, { createNotice: async (text, summary) => notice(text, summary) })

  // 任务原话同时命中两个库的页面词表（主题/小节/两个专属标签都在文本里）。
  // 命中词必须 ≥2，否则词表门槛（MIN_TERMS）会让整条通道静默。
  const { agent, injected: noticelist } = fakeAgent(
    [userEvent(1, '会话库 主题 的 sessiononly 问题，顺带 globalonly 也看一眼')],
    { cwd: sessionWs.dir },
  )
  await preStep(host, agent)
  assert.equal(noticelist.length, 1, '会话库有相关页 → 必须提示')
  assert.match(noticelist[0].text, /session-vault-page/, '提示必须来自本会话的库')
  assert.doesNotMatch(noticelist[0].text, /global-vault-page/, '绝不能混入全局当前库的页面')
})

test('L0 接线：会话工作区没有库 → 不得回退到别人的库（宁可不说是第一原则）', async (t) => {
  const globalVault = makeVault()
  t.after(() => rmSync(globalVault.dir, { recursive: true, force: true }))
  globalVault.store.writePage({
    id: 'global-vault-page', title: '全局库里的主题 乙', category: 'concepts',
    tags: ['globalonly'], source: 's', confidence: 'extracted', created: NOW, updated: NOW,
    body: '## 全局库专属小节 乙\n\n正文。',
  })

  // 会话工作区确实没有库：provider 明确回答 undefined（即「向上找也没有 .wiki」）
  // 注意不能拿 tmpdir 下的目录去测——它向上会认到 C:\Users\<user>\.wiki（用户自己的库确实注册着），
  // 那是真实行为不是缺陷；这里测的是 L0 的契约：**没有库就不许回退到别人的库**。
  const bare = mkdtempSync(join(tmpdir(), 'dsh-obsidian-bare-'))
  t.after(() => rmSync(bare, { recursive: true, force: true }))
  const manager = new VaultManager({ registryFile: join(bare, 'registry.json'), cwdRoot: bare })

  const host = fakeHost()
  installTrigger(
    host,
    { currentReadonly: () => globalVault.store, readonlyVaultForRoot: () => undefined },
    { createNotice: async (text, summary) => notice(text, summary) },
  )
  const { agent, injected } = fakeAgent([userEvent(1, 'globalonly 的问题')], { cwd: bare })
  await preStep(host, agent)
  assert.equal(injected.length, 0, '明确判定无库时，静默优先于任何回退（旧实现会拿全局库答偏）')
  // 只读契约用真实 manager 钉一次：解析不得在磁盘上建出 .wiki
  assert.equal(manager.readonlyVaultForRoot(bare), undefined)
  assert.equal(existsSync(join(bare, '.wiki')), false, '只读解析绝不建库（L0 的硬契约）')
})

test('L0 接线：session-start 注入库身份；空库不注入；resume 不重复注入', async (t) => {
  const ws = makeWorkspace(t, 'identity')
  seed(ws.store)
  const empty = makeVault()
  t.after(() => rmSync(empty.dir, { recursive: true, force: true }))

  const provider = { currentReadonly: () => undefined, readonlyVaultForRoot: (root) => ws.manager.readonlyVaultForRoot(root) }
  const host = fakeHost()
  installTrigger(host, provider, { createNotice: async (text, summary) => notice(text, summary) })
  const start = host.handlers.get('agent/session-start')
  assert.ok(start, 'L0 必须挂 agent/session-start（宿主文档：这里就是 seed 上下文的官方位置）')

  // handler 是 async（内部必须 await createNotice）→ 触发后要等一个微任务再断言，
  // 否则断到的是「还没注入」。这个坑本身值得留在注释里：同步签名的宿主钩子里漏 await，
  // 结果是把一个 Promise 当消息注进去（宿主不会报错）。
  const first = fakeAgent([], { cwd: ws.dir })
  await start({ agent: first.agent })
  assert.equal(first.injected.length, 1, '有页面的库应在会话开始告知身份')
  assert.match(first.injected[0].text, /知识库/)
  assert.match(first.injected[0].text, /2 页/, '身份块要给出页数（让模型知道库里有货）')
  assert.equal(first.injected[0].summary, VAULT_IDENTITY_SUMMARY)

  // resume：日志里已有身份块 → 不重复注入
  const resumed = fakeAgent([injectedNoticeEvent(1, VAULT_IDENTITY_SUMMARY)], { cwd: ws.dir })
  start({ agent: resumed.agent })
  assert.equal(resumed.injected.length, 0, '身份块每会话一次，重启/恢复不重复')

  // 空库：不注入（旧原则——宁可不说是默认行为）
  const hostEmpty = fakeHost()
  installTrigger(hostEmpty, { currentReadonly: () => empty.store }, { createNotice: async (text, summary) => notice(text, summary) })
  const blank = fakeAgent([])
  hostEmpty.handlers.get('agent/session-start')({ agent: blank.agent })
  assert.equal(blank.injected.length, 0, '空库不注入身份（不制造「有货」的错觉）')
})

test('resolveSessionVault：cwd 在子目录时向上认到工作区根（库在工作区根，cwd 是子目录）', (t) => {
  const ws = makeWorkspace(t, 'nested')
  const direct = resolveSessionVault(ws.manager, ws.dir)
  assert.ok(direct, '工作区根直接命中')
  const nested = resolveSessionVault(ws.manager, join(ws.dir, 'src', 'deep'))
  assert.ok(nested, 'cwd 是子目录时也要认到工作区根（否则提示又变沉默）')
  assert.equal(nested.identity.root, join(ws.dir, '.wiki'))

  // 只读契约：解析不得在磁盘上建出 .wiki
  const bare = mkdtempSync(join(tmpdir(), 'dsh-obsidian-bare-'))
  t.after(() => rmSync(bare, { recursive: true, force: true }))
  const manager = new VaultManager({ registryFile: join(bare, 'registry.json'), cwdRoot: bare })
  assert.equal(manager.readonlyVaultForRoot(bare), undefined)
  assert.equal(existsSync(join(bare, '.wiki')), false, '只读解析绝不建库（这是 L0 的硬契约）')
})

test('L0 纯函数：身份块文案与开关', () => {
  const text = renderVaultIdentity({ name: 'proj', root: 'D:\\proj', pageCount: 12, indexPath: 'D:\\proj\\.wiki\\index.md' })
  assert.match(text, /proj/)
  assert.match(text, /12 页/)
  assert.match(text, /index\.md/)
  assert.match(text, /wiki_query/) // 给模型一条明确的检索入口

  assert.equal(vaultIdentityEnabled({}), true)
  assert.equal(vaultIdentityEnabled({ KNJ_OBSIDIAN_VAULT_IDENTITY: 'off' }), false)
  assert.equal(fullTextStageEnabled({}), true)
  assert.equal(fullTextStageEnabled({ KNJ_OBSIDIAN_TRIGGER_FULLTEXT: 'off' }), false)
})

// ---------------------------------------------------------------------------
// L1 二档（2026-09-28）：一档被忽略 → 追投正文
//
// 治的病：一档只给「路径 + 命中词 + 摘要」，模型可能看一眼就继续干活（提示被忽略）；
// 老实现没有任何后续动作，于是「库里有货但没查」无限重复。二档把正文直接给它。
// 判据是**事实**：注入所在回合之后的某个回合结束时，整个回合没碰过库。
// ---------------------------------------------------------------------------

test('foldHintOutcome：本回合是否碰过库（读 .wiki / 任何 wiki_* 工具都算）', () => {
  assert.equal(foldHintOutcome([]).consultedVault, false)
  assert.equal(foldHintOutcome([toolCall(1, 'edit', { file_path: 'src\\a.ts' })]).consultedVault, false, '改代码不算碰库')
  assert.equal(foldHintOutcome([toolCall(1, 'read', { file_path: '.wiki\\index.md' })]).consultedVault, true)
  assert.equal(foldHintOutcome([toolCall(1, 'grep', { path: 'C:\\x\\.wiki\\concepts' })]).consultedVault, true)
  assert.equal(foldHintOutcome([toolCall(1, 'wiki_read', { id: 'p' })]).consultedVault, true, 'wiki_* 工具一律算碰库')
  assert.equal(foldHintOutcome([toolCall(1, 'read', { file_path: 'src\\a.ts' })]).consultedVault, false, '读源码不算')
})

test('L1 二档接线：一档被忽略（整个回合没碰库）→ 追投正文，且每任务至多一次', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.writePage({
    id: 'cron-page', title: 'Cron 时区与定时任务', category: 'concepts',
    tags: ['cron'], source: 's', confidence: 'extracted', created: NOW, updated: NOW,
    body: '## Cron 时区被强制成 UTC\n\n定时任务必须显式声明时区，否则按 UTC 解释。',
    summary: '定时任务的时区陷阱',
  })

  const host = fakeHost()
  installTrigger(host, { currentReadonly: () => store }, { createNotice: async (text, summary) => notice(text, summary) })
  const events = [
    userEvent(1, '帮我看一下定时任务的 cron 时区问题'),
    toolCall(2, 'edit', { file_path: 'src\\a.ts' }, 1),
  ]
  const { agent, injected } = fakeAgent(events)

  await preStep(host, agent) // 回合 1：一档
  assert.equal(injected.length, 1)
  assert.match(injected[0].text, /定时任务的时区陷阱/, '一档要带摘要（不再只给路径）')
  assert.equal(injected[0].summary, taskSummaryOf(1))

  // 回合 1 结束：注纳入所在回合就是本回合 → 不给模型机会，不得追投
  await host.handlers.get('agent/turn-stopping')({ agent })
  assert.equal(injected.length, 1, '同回合追投 = 没给模型机会，是噪声不是补救')

  // 回合 2：模型全程没碰库 → 二档追投正文
  events.push(toolCall(3, 'edit', { file_path: 'src\\b.ts' }, 2))
  await host.handlers.get('agent/turn-stopping')({ agent })
  assert.equal(injected.length, 2, '忽略了一档 → 应追投正文')
  assert.match(injected[1].text, /定时任务必须显式声明时区/, '二档必须给正文，不是再给一次路径')
  assert.equal(injected[1].summary, fullTextSummaryOf(1))

  // 回合 3：仍是同一任务 → 不再追投第二次
  events.push(toolCall(4, 'edit', { file_path: 'src\\c.ts' }, 3))
  await host.handlers.get('agent/turn-stopping')({ agent })
  assert.equal(injected.length, 2, '二档每任务至多一次')
})

test('L1 二档接线：模型看过库 → 不得追投（避免把「已经查过」的任务再灌一遍正文）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  const host = fakeHost()
  installTrigger(host, { currentReadonly: () => store }, { createNotice: async (text, summary) => notice(text, summary) })
  const events = [userEvent(1, '帮我看看 dsh-scheduler 的 cron 时区问题，插件里定时任务没触发')]
  const { agent, injected } = fakeAgent(events)
  await preStep(host, agent)
  assert.equal(injected.length, 1)

  // 回合 2：模型顺着一档提示去读了库
  events.push(toolCall(2, 'read', { file_path: '.wiki\\references\\dsh-plugin-dev-pitfalls.md' }, 2))
  await host.handlers.get('agent/turn-stopping')({ agent })
  assert.equal(injected.length, 1, '模型已经查过库 → 二档不必出现')
})

test('L1 二档接线：跨重启按摘要去重（日志里已有全文提示 → 不再追投）+ 开关可关', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  const host = fakeHost()
  installTrigger(host, { currentReadonly: () => store }, { createNotice: async (text, summary) => notice(text, summary) })
  const events = [
    userEvent(1, '帮我看看 dsh-scheduler 的 cron 时区问题，插件里定时任务没触发'),
    injectedNoticeEvent(2, taskSummaryOf(1)),
    injectedNoticeEvent(3, fullTextSummaryOf(1)), // 重启前已追投过
    toolCall(4, 'edit', { file_path: 'src\\a.ts' }, 2),
  ]
  const { agent, injected } = fakeAgent(events)
  await host.handlers.get('agent/turn-stopping')({ agent })
  assert.equal(injected.length, 0, '跨重启去重：同一任务的正文只追投一次')

  // 开关关闭 → 二档整体不出现
  const saved = process.env.KNJ_OBSIDIAN_TRIGGER_FULLTEXT
  process.env.KNJ_OBSIDIAN_TRIGGER_FULLTEXT = 'off'
  t.after(() => {
    if (saved === undefined) delete process.env.KNJ_OBSIDIAN_TRIGGER_FULLTEXT
    else process.env.KNJ_OBSIDIAN_TRIGGER_FULLTEXT = saved
  })
  const host2 = fakeHost()
  installTrigger(host2, { currentReadonly: () => store }, { createNotice: async (text, summary) => notice(text, summary) })
  const events2 = [userEvent(1, '帮我看看 dsh-scheduler 的 cron 时区问题，插件里定时任务没触发')]
  const second = fakeAgent(events2)
  await preStep(host2, second.agent)
  events2.push(toolCall(2, 'edit', { file_path: 'src\\a.ts' }, 2))
  await host2.handlers.get('agent/turn-stopping')({ agent: second.agent })
  assert.equal(second.injected.length, 1, '开关关闭时只留一档')
})

test('taskSeqOfSummary：摘要尾号可解析（去重键的解析契约）', () => {
  assert.equal(taskSeqOfSummary(taskSummaryOf(42), TASK_SUMMARY_PREFIX), 42)
  assert.equal(taskSeqOfSummary(fullTextSummaryOf(7), FULLTEXT_SUMMARY_PREFIX), 7)
  assert.equal(taskSeqOfSummary('知识库提示', TASK_SUMMARY_PREFIX), null, '无尾号 → 不是本前缀的键')
  assert.equal(taskSeqOfSummary('知识库提示#abc', TASK_SUMMARY_PREFIX), null)
  assert.equal(taskSeqOfSummary('别的前缀#1', TASK_SUMMARY_PREFIX), null)
})

// ---------------------------------------------------------------------------
// L3（2026-09-28）：复发信号——同一个失败第二次出现才说话
//
// 治的病：模型反复踩同一个坑（库里有那页却不查）。判据必须是**失败证据**，
// 不能按 error 关键字乱扫：读一个定义了 error 常量的源码文件，正文里到处是 error。
// 契约来源：dsh-session 的 SessionEventMap `tool/result`（turn/step/message.content + 可选 error{name,code}）
// ---------------------------------------------------------------------------

/**
 * tool/result 事件。**形状必须与真实宿主一致**（实测自真实会话日志）：
 * `data.message.content = [{ type:'tool-result', content: [{ type:'text', text }], isError }]`
 * —— 文本在**嵌套**的 content 里，不在顶层。
 *
 * 早期夹具写成扁平的 `{ content: [{ type:'text', text }] }`，于是「L3 读不到工具结果文本」
 * 这个真缺陷在单测里一直保持绿色（2026-10-13 用真实会话日志抓出：含 `[exit code: 1]` 的结果
 * 一条都没被识别）。改夹具形状本身就是在防这个坑复发。
 */
/**
 * tool/result 事件。**形状必须与真实宿主一致**（实测自真实会话日志）：
 * `data.message.content = [{ type:'tool-result', content: [{ type:'text', text }], isError }]`
 * —— 文本在**嵌套**的 content 里，不在顶层；并且带 `message.source.callId`。
 *
 * ⚠️ `callId` 必须与**对应 tool/call 的 callId 完全相同**（真实宿主两边是同一个 call_xx 串）。
 * 早期夹具各自用 `'call_' + seq` 派生，而 call 与 result 的 seq 天然不同（如 call_2 / call_3），
 * 于是回连永远失败、命令指纹为空、签名退化成 `pwsh::Error:`——任何按真实签名写的断言与库页都对不上。
 * 因此调用方需要显式传 `callId`（通常用 call 的 seq）。
 */
function toolResult(seq, text, { turn = 1, tool, error, callId = 'call_' + seq } = {}) {
  const block = {
    type: 'tool-result',
    toolCallId: callId,
    content: [{ type: 'text', text }],
    isError: error !== undefined,
  }
  const data = { turn, message: { source: { kind: 'tool', callId }, content: [block] } }
  if (tool !== undefined) data.name = tool
  if (error !== undefined) data.error = error
  return { type: 'tool/result', seq, data }
}

test('L3 回归：真实 host 的 tool/result 形状必须被读到（文本在嵌套 content 里）', () => {
  // 这条事件是从真实会话日志里逐字抄下来的（2026-10-13，iobs_pro 会话）：
  // 外层 content[0].type === 'tool-result'，文本在它自己的 content[] 里，data.error 为 null。
  // 缺陷版本对这条返回 undefined（文本通道完全没读到），只在宿主显式 error 时才认。
  const real = {
    type: 'tool/result',
    seq: 12,
    data: {
      turn: 1,
      step: 3,
      message: {
        source: { kind: 'tool', callId: 'call_01_SK8vL0TPahqZ3WDBT47u4562' },
        content: [{
          type: 'tool-result',
          toolCallId: 'call_01_SK8vL0TPahqZ3WDBT47u4562',
          content: [{ type: 'text', text: 'Error: tool call timed out after 30000ms' }],
          isError: true,
        }],
      },
    },
  }
  const sig = failureSignatureOf(real)
  assert.ok(sig, '真实形状的异常必须被识别（这正是缺陷版本漏掉的那类：文本只在嵌套 content 里）')
  assert.match(sig, /Error:/, '签名应保留异常指纹')
  // 没有 name 字段时退化为 'tool'，但绝不能因为形状不对而返回 undefined
  assert.match(sig, /^tool::Error:$/)
})

test('L3 判据：非零退出码**单独不算**（PowerShell 管道退出码会骗人，实测）', () => {
  // 真实事故：`... | Select-String -Pattern ...` 因最后一个管道命令没匹配到而返回 1，
  // 宿主如实报 `[exit code: 1]`，于是 7 条**不同**命令都带上了非零码 → 旧判据把
  // 「同一个失败」计到 15 次。退出码必须与异常行同时出现才算失败。
  assert.equal(failureSignatureOf(toolResult(1, '(no output)\n[exit code: 1]', { tool: 'pwsh' })), undefined,
    '只有退出码、没有任何异常行 → 不算失败（宁可不说是第一原则）')
  assert.equal(failureSignatureOf(toolResult(2, 'All good\n[exit code: 0]', { tool: 'pwsh' })), undefined, '零退出码当然不算')
  assert.ok(failureSignatureOf(toolResult(3, '[stderr] An error occurred:\nplus more\n[exit code: 1]', { tool: 'pwsh' })),
    '退出码 + 输出里的错误行 → 算失败')
})

test('L3 回归：user/message 事件不带 data.turn（二档必须回落到 pre-step 记下的 turn）', () => {
  // 实测：真实日志里插件注入的 user/message 不带 turn 字段
  const injected = injectedNoticeEvent(1, taskSummaryOf(7))
  assert.equal(injected.data.turn, undefined, '夹具与实测一致：注入事件没有 turn')
  // 因此 latestNoticeByPrefix 拿到的 turn 是 undefined，二档必须用 state.stageOne.turn 兜底
  const rec = latestNoticeByPrefix([injected], TASK_SUMMARY_PREFIX)
  assert.equal(rec.turn, undefined)
  assert.equal(rec.summary, taskSummaryOf(7))
})

test('L3 回连：tool/result 没有 name，必须靠 callId 回连 tool/call 拿到工具名与命令', (t) => {
  t.diagnostic('实测：真实日志里 33 条 tool/result 全部不带 name（0/33），工具名只能回连得到')
  const call = (seq, callId, name, args) => ({ type: 'tool/call', seq, data: { callId, name, arguments: JSON.stringify(args), turn: 1 } })
  const result = (seq, callId, text) => ({
    type: 'tool/result', seq,
    data: {
      turn: 1,
      message: {
        source: { kind: 'tool', callId },
        content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text }], isError: false }],
      },
    },
  })

  const events = [
    call(1, 'c1', 'pwsh', { command: 'Get-ChildItem -Path "D:\\proj" -File' }),
    result(2, 'c1', 'Error: cannot enumerate directory'),
    call(3, 'c2', 'pwsh', { command: 'node -e "const db=new DatabaseSync(x)"' }),
    result(4, 'c2', 'Error: cannot enumerate directory'),
  ]

  const s1 = failureSignatureOf(events[1], events)
  const s2 = failureSignatureOf(events[3], events)
  assert.match(s1, /^pwsh::/, '工具名必须由回连补上（结果事件自己没有 name）')
  assert.match(s1, /Get-ChildItem/, '签名要带命令指纹')
  assert.notEqual(s1, s2, '同一异常但**不同命令**绝不能合并成一个签名——否则「第二次出现」就失真了')

  // 同一命令再次失败 → 才是真复发（门槛 3，所以要凑够 3 次）。注意 callId 必须各不相同：
  // callIndex 是 callId → 调用的映射，复用同一个 id 会让后写覆盖先写。
  const again = [
    ...events,
    call(5, 'c3', 'pwsh', { command: 'Get-ChildItem -Path "D:\\proj" -File' }),
    result(6, 'c3', 'Error: cannot enumerate directory'),
    call(7, 'c4', 'pwsh', { command: 'Get-ChildItem -Path "D:\\proj" -File' }),
    result(8, 'c4', 'Error: cannot enumerate directory'),
  ]
  assert.equal(foldFailureFrequency(again).get(s1), 3, '同一命令 + 同一失败 = 复发（计数到门槛才触发 L3）')
  assert.equal(recurringFailures(again, new Set()).length, 1, '只应有一个签名达门槛')

  // 拿不到 events（降级路径）也不得抛错，且异常指纹照旧可认
  assert.match(failureSignatureOf(events[1]), /^tool::Error:$/)
})

test('L3 failureSignatureOf：只认结构化失败证据（异常行 / TS 码 / ERR_ / 宿主 error）', () => {
  assert.equal(failureSignatureOf(toolResult(1, 'running...\nError: build failed', { tool: 'pwsh' })),
    'pwsh::Error:', '异常行（输出开头）是最硬的文本证据')
  assert.equal(failureSignatureOf(toolResult(2, "src/a.ts(3,5): error TS2345: Argument of type 'x'. ", { tool: 'pwsh' })),
    'pwsh::error TS2345', 'TypeScript 错误码：码要保留（跨次稳定），行号/位置会被归一化掉')
  assert.equal(failureSignatureOf(toolResult(3, 'AssertionError: 1 !== 2', { tool: 'pwsh' })),
    'pwsh::AssertionError:', '断言失败（边改边测时的真复发）也该被认')
  assert.equal(failureSignatureOf(toolResult(4, '(no output)\n[exit code: 1]', { tool: 'pwsh' })),
    undefined, '退出码单独不算——见下面那条实测回归')
  assert.equal(
    failureSignatureOf(toolResult(5, '', { tool: 'pwsh', error: { name: 'ToolTimeoutError', code: 'TOOL_TIMEOUT' } })),
    'pwsh::ToolTimeoutError TOOL_TIMEOUT',
    '宿主给的工具级失败身份最硬，优先于正文',
  )
  assert.deepEqual(failureSignatureOf(toolResult(6, 'ok', { tool: 'pwsh' })), undefined)
  assert.equal(failureSignatureOf(toolResult(7, '', { tool: 'pwsh' })), undefined, '空结果不算失败')
})

test('L3 假阳性回归（2026-10-13 实测）：输出正文里的失败字样不算工具失败', () => {
  // 1) 引用内容：grep 搜到源码里的 '[exit code: N]' 字符串（真实踩到，被误计一次失败）
  const grepped = toolResult(1, 'Found 30 matches\nsrc/trigger.ts\nLine 42:  /\\[exit code: (\\d+)\\]/\n' + 'x'.repeat(1200), { tool: 'grep' })
  assert.equal(failureSignatureOf(grepped), undefined, 'grep/read 的正文是引用内容，绝不是失败证据')

  // 2) 执行类工具，但"退出码 + 错误字样"出现在正文**深处**（引用内容）→ 不算
  const quoted = toolResult(2, 'ok\n' + 'y'.repeat(600) + '\nError: see the doc\n[exit code: 1]', { tool: 'pwsh' })
  assert.equal(failureSignatureOf(quoted), undefined, '只有输出**开头**的诊断才算这次运行的结论')

  // 3) 失败的测试输出（AssertionError）确实会被认——这是**故意的**：
  //    边改边跑测试导致的反复断言失败，正是 L3 该提醒的真复发。
  //    这里确认它被认，同时确认它必须达门槛（3 次）才说话。
  const failingTests = toolResult(3, 'AssertionError: 1 !== 2', { tool: 'pwsh' })
  assert.equal(failureSignatureOf(failingTests), 'pwsh::AssertionError:')

  // 4) 读源码里到处是 error 字样 → 非执行类工具，正文一律不算
  const reading = toolResult(4, 'const error = new Error("x")\nfunction handleError(e) { /* error path */ }', { tool: 'read' })
  assert.equal(failureSignatureOf(reading), undefined, '读源码正文里的 error 不得当成失败证据')
})

test('L3 foldFailureFrequency / recurringFailures：达门槛才说话，且不重复提示', () => {
  const mk = (seq) => toolResult(seq, 'Error: build failed', { tool: 'pwsh' })
  const sig = 'pwsh::Error:'

  const twice = [mk(1), mk(2)]
  assert.equal(foldFailureFrequency(twice).get(sig), 2)
  assert.deepEqual(recurringFailures(twice, new Set()), [], '出现 2 次仍沉默（实测：2 次多半是「失败一次后重试成功」）')

  const thrice = [mk(1), mk(2), mk(3)]
  assert.equal(RECURRENCE_THRESHOLD, 3)
  assert.equal(foldFailureFrequency(thrice).get(sig), 3)
  const rec = recurringFailures(thrice, new Set())
  assert.equal(rec.length, 1, '第 3 次才说明上一个办法确实没生效')
  assert.equal(recurringFailures(thrice, new Set([rec[0]])).length, 0, '同一签名每会话只提示一次（状态里记着）')

  // 不同工具的同一条报错是两个签名（不要因为「文本一样」就合并）
  const mixed = [mk(1), mk(2), mk(3), toolResult(4, 'Error: build failed', { tool: 'bash' })]
  assert.equal(recurringFailures(mixed, new Set()).length, 1, '只有达到门槛的那个工具算复发')
})

test('L3 文案与摘要：给事实、给出口、摘要长度有界', () => {
  const text = renderRecurrenceReminder('pwsh::[exit code: #]', 3)
  assert.match(text, /已出现 3 次/)
  assert.match(text, /pwsh/)
  assert.match(text, /wiki_query|wiki_search_semantic/)
  assert.match(text, /无关|继续/, '必须给「确认无关就继续」的出口——它不是门禁')
  // 签名可能很长，而摘要是会被回显的日志字段：折成短哈希，长度有界且稳定
  const long = recurrenceSummaryOf('pwsh::' + 'x'.repeat(140))
  assert.ok(long.length <= 24, `摘要长度必须有界，实际 ${long.length}`)
  assert.equal(long, recurrenceSummaryOf('pwsh::' + 'x'.repeat(140)), '同一签名必须得到同一摘要（去重键）')
})

test('L3 方案 A：库里有相关页才提示；库里没货就沉默（宁可不说是第一原则）', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)

  const host = fakeHost()
  installTrigger(host, { currentReadonly: () => store }, { createNotice: async (text, summary) => notice(text, summary) })
  const events = [
    userEvent(1, '修一下这个报错'),
    // ⚠️ tool/call 的 callId 必须与对应 tool/result 的 callId 一致（dsh 的真实契约为 `call_<n>`）：
    // 失败签名的工具名与命令指纹靠这个键回连，键不一致 → 签名退化成 `pwsh::Error:`。
    { type: 'tool/call', seq: 2, data: { callId: 'call_2', name: 'pwsh', arguments: JSON.stringify({ command: 'pnpm build' }), turn: 1 } },
    toolResult(3, 'Error: build failed', { tool: 'pwsh', turn: 1, callId: 'call_2' }),
    { type: 'tool/call', seq: 4, data: { callId: 'call_4', name: 'pwsh', arguments: JSON.stringify({ command: 'pnpm build' }), turn: 2 } },
    toolResult(5, 'Error: build failed', { tool: 'pwsh', turn: 2, callId: 'call_4' }),
    { type: 'tool/call', seq: 6, data: { callId: 'call_6', name: 'pwsh', arguments: JSON.stringify({ command: 'pnpm build' }), turn: 3 } },
    toolResult(7, 'Error: build failed', { tool: 'pwsh', turn: 3, callId: 'call_6' }),
  ]
  const { agent, injected } = fakeAgent(events)

  // seed 的库只有 dsh 踩坑手册与 rate-limiting 两页，与 pnpm/build 无关 → 应当沉默
  assert.equal(vaultCanHelp(store, 'pwsh::pnpm build::Error:'), false, '库里没有相关页时不得说话')
  await host.handlers.get('agent/turn-stopping')({ agent })
  assert.equal(injected.length, 0, '判据达标但库里没货 → 沉默（否则「去查库」是无效建议）')

  // 给库里补一页讲这个失败的 → 同一签名现在该说话了
  store.writePage({
    id: 'pnpm-build-failure', title: 'pnpm build 失败排查', category: 'concepts',
    tags: ['pnpm', 'build'], source: 's', confidence: 'extracted', created: NOW, updated: NOW,
    body: '## pnpm build 报错\n\n构建失败时先看 lock 与 node 版本。',
  })
  assert.equal(vaultCanHelp(store, 'pwsh::pnpm build::Error:'), true, '库里补上相关页后应当说话')

  const host2 = fakeHost()
  installTrigger(host2, { currentReadonly: () => store }, { createNotice: async (text, summary) => notice(text, summary) })
  const second = fakeAgent([...events])
  await host2.handlers.get('agent/turn-stopping')({ agent: second.agent })
  assert.equal(second.injected.length, 1, '库里有货 → 提示一次（这才是 L3 想服务的场景）')
  assert.match(second.injected[0].text, /已出现 3 次/)

  // 复发提示的查询串不得被编码噪声淹没（只保留有信息量的字段/词）
  assert.equal(recurrenceHintOf('edit::D:\\x\\a.ts::FsError FS_EDIT_NOT_FOUND').includes('FsError'), false,
    '工具类噪声词应被剔除，否则查询串会撞库假阳性')
  assert.match(recurrenceHintOf('pwsh::pnpm build::Error:'), /pnpm/)
})

test('L3 接线：复发才注入一次；开关可关；没有库时不说「去查库」', async (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  seed(store)
  // 给库补一页，让方案 A 的"库里有货"前提成立
  store.writePage({
    id: 'pnpm-build-failure', title: 'pnpm build 失败排查', category: 'concepts',
    tags: ['pnpm', 'build'], source: 's', confidence: 'extracted', created: NOW, updated: NOW,
    body: '## pnpm build 报错\n\n构建失败时先看 lock 与 node 版本。',
  })

  const host = fakeHost()
  installTrigger(host, { currentReadonly: () => store }, { createNotice: async (text, summary) => notice(text, summary) })
  const events = [
    userEvent(1, '修一下这个报错'),
    // 带上 tool/call（callId 与结果一致）→ 签名才会是 `pwsh::pnpm build::Error:`，与库里那页对得上
    { type: 'tool/call', seq: 2, data: { callId: 'call_2', name: 'pwsh', arguments: JSON.stringify({ command: 'pnpm build' }), turn: 1 } },
    toolResult(3, 'Error: build failed', { tool: 'pwsh', turn: 1, callId: 'call_2' }),
    { type: 'tool/call', seq: 4, data: { callId: 'call_4', name: 'pwsh', arguments: JSON.stringify({ command: 'pnpm build' }), turn: 2 } },
    toolResult(5, 'Error: build failed', { tool: 'pwsh', turn: 2, callId: 'call_4' }),
    { type: 'tool/call', seq: 6, data: { callId: 'call_6', name: 'pwsh', arguments: JSON.stringify({ command: 'pnpm build' }), turn: 3 } },
    toolResult(7, 'Error: build failed', { tool: 'pwsh', turn: 3, callId: 'call_6' }),
  ]
  const { agent, injected } = fakeAgent(events)

  await host.handlers.get('agent/turn-stopping')({ agent })
  assert.equal(injected.length, 1, '同一失败出现 3 次（达门槛）→ 提示一次')
  assert.match(injected[0].text, /已出现 3 次/)
  assert.ok(injected[0].summary.startsWith('复发提示#'), '摘要用前缀+哈希（长度有界且可去重）')

  await host.handlers.get('agent/turn-stopping')({ agent })
  assert.equal(injected.length, 1, '同一签名不得重复提示')

  // 开关关闭
  const saved = process.env.KNJ_OBSIDIAN_TRIGGER_RECURRENCE
  process.env.KNJ_OBSIDIAN_TRIGGER_RECURRENCE = 'off'
  t.after(() => {
    if (saved === undefined) delete process.env.KNJ_OBSIDIAN_TRIGGER_RECURRENCE
    else process.env.KNJ_OBSIDIAN_TRIGGER_RECURRENCE = saved
  })
  const host2 = fakeHost()
  installTrigger(host2, { currentReadonly: () => store }, { createNotice: async (text, summary) => notice(text, summary) })
  const second = fakeAgent([
    toolResult(1, 'Error: build failed', { tool: 'pwsh', turn: 1 }),
    toolResult(2, 'Error: build failed', { tool: 'pwsh', turn: 2 }),
    toolResult(3, 'Error: build failed', { tool: 'pwsh', turn: 3 }),
  ])
  await host2.handlers.get('agent/turn-stopping')({ agent: second.agent })
  assert.equal(second.injected.length, 0, '开关关闭时不得提示')
  assert.equal(recurrenceEnabled({}), true)
  assert.equal(recurrenceEnabled({ KNJ_OBSIDIAN_TRIGGER_RECURRENCE: 'off' }), false)

  // 没有库的会话：不得提示「去查库」（那毫无意义）
  const host3 = fakeHost()
  installTrigger(host3, { currentReadonly: () => undefined }, { createNotice: async (text, summary) => notice(text, summary) })
  const third = fakeAgent([
    toolResult(1, 'Error: build failed', { tool: 'pwsh', turn: 1 }),
    toolResult(2, 'Error: build failed', { tool: 'pwsh', turn: 2 }),
    toolResult(3, 'Error: build failed', { tool: 'pwsh', turn: 3 }),
  ])
  await host3.handlers.get('agent/turn-stopping')({ agent: third.agent })
  assert.equal(third.injected.length, 0, '无库会话不提示查库（宁可不说是第一原则）')
})

// ---------------------------------------------------------------------------
// L2（2026-09-28）：tools/pre-execute 上的合取门
//
// 触发 = 本任务未查过库 **且** 目标路径高危。它是合取门，不是「每次 edit 都查」
// （后者是 1719 次改库 vs 151 次读库的实测教训，早被否掉）。
// 「高危」的主要来源是**库内被多页提到的路径**——所以 L2 依赖 L0 的会话级库绑定。
// 默认 off；warn 档放行但提醒；block 档拦一次（同一路径显式重试就放行，拦截不是堵死）。
// ---------------------------------------------------------------------------

test('L2 gateModeOf：默认 off（这是唯一会打断的一层，强度必须先观察再开）', () => {
  assert.equal(gateModeOf({}), 'off')
  assert.equal(gateModeOf({ KNJ_OBSIDIAN_GATE: 'warn' }), 'warn')
  assert.equal(gateModeOf({ KNJ_OBSIDIAN_GATE: ' BLOCK ' }), 'block')
  assert.equal(gateModeOf({ KNJ_OBSIDIAN_GATE: 'yes' }), 'off', '未登记的值一律按 off（宁可不说是第一原则）')
})

test('L2 isMutationCall / isHighRiskTarget：只认改文件动作与高危路径', () => {
  assert.equal(isMutationCall('edit'), true)
  assert.equal(isMutationCall('write'), true)
  assert.equal(isMutationCall('str_replace_editor'), true)
  assert.equal(isMutationCall('read'), false, '读文件不进门禁')
  assert.equal(isMutationCall('pwsh'), false)

  assert.equal(isHighRiskTarget('D:\\proj\\migrations\\0001_init.sql', new Set()), true, '迁移目录')
  assert.equal(isHighRiskTarget('.github/workflows/ci.yml', new Set()), true, 'CI 流水线')
  assert.equal(isHighRiskTarget('D:\\proj\\AGENTS.md', new Set()), true, 'agent 指令文件')
  assert.equal(isHighRiskTarget('D:\\proj\\src\\auth\\login.ts', new Set()), true, '鉴权')
  assert.equal(isHighRiskTarget('D:\\proj\\src\\util.ts', new Set()), false, '普通源码不进硬编码集')

  // 库内路径：后缀匹配以容忍不同根
  const vaultPaths = new Set(['src/core/engine.ts'])
  assert.equal(isHighRiskTarget('D:\\proj\\src\\core\\engine.ts', vaultPaths), true)
  assert.equal(isHighRiskTarget('src\\core\\engine.ts', vaultPaths), true)
  assert.equal(isHighRiskTarget('D:\\proj\\src\\other.ts', vaultPaths), false)
})

test('L2 highRiskPathsFromVault：至少两页提到的路径才算（一页提到太偶然）', (t) => {
  const { dir, store } = makeVault()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  store.writePage({
    id: 'p1', title: 'T1', category: 'concepts', tags: ['t'], source: 's', confidence: 'extracted', created: NOW, updated: NOW,
    body: '改 src/core/engine.ts 要小心。另见 src/only-once.ts。',
  })
  store.writePage({
    id: 'p2', title: 'T2', category: 'concepts', tags: ['t'], source: 's', confidence: 'extracted', created: NOW, updated: NOW,
    body: 'src/core/engine.ts 是核心；同页重复提到 src/core/engine.ts 也只算一页。',
  })
  const paths = highRiskPathsFromVault(store)
  assert.equal(paths.has('src/core/engine.ts'), true, '两页都提到的路径 → 高危')
  assert.equal(paths.has('src/only-once.ts'), false, '只有一页提到 → 不进高危集')
})

test('L2 接线：默认 off 不说话；warn 档同任务同路径只提醒一次；本任务查过库就开门', async (t) => {
  const ws = makeWorkspace(t, 'gate-warn')
  ws.store.writePage({
    id: 'p1', title: 'T1', category: 'concepts', tags: ['t'], source: 's', confidence: 'extracted', created: NOW, updated: NOW,
    body: '改 src/core/engine.ts 要小心。',
  })
  ws.store.writePage({
    id: 'p2', title: 'T2', category: 'concepts', tags: ['t'], source: 's', confidence: 'extracted', created: NOW, updated: NOW,
    body: 'src/core/engine.ts 是核心。',
  })
  const provider = { currentReadonly: () => undefined, readonlyVaultForRoot: (r) => ws.manager.readonlyVaultForRoot(r) }
  const target = join(ws.dir, 'src', 'core', 'engine.ts')

  // 1) 默认 off：连 next 之后也不说话
  const hostOff = fakeHost()
  installTrigger(hostOff, provider, { createNotice: async (text, summary) => notice(text, summary) })
  const off = fakeAgent([userEvent(1, '改一下核心引擎')], { cwd: ws.dir })
  const r0 = await gateExecute(hostOff, off.agent, 'edit', { file_path: target })
  assert.deepEqual(r0.decision, { kind: 'allow' }, 'off 档必须原样放行')
  assert.equal(r0.nextCalls, 1, '必须先调用宿主的 next()（否则会跳过宿主自己的权限/沙箱策略）')
  assert.equal(off.injected.length, 0, 'off 档不说话')

  // 2) warn 档：高危路径 + 本任务未查库 → 提醒一次，且放行
  const saved = process.env.KNJ_OBSIDIAN_GATE
  process.env.KNJ_OBSIDIAN_GATE = 'warn'
  t.after(() => {
    if (saved === undefined) delete process.env.KNJ_OBSIDIAN_GATE
    else process.env.KNJ_OBSIDIAN_GATE = saved
  })
  const host = fakeHost()
  installTrigger(host, provider, { createNotice: async (text, summary) => notice(text, summary) })
  const agent = fakeAgent([userEvent(1, '改一下核心引擎')], { cwd: ws.dir })
  await preStep(host, agent.agent) // 建立任务边界（门依赖「本任务」）
  const r1 = await gateExecute(host, agent.agent, 'edit', { file_path: target })
  assert.deepEqual(r1.decision, { kind: 'allow' }, 'warn 档只提醒，不阻断')
  assert.equal(agent.injected.length, 1, '未查库 + 高危 → 提醒一次')
  assert.match(agent.injected[0].text, /高危|迁移|鉴权|库内多页/)

  const r2 = await gateExecute(host, agent.agent, 'edit', { file_path: target })
  assert.deepEqual(r2.decision, { kind: 'allow' })
  assert.equal(agent.injected.length, 1, '同一路径同任务不反复说')

  // 非高危路径：即使未查库也不说话
  await gateExecute(host, agent.agent, 'edit', { file_path: join(ws.dir, 'src', 'util.ts') })
  assert.equal(agent.injected.length, 1, '普通路径不得触发门')

  // 3) 本任务查过库 → 门自动开
  const agent2 = fakeAgent([userEvent(1, '改一下核心引擎')], { cwd: ws.dir })
  agent2.agent.session.snapshotEvents().push(
    toolCall(2, 'wiki_query', { query: 'engine' }, 1),
  )
  await preStep(host, agent2.agent)
  await host.handlers.get('agent/turn-stopping')({ agent: agent2.agent }) // 折叠「本任务查过库」
  await gateExecute(host, agent2.agent, 'edit', { file_path: target })
  assert.equal(agent2.injected.length, 0, '本任务查过库 → 门不说话')
})

test('L2 接线：block 档拦一次（给理由），同一路径显式重试即放行', async (t) => {
  const ws = makeWorkspace(t, 'gate-block')
  const saved = process.env.KNJ_OBSIDIAN_GATE
  process.env.KNJ_OBSIDIAN_GATE = 'block'
  t.after(() => {
    if (saved === undefined) delete process.env.KNJ_OBSIDIAN_GATE
    else process.env.KNJ_OBSIDIAN_GATE = saved
  })

  const provider = { currentReadonly: () => undefined, readonlyVaultForRoot: (r) => ws.manager.readonlyVaultForRoot(r) }
  const host = fakeHost()
  installTrigger(host, provider, { createNotice: async (text, summary) => notice(text, summary) })
  const agent = fakeAgent([userEvent(1, '加一个数据库迁移')], { cwd: ws.dir })
  await preStep(host, agent.agent)

  const target = join(ws.dir, 'migrations', '0002_add_index.sql')
  const first = await gateExecute(host, agent.agent, 'write', { file_path: target })
  assert.equal(first.decision.kind, 'deny', 'block 档第一次拦下')
  assert.match(first.decision.reason, /知识库|wiki_query/, '拒绝理由必须说明该做什么')
  assert.equal(first.nextCalls, 1, '即使要拦，也先让宿主的策略跑完（不越权替宿主否决）')

  const second = await gateExecute(host, agent.agent, 'write', { file_path: target })
  assert.deepEqual(second.decision, { kind: 'allow' }, '同一路径显式重试即放行——拦截的目的是让它先查库，不是堵死')
})

test('L2 接线：无库会话不说话（库没落地前，门只剩下硬编码集，太粗）', async () => {
  const host = fakeHost()
  installTrigger(host, { currentReadonly: () => undefined }, { createNotice: async (text, summary) => notice(text, summary) })
  const saved = process.env.KNJ_OBSIDIAN_GATE
  process.env.KNJ_OBSIDIAN_GATE = 'block'
  try {
    const agent = fakeAgent([userEvent(1, '改迁移')])
    await preStep(host, agent.agent)
    const r = await gateExecute(host, agent.agent, 'write', { file_path: 'D:\\proj\\migrations\\x.sql' })
    assert.deepEqual(r.decision, { kind: 'allow' }, '没有库 → 门必须沉默（硬编码集单独判太粗）')
    assert.equal(agent.injected.length, 0)
  } finally {
    if (saved === undefined) delete process.env.KNJ_OBSIDIAN_GATE
    else process.env.KNJ_OBSIDIAN_GATE = saved
  }
})

// ---------------------------------------------------------------------------
// 写入闸（2026-10-13）：知识库的写入必须由用户决定
//
// 实测驱动的修订：真实会话日志里，L5「沉淀提醒」注入之后模型**自主**调用了 wiki_capture
// （随后还 wiki_lint 自检）。用户明确要求「没有经过用户决定的内容不应该轻易进知识库」，
// 且已预留会话蒸馏作为用户触发的正规通道。只改文案只是"劝"，所以加这道硬闸。
// 语义：首次未授权写入 → deny + 指路（怎么问用户）；模型按指路问、用户同意后重试 → 放行。
// ---------------------------------------------------------------------------

test('写入闸（opt-in）：显式开启后，未授权的写入被拒一次、重试放行；只读工具不受影响', async (t) => {
  const ws = makeWorkspace(t, 'write-gate')
  // 默认是 off（沉淀交给 UI 蒸馏通道，而那条通道走 wiki_ingest——默认拦截会误伤用户自己的操作）
  const saved = process.env.KNJ_OBSIDIAN_WRITE_GATE
  process.env.KNJ_OBSIDIAN_WRITE_GATE = 'ask'
  t.after(() => {
    if (saved === undefined) delete process.env.KNJ_OBSIDIAN_WRITE_GATE
    else process.env.KNJ_OBSIDIAN_WRITE_GATE = saved
  })
  const provider = { currentReadonly: () => undefined, readonlyVaultForRoot: (r) => ws.manager.readonlyVaultForRoot(r) }
  const host = fakeHost()
  installTrigger(host, provider, { createNotice: async (text, summary) => notice(text, summary) })
  const { agent, injected } = fakeAgent([userEvent(1, '把刚才的结论记一下')], { cwd: ws.dir })
  await preStep(host, agent)

  const first = await gateExecute(host, agent, 'wiki_capture', { title: 'x', body: 'y' })
  assert.equal(first.decision.kind, 'deny', '未经授权的写入必须被拒')
  assert.match(first.decision.reason, /用户/, '拒绝理由必须说明「写入要由用户决定」')
  assert.match(first.decision.reason, /问用户|询问/, '必须给出可执行的指路：怎么问用户')
  assert.equal(first.nextCalls, 1, '仍然先让宿主的策略跑完')
  assert.equal(injected.length, 1, '同时注入一条可见提醒（不阻断流程）')

  const second = await gateExecute(host, agent, 'wiki_capture', { title: 'x', body: 'y' })
  assert.deepEqual(second.decision, { kind: 'allow' }, '按指路问过用户后重试即放行（闸门不是死路）')

  // 只读工具不得被写入闸影响
  const readOnly = await gateExecute(host, agent, 'wiki_query', { query: 'x' })
  assert.deepEqual(readOnly.decision, { kind: 'allow' })
  const lint = await gateExecute(host, agent, 'wiki_lint', {})
  assert.deepEqual(lint.decision, { kind: 'allow' }, 'wiki_lint 是校验不是写入')
})

test('写入闸：默认 off（不误伤 UI 蒸馏）；off 放行 / block 只拦不提醒 / 无库会话不受影响', async (t) => {
  const ws = makeWorkspace(t, 'write-gate-mode')
  const provider = { currentReadonly: () => undefined, readonlyVaultForRoot: (r) => ws.manager.readonlyVaultForRoot(r) }
  const saved = process.env.KNJ_OBSIDIAN_WRITE_GATE
  t.after(() => {
    if (saved === undefined) delete process.env.KNJ_OBSIDIAN_WRITE_GATE
    else process.env.KNJ_OBSIDIAN_WRITE_GATE = saved
  })

  // off：放行（旧行为）
  process.env.KNJ_OBSIDIAN_WRITE_GATE = 'off'
  const hostOff = fakeHost()
  installTrigger(hostOff, provider, { createNotice: async (text, summary) => notice(text, summary) })
  const off = fakeAgent([userEvent(1, '记一下')], { cwd: ws.dir })
  await preStep(hostOff, off.agent)
  const r0 = await gateExecute(hostOff, off.agent, 'wiki_capture', { title: 'x' })
  assert.deepEqual(r0.decision, { kind: 'allow' }, 'off 档放行')
  assert.equal(off.injected.length, 0)

  // block：拦但不注入提醒
  process.env.KNJ_OBSIDIAN_WRITE_GATE = 'block'
  const hostBlock = fakeHost()
  installTrigger(hostBlock, provider, { createNotice: async (text, summary) => notice(text, summary) })
  const blocked = fakeAgent([userEvent(1, '记一下')], { cwd: ws.dir })
  await preStep(hostBlock, blocked.agent)
  const r1 = await gateExecute(hostBlock, blocked.agent, 'wiki_ingest', { source: 's', pages: [] })
  assert.equal(r1.decision.kind, 'deny')
  assert.equal(blocked.injected.length, 0, 'block 档只拦不提醒')
  assert.equal(writeGateModeOf({}), 'off', '默认必须是 off：UI 蒸馏走 wiki_ingest，默认拦截会挡住用户自己的操作')
  assert.equal(writeGateModeOf({ KNJ_OBSIDIAN_WRITE_GATE: 'ask' }), 'ask', 'ask 需显式开启')
  assert.equal(writeGateModeOf({ KNJ_OBSIDIAN_WRITE_GATE: 'BLOCK' }), 'block')

  // 无库会话：没有「写进库」这回事，不拦
  const bare = mkdtempSync(join(tmpdir(), 'dsh-obsidian-nowrite-'))
  t.after(() => rmSync(bare, { recursive: true, force: true }))
  const manager = new VaultManager({ registryFile: join(bare, 'registry.json'), cwdRoot: bare })
  const hostBare = fakeHost()
  installTrigger(
    hostBare,
    { currentReadonly: () => undefined, readonlyVaultForRoot: (r) => manager.readonlyVaultForRoot(r) },
    { createNotice: async (text, summary) => notice(text, summary) },
  )
  const bareAgent = fakeAgent([userEvent(1, '记一下')], { cwd: bare })
  await preStep(hostBare, bareAgent.agent)
  const r2 = await gateExecute(hostBare, bareAgent.agent, 'wiki_capture', { title: 'x' })
  assert.deepEqual(r2.decision, { kind: 'allow' }, '没有库的会话不该被写入闸打扰')
})
