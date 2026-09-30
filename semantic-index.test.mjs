// semantic-index.test.mjs — 语义检索深模块（先红后绿）
// 覆盖：状态目录解析 / 模型发现 / 集合 pattern（含内部目录排除）/ 结果整形与上限钳制 /
//      模型缺失与库缺失的“未就绪”答案（含精确路径、不下载）/ 状态分类（空/陈旧/就绪）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_MODEL_FILENAME,
  resolveStateHome,
  resolveModelPath,
  findModel,
  buildCollectionConfig,
  clampLimit,
  shapeSearchResults,
  classifyStatus,
  notReadyMessage,
  offlineModelPins,
  offlineModelEnv,
  fuseRanked,
  runOfflineSearch,
  createSemanticRuntime,
  MODEL_DOWNLOAD_URL,
} from './lib/semantic-index.js'
import { createRequire } from 'node:module'

// @tobilu/qmd 自 v2026.9.152 起是「可选 peer」（autoInstallPeers:false 下不再随插件安装），
// 只有真正装了语义检索依赖的环境才能走「真实库分支」。裸 clone 上按可用性跳过这条用例，
// 避免把「依赖未装」误报成代码回归；装了 qmd 的环境仍会完整执行。
const qmdInstalled = (() => {
  try {
    createRequire(import.meta.url).resolve('@tobilu/qmd')
    return true
  } catch {
    return false
  }
})()
const qmdSkip = qmdInstalled ? false : '@tobilu/qmd 未安装（可选 peer）：跳过真实库分支用例'

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-semantic-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('状态目录固定在 <home>/.dsh/qmd（models/index/config）', (t) => {
  const home = tmp(t)
  const paths = resolveStateHome(home)
  assert.equal(paths.root, join(home, '.dsh', 'qmd'))
  assert.equal(paths.modelsDir, join(home, '.dsh', 'qmd', 'models'))
  assert.equal(paths.dbPath, join(home, '.dsh', 'qmd', 'index.sqlite'))
  assert.equal(paths.configPath, join(home, '.dsh', 'qmd', 'config.yml'))
  assert.equal(resolveModelPath(home), join(home, '.dsh', 'qmd', 'models', DEFAULT_MODEL_FILENAME))
})

test('模型发现：存在返回路径，缺失返回 undefined（不下载）', (t) => {
  const home = tmp(t)
  const paths = resolveStateHome(home)
  assert.equal(findModel(home), undefined, '模型不存在时应返回 undefined')

  mkdirSync(paths.modelsDir, { recursive: true })
  writeFileSync(join(paths.modelsDir, DEFAULT_MODEL_FILENAME), 'fake-gguf', 'utf8')
  assert.equal(findModel(home), resolveModelPath(home), '存在时应返回绝对路径')
})

test('集合配置：只匹配七个正式分类，排除内部/派生位置', (t) => {
  const vault = tmp(t)
  const config = buildCollectionConfig(vault)
  const entries = config.collections
  const ids = Object.keys(entries)
  assert.equal(ids.length, 1, '每个库一个集合')
  const entry = entries[ids[0]]
  assert.equal(entry.path, join(vault, '.wiki'))
  for (const c of ['concepts', 'entities', 'references', 'synthesis', 'projects', 'dictionaries', 'tables']) {
    assert.ok(entry.pattern.includes(c), `pattern 应含 ${c}`)
  }
  for (const banned of ['_system', '_raw', 'wiki-export', '.manifest.json']) {
    assert.ok(!entry.pattern.includes(banned), `pattern 不得含 ${banned}`)
  }
})

test('结果上限钳制：默认 8，硬上限 20，非法值回落', () => {
  assert.equal(clampLimit(undefined), 8)
  assert.equal(clampLimit(5), 5)
  assert.equal(clampLimit(999), 20)
  assert.equal(clampLimit(0), 8)
  assert.equal(clampLimit(-3), 8)
  assert.equal(clampLimit(Number.NaN), 8)
})

test('结果整形：只保留有界字段，score 归一化到 0..1 且缺失时为 undefined', () => {
  const shaped = shapeSearchResults([
    { docid: 'concepts/rate-limiting.md', path: 'concepts/rate-limiting.md', title: '限流', snippet: '429 退避', score: 0.87, collection: 'x' },
    { file: 'tables/t-order.md', title: '订单表', snippet: '列清单' },
  ], 8)

  assert.equal(shaped.length, 2)
  assert.deepEqual(Object.keys(shaped[0]).sort(), ['category', 'id', 'score', 'snippet', 'title'])
  assert.equal(shaped[0].id, 'rate-limiting')
  assert.equal(shaped[0].category, 'concepts')
  assert.equal(shaped[0].score, 0.87)
  assert.equal(shaped[1].category, 'tables')
  assert.equal(shaped[1].score, undefined, '无 score 时不得编造')
})

