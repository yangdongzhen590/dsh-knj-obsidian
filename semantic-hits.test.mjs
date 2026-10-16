// semantic-hits.test.mjs — 语义运行时的「按库缓存」语义。
//
// 为什么单独立文件：这张缓存表被三个消费者共用（wiki_query / wiki_drill / 触发层），
// 而它的语义此前没有任何直接用例——直到 2026-10-15 才发现「失败也被永久缓存」：
// 一次瞬时失败（sqlite 句柄占用、模型文件正在复制）会让该库的语义层在整个进程生命周期内全废，
// 只有重启能恢复；同时它让 notReadyMessage 对用户的承诺「放好后无需重启，再次检索即可自动加载」
// 在走缓存的两条路径上直接失效。
//
// 这里不触碰真实 ~/.dsh/qmd 与 300M 模型：工厂是注入的，缓存键用普通字符串（不落盘、不建目录）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  semanticRuntimeFor,
  warmSemanticRuntime,
  disposeSemanticRuntimes,
  SEMANTIC_FAILURE_RETRY_MS,
} from './lib/semantic-hits.js'

function readyRuntime(overrides = {}) {
  return {
    status: 'ready',
    modelPath: 'fake.gguf',
    modelPresent: true,
    index: { documents: 1, pendingEmbedding: 0, hasVectorIndex: true },
    store: {
      getStatus: () => ({ totalDocuments: 1, needsEmbedding: 0, hasVectorIndex: true }),
      update: async () => ({}),
      embed: async () => ({}),
      close: () => {},
    },
    ...overrides,
  }
}

/** 用指定的失败冷却窗跑一段测试，结束后恢复环境与缓存。 */
function withRetryMs(ms, t) {
  const saved = process.env.KNJ_OBSIDIAN_SEMANTIC_RETRY_MS
  process.env.KNJ_OBSIDIAN_SEMANTIC_RETRY_MS = String(ms)
  t.after(() => {
    if (saved === undefined) delete process.env.KNJ_OBSIDIAN_SEMANTIC_RETRY_MS
    else process.env.KNJ_OBSIDIAN_SEMANTIC_RETRY_MS = saved
    disposeSemanticRuntimes()
  })
}

test('可用运行时永久复用：同一库不会重复加载模型', async (t) => {
  withRetryMs(0, t)
  const root = 'fake-vault-usable'
  let calls = 0
  const factory = async () => { calls += 1; return readyRuntime() }

  const a = await semanticRuntimeFor(root, factory)
  const b = await semanticRuntimeFor(root, factory)

  assert.equal(calls, 1, '可用运行时必须只创建一次（模型冷启动几十秒，不能重复付）')
  assert.equal(a, b, '两次取到同一个实例')
  assert.equal(warmSemanticRuntime(root), a, '解析完成后热判据同步可读（触发层靠它当门）')
})

test('失败在冷却窗内复用：不会每回合都重试', async (t) => {
  withRetryMs(SEMANTIC_FAILURE_RETRY_MS, t)
  assert.equal(SEMANTIC_FAILURE_RETRY_MS, 30_000, '默认窗口 30 秒')
  const root = 'fake-vault-cooldown'
  let calls = 0
  const factory = async () => { calls += 1; throw new Error('sqlite 句柄被占用') }

  assert.equal(await semanticRuntimeFor(root, factory), null)
  assert.equal(await semanticRuntimeFor(root, factory), null)
  assert.equal(calls, 1, '窗口内复用同一次失败结论，不重复尝试')
})

test('失败不再永久缓存：窗口过后必须真的重试，并能恢复可用', async (t) => {
  withRetryMs(0, t)
  const root = 'fake-vault-retry'
  let calls = 0
  let broken = true
  const factory = async () => {
    calls += 1
    if (broken) throw new Error('瞬时失败')
    return readyRuntime()
  }

  assert.equal(await semanticRuntimeFor(root, factory), null, '第一次：工厂抛错 ⇒ 降级为 null')
  assert.equal(calls, 1)

  broken = false
  const recovered = await semanticRuntimeFor(root, factory)
  assert.equal(calls, 2, '旧实现会在第一次失败后永久返回缓存里的 null，永远不再调用工厂')
  assert.ok(recovered?.store, '瞬时故障消失后必须能恢复出可用运行时')

  assert.equal(await semanticRuntimeFor(root, factory), recovered)
  assert.equal(calls, 2, '恢复之后恢复永久复用')
})

test('模型缺失（store 为 null）同样不永久缓存：放进模型后无需重启即可恢复', async (t) => {
  withRetryMs(0, t)
  const root = 'fake-vault-model-missing'
  let calls = 0
  let modelDroppedIn = false
  const factory = async () => {
    calls += 1
    // 模型缺失时 createSemanticRuntime 的形态：modelPresent=false 且 store=null，且不开索引库
    return modelDroppedIn
      ? readyRuntime()
      : readyRuntime({ status: 'index-empty', modelPath: 'missing.gguf', modelPresent: false, store: null })
  }

  const before = await semanticRuntimeFor(root, factory)
  assert.equal(before?.modelPresent, false)
  assert.equal(before?.store, null)

  modelDroppedIn = true
  const after = await semanticRuntimeFor(root, factory)
  assert.equal(calls, 2, '「放好后无需重启，再次检索即可自动加载」这条承诺必须真的成立')
  assert.ok(after?.store, '模型到位后必须能拿到 store')
})

test('并发单飞：pending 期间共享同一个 Promise，绝不并发拉起两次模型', async (t) => {
  // 故意把窗口压到 0：此时唯一的复用理由只剩「pending」——最能验出单飞是否真的成立
  withRetryMs(0, t)
  const root = 'fake-vault-singleflight'
  let calls = 0
  let settle
  const factory = () => {
    calls += 1
    return new Promise((resolve) => { settle = resolve })
  }

  const p1 = semanticRuntimeFor(root, factory)
  const p2 = semanticRuntimeFor(root, factory)
  assert.equal(calls, 1, '加载中不得再次调用工厂（否则会并发加载两份 300M 模型）')
  assert.equal(p1, p2, '两次调用必须拿到同一个 Promise')

  settle(readyRuntime())
  assert.ok((await p1)?.store)
  assert.equal(await p2, await p1)
})

test('dispose 关闭 store 并清空缓存（不留下 sqlite 句柄与热判据）', async (t) => {
  withRetryMs(0, t)
  const root = 'fake-vault-dispose'
  let closed = 0
  await semanticRuntimeFor(root, async () => readyRuntime({ store: { ...readyRuntime().store, close: () => { closed += 1 } } }))
  assert.ok(warmSemanticRuntime(root), '前置：运行时已热')

  disposeSemanticRuntimes()
  await new Promise((resolve) => { setTimeout(resolve, 0) }) // 等 close 的微任务

  assert.equal(closed, 1, 'dispose 必须关闭 store')
  assert.equal(warmSemanticRuntime(root), null, '热判据必须清空')
})