test('结果整形（QMD 实测字段）：displayPath/qmd:// URI 推导 id、docid 哈希绝不当作 id', () => {
  const shaped = shapeSearchResults([
    {
      filepath: 'qmd://probe-wiki/concepts/rate-limiting.md',
      displayPath: 'probe-wiki/concepts/rate-limiting.md',
      docid: 'd409e2',
      title: 'rate-limiting',
      body: '---\ntitle: Rate limiting\ntags: [backoff]\n---\n\nToken bucket on 429 with retry budget.\n',
      score: 0.0000033,
    },
  ], 8)
  assert.equal(shaped.length, 1)
  assert.equal(shaped[0].id, 'rate-limiting', 'id 来自路径，不是内容哈希 d409e2')
  assert.equal(shaped[0].category, 'concepts')
  assert.equal(shaped[0].title, 'Rate limiting', '标题取 frontmatter title 而非文件名主干')
  assert.match(shaped[0].snippet, /Token bucket/)
  assert.ok(!shaped[0].snippet.includes('---'), '片段不得带 frontmatter')

  // 只有 filepath URI（没有 displayPath）时也要能推导
  const uriOnly = shapeSearchResults([{ filepath: 'qmd://c/entities/order-agg.md', body: 'x' }], 8)
  assert.equal(uriOnly[0].id, 'order-agg')
  assert.equal(uriOnly[0].category, 'entities')

  // 内部/派生位置与非 .md：一律丢弃（即便被索引命中也不能成为检索结果）
  const dropped = shapeSearchResults([
    { displayPath: 'v/_system/sessions/2026.md' },
    { displayPath: 'v/wiki-export/graph.json' },
    { displayPath: 'v/_raw/notes.md' },
    { displayPath: 'v/concepts/README.txt' },
    { docid: 'd409e2' },
  ], 8)
  assert.deepEqual(dropped, [], '非正式分类/非 md/无路径的记录不得出现在结果里')
})

test('状态分类：空索引 / 陈旧（有文档未嵌入）/ 就绪', () => {
  assert.equal(classifyStatus({ documents: 0, embeddings: 0 }), 'index-empty')
  assert.equal(classifyStatus({ documents: 10, embeddings: 4 }), 'index-stale')
  assert.equal(classifyStatus({ documents: 10, embeddings: 10 }), 'ready')
})

test('未就绪答案：给出精确模型路径与可选下载命令，且不联网', () => {
  const msg = notReadyMessage('model-missing', '/home/u/.dsh/qmd/models', DEFAULT_MODEL_FILENAME)
  assert.match(msg, /\/home\/u\/\.dsh\/qmd\/models/)
  assert.match(msg, new RegExp(DEFAULT_MODEL_FILENAME))
  assert.match(msg, /下载/, '应给出可选的手动下载说明')
  assert.ok(msg.includes(MODEL_DOWNLOAD_URL), '应包含模型直链')
  assert.match(msg, /不会自动下载|不自动下载/, '应明确不会自动联网下载')

  const libMsg = notReadyMessage('library-missing')
  assert.match(libMsg, /@tobilu\/qmd/)
  assert.match(libMsg, /wiki_query/, '库缺失时应指向既有关键词检索兜底')
})

test('离线禁用位：云端扩展/精排模型一律指向本地不存在路径，绝不出现 hf: URI', (t) => {
  const home = tmp(t)
  const { modelsDir } = resolveStateHome(home)
  const pins = offlineModelPins(modelsDir)
  assert.equal(Object.keys(pins).sort().join(','), 'generate,rerank')
  for (const [role, value] of Object.entries(pins)) {
    assert.ok(value.startsWith(modelsDir), `${role} 必须落在本地模型目录内`)
    assert.ok(!/^hf:/.test(value), `${role} 不得是会自动下载的云端 URI`)
    assert.ok(!existsSync(value), `${role} 指向的文件不应存在（误用即本地失败）`)
  }
})

test('运行时配置：模型缺失时不打开索引库（零副作用）；就位时用绝对本地路径 + 离线禁用位', async (t) => {
  const home = tmp(t)
  const vault = tmp(t)
  const paths = resolveStateHome(home)
  let seen
  let factoryCalls = 0
  const fakeStore = { async getStatus() { return { documents: 1, embeddings: 1 } } }
  const factory = async (o) => { factoryCalls += 1; seen = o; return fakeStore }

  const notReady = await createSemanticRuntime({ vaultRoot: vault, home, storeFactory: factory })
  assert.equal(factoryCalls, 0, '模型缺失时不得创建 store（不建 sqlite、不留句柄）')
  assert.equal(notReady.store, null)
  assert.equal(notReady.modelPresent, false)
  assert.ok(existsSync(paths.modelsDir), '仍应创建本地模型目录，方便用户放模型')

  mkdirSync(paths.modelsDir, { recursive: true })
  writeFileSync(resolveModelPath(home), 'fake-gguf', 'utf8')
  const ready = await createSemanticRuntime({ vaultRoot: vault, home, storeFactory: factory })
  assert.equal(factoryCalls, 1, '模型就位后应创建 store')
  assert.equal(seen.config.models.embed, resolveModelPath(home), 'embed 应指向本地绝对路径')
  assert.equal(seen.config.models.generate, offlineModelPins(paths.modelsDir).generate)
  assert.equal(seen.config.models.rerank, offlineModelPins(paths.modelsDir).rerank)
  assert.equal(ready.status, 'ready')
})

test('双通道融合：两通道都命中的页面靠前、同页去重、上限生效', () => {
  const vector = [{ path: 'concepts/a.md', title: 'A' }, { path: 'concepts/b.md', title: 'B' }]
  const lexical = [{ path: 'concepts/b.md', title: 'B' }, { path: 'tables/c.md', title: 'C' }]

  const fused = fuseRanked([vector, lexical], 10)
  assert.equal(fused.length, 3, '同一页面只出现一次')
  assert.equal(fused[0].title, 'B', '两通道都命中的页面应排第一')
  assert.deepEqual([...fused.map((r) => r.title)].sort(), ['A', 'B', 'C'])
  assert.ok(fused.every((r) => typeof r.score === 'number' && r.score > 0), '融合分数应为正数')
  assert.equal(fuseRanked([vector, lexical], 1).length, 1, '上限生效')
})

test('离线检索：向量+关键词双通道融合；向量失败降级并如实说明；无通道返回空且不抛', async () => {
  const calls = []
  const both = {
    async searchVector(q, o) { calls.push(['vector', q, o.limit]); return [{ path: 'concepts/a.md', title: 'A' }] },
    async searchLex(q, o) { calls.push(['lex', q, o.limit]); return [{ path: 'tables/b.md', title: 'B' }] },
  }
  const ok = await runOfflineSearch(both, '问题', 5)
  assert.deepEqual(calls.map((c) => c[0]), ['vector', 'lex'], '两个通道都要跑')
  assert.deepEqual(ok.channels, { vector: 1, lexical: 1 })
  assert.equal(ok.results.length, 2)
  assert.equal(ok.degraded, undefined, '无降级时不得编造说明')

  const vectorBroken = {
    async searchVector() { throw new Error('模型未加载') },
    async searchLex() { return [{ path: 'concepts/a.md' }] },
  }
  const degraded = await runOfflineSearch(vectorBroken, '问题', 5)
  assert.match(degraded.degraded ?? '', /向量通道不可用/)
  assert.match(degraded.degraded ?? '', /模型未加载/)
  assert.equal(degraded.results.length, 1, '降级后仍应给出关键词结果')

  const none = await runOfflineSearch({}, '问题', 5)
  assert.equal(none.results.length, 0)
  assert.equal(none.degraded, undefined)
})

test('禁用混合检索：runOfflineSearch 绝不调用 store.search()（云端扩展/精排入口）', async () => {
  let hybridCalled = false
  const store = {
    async search() { hybridCalled = true; return [] },
    async searchVector() { return [] },
    async searchLex() { return [] },
  }
  await runOfflineSearch(store, 'q', 3)
  assert.equal(hybridCalled, false, 'search() 会拉起 1.7B 查询扩展与 0.6B 精排模型，必须禁用')
})

// 真实库集成（不联网、不需要真模型）：证明 BM25 通道在没有任何 gguf 的情况下可用，
// 且向量通道在本地失败（而不是去 HuggingFace 下载）。
test('离线集成：真实 QMD 库 + 伪模型文件 → BM25 通道可用、无需任何真模型、不联网', async (t) => {
  let createStore
  try {
    ({ createStore } = await import('@tobilu/qmd'))
  } catch {
    t.skip('本机未安装 @tobilu/qmd，跳过真实库集成')
    return
  }
  assert.equal(typeof createStore, 'function')

  // 先注册「关库」钩子、再建临时目录：node:test 按注册顺序跑 after，
  // Windows 上未关闭的 sqlite 句柄会挡住目录删除（EPERM）。
  let closeStore = null
  t.after(async () => { try { await closeStore?.() } catch { /* 句柄已释放或本就不支持 */ } })

  const home = tmp(t)
  const vault = tmp(t)
  const paths = resolveStateHome(home)
  mkdirSync(join(vault, '.wiki', 'concepts'), { recursive: true })
  writeFileSync(
    join(vault, '.wiki', 'concepts', 'rate-limiting.md'),
    '---\ntitle: Rate limiting\ntags: [backoff]\n---\n\nToken bucket and leaky bucket. On 429 return a retry budget with exponential backoff.\n',
    'utf8',
  )
  // 伪模型文件：只为让运行时打开索引库；BM25 通道不需要任何真实模型
  mkdirSync(paths.modelsDir, { recursive: true })
  writeFileSync(resolveModelPath(home), 'not-a-real-gguf', 'utf8')

  const savedXdg = process.env.XDG_CACHE_HOME
  t.after(() => {
    if (savedXdg === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = savedXdg
  })

  const runtime = await createSemanticRuntime({ vaultRoot: vault, home })
  assert.ok(runtime.store, '伪模型存在时应能打开索引库（说明未就绪路径之外的库加载可用）')
  const store = runtime.store
  closeStore = () => store.close?.()

  await store.update()
  const outcome = await runOfflineSearch(store, 'backoff retry budget', 5)
  assert.ok(outcome.channels.lexical >= 1, `BM25 通道应命中，实际分区计数 ${JSON.stringify(outcome.channels)}`)
  assert.equal(outcome.channels.vector, 0, '尚未嵌入时向量通道返回空（不是错误，也不下载模型）')
  assert.equal(outcome.results.length, 1)
  assert.equal(outcome.results[0].id, 'rate-limiting', 'id 必须来自路径，而不是 QMD 的内容哈希 docid')
  assert.equal(outcome.results[0].category, 'concepts')
  assert.equal(outcome.results[0].title, 'Rate limiting', '标题应取 frontmatter title')
  assert.match(outcome.results[0].snippet, /Token bucket/, '片段应来自正文 body（QMD 无 snippet 字段）')
})

test('offlineModelEnv：三个 QMD_* 环境变量都是本地路径，绝不出现云端 URI', (t) => {
  const home = tmp(t)
  const modelsDir = resolveStateHome(home).modelsDir
  const env = offlineModelEnv(modelsDir, resolveModelPath(home))
  assert.deepEqual(Object.keys(env).sort(), ['QMD_EMBED_MODEL', 'QMD_GENERATE_MODEL', 'QMD_RERANK_MODEL'])
  assert.equal(env.QMD_EMBED_MODEL, resolveModelPath(home), '嵌入模型必须是绝对本地路径')
  assert.equal(env.QMD_GENERATE_MODEL, offlineModelPins(modelsDir).generate)
  assert.equal(env.QMD_RERANK_MODEL, offlineModelPins(modelsDir).rerank)
  for (const [key, value] of Object.entries(env)) {
    assert.ok(!value.startsWith('hf:'), `${key} 不得是会自动下载的云端 URI`)
  }
})

// 回归：QMD 的分块路径（chunkDocumentByTokens → getDefaultLlamaCpp → tokenize）走**模块级单例**，
// 不读 createStore 的 config 而只认 env。不设 env 时它会去解析默认的 hf: 云端模型并在缺失时联网，
// 实测表现为 embed 阶段无限等待（进程内存不涨、CPU 不动）。这条测试锁死这个修复。
test('单例环境：运行时把本地模型与禁用位写进进程环境（分块走单例，不读 store config）', { skip: qmdSkip }, async (t) => {
  let closeStore = null
  t.after(async () => { try { await closeStore?.() } catch { /* 句柄已释放 */ } })

  const home = tmp(t)
  const vault = tmp(t)
  const paths = resolveStateHome(home)
  mkdirSync(paths.modelsDir, { recursive: true })
  writeFileSync(resolveModelPath(home), 'fake-gguf', 'utf8')

  const keys = ['QMD_EMBED_MODEL', 'QMD_GENERATE_MODEL', 'QMD_RERANK_MODEL', 'XDG_CACHE_HOME']
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const runtime = await createSemanticRuntime({ vaultRoot: vault, home })
  assert.ok(runtime.store, '真实库分支应能打开索引库')
  closeStore = () => runtime.store.close?.()

  assert.equal(process.env.QMD_EMBED_MODEL, resolveModelPath(home), '单例必须拿到本地模型路径')
  assert.equal(process.env.QMD_GENERATE_MODEL, offlineModelPins(paths.modelsDir).generate)
  assert.equal(process.env.QMD_RERANK_MODEL, offlineModelPins(paths.modelsDir).rerank)
  for (const key of ['QMD_EMBED_MODEL', 'QMD_GENERATE_MODEL', 'QMD_RERANK_MODEL']) {
    assert.ok(!String(process.env[key]).startsWith('hf:'), `${key} 不得把单例引向云端`)
  }
})
