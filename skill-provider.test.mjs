// skill-provider.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUNDLED_SKILL_RANK,
  SKILL_BUNDLE_DIRS,
  SKILL_PROVIDER_NAME,
  createSkillProvider,
  mountSkillProvider,
  parseFrontmatter,
  readSkillBundles,
} from './lib/skill-provider.js'
import { apply } from './lib/index.js'

// fileURLToPath（而非 URL.pathname + join）：Windows 上 pathname 形如 /D:/…，
// join 后产生 \\D:\…，fs 会解析成不存在的 D:\D:\…
const ROOT = fileURLToPath(new URL('.', import.meta.url))
const FIX = join(ROOT, 'test-fixtures', 'skill-bundles')
const EXPECTED = ['wiki-collect', 'wiki-distill', 'wiki-init', 'wiki-mine', 'wiki-query']

/** 收集 warn 而不打印。 */
function collector() {
  const messages = []
  return { messages, warn: (message) => messages.push(message) }
}

test('包根下 5 个 bundle 全部可读，名字与 rank 正确', () => {
  const { warn } = collector()
  const bundles = readSkillBundles(ROOT, SKILL_BUNDLE_DIRS, warn)
  assert.deepEqual(bundles.map((b) => b.name), EXPECTED)
  for (const bundle of bundles) {
    assert.ok(bundle.description.length > 0, `${bundle.name} 应有 description`)
    assert.equal(bundle.invocation.modelInvocable, true, `${bundle.name} 应可被模型调用`)
    assert.equal(bundle.invocation.userInvocable, true, `${bundle.name} 应可被人类调用`)
    assert.equal(bundle.body.length > 0, true, `${bundle.name} 应有正文`)
  }
  assert.equal(BUNDLED_SKILL_RANK, 600)
})

test('白名单防回归：不会把包根的 README.md / taxonomy.base.md 当 skill', () => {
  const bundles = readSkillBundles(ROOT, SKILL_BUNDLE_DIRS, collector().warn)
  for (const bundle of bundles) {
    assert.ok(bundle.path.endsWith('SKILL.md'), `路径应是 SKILL.md：${bundle.path}`)
    const dirName = bundle.dir.split(/[\\/]/).pop()
    assert.ok(SKILL_BUNDLE_DIRS.includes(dirName), `bundle 目录应在白名单内，实际 ${dirName}`)
    assert.ok(!/readme|taxonomy/i.test(bundle.path), `不应扫到 ${bundle.path}`)
  }
})

test('provider 候选带 provider/source/rank/resourceBase，get 返回正文', async () => {
  const provider = createSkillProvider(ROOT, collector().warn)
  assert.equal(provider.name, SKILL_PROVIDER_NAME)
  const candidates = await provider.list()
  assert.equal(candidates.length, 5)
  for (const candidate of candidates) {
    assert.equal(candidate.provider, SKILL_PROVIDER_NAME)
    assert.equal(candidate.source, 'bundled')
    assert.equal(candidate.rank, BUNDLED_SKILL_RANK)
    assert.equal(candidate.resourceBase.kind, 'directory')
    assert.ok(existsSync(String(candidate.path)), `path 应存在：${candidate.path}`)
  }
  const collect = await provider.get({ name: 'wiki-collect' })
  assert.ok(collect, 'get 应返回定义')
  // content 是去掉 frontmatter 的正文（描述里的「扫描用 wiki_mine」不该混进来）
  assert.match(String(collect.content), /## 第 1 步：扫描 \+ 对账/)
  assert.match(String(collect.content), /category=dictionaries/)
  assert.doesNotMatch(String(collect.content), /^---/m, 'content 不应带 frontmatter')
  assert.equal(await provider.get({ name: 'no-such-skill' }), undefined)
})

test('wiki-distill 的 resourceBase 指向包内该目录，随附提取器在同目录', async () => {
  const provider = createSkillProvider(ROOT, collector().warn)
  const distill = await provider.get({ name: 'wiki-distill' })
  assert.ok(distill, 'get 应返回 wiki-distill')
  const dir = String(distill.resourceBase.path)
  assert.equal(dir, join(ROOT, 'wiki-distill'))
  assert.ok(existsSync(join(dir, 'extract-dsh-sessions.cjs')), '同目录应有会话提取器')
  assert.equal(distill.rank, BUNDLED_SKILL_RANK)
})

test('单个 bundle 缺失/缺 name/布尔非法 => 只跳过该条并 warn，其余照常返回', () => {
  const { messages, warn } = collector()
  const bundles = readSkillBundles(FIX, ['wiki-collect', 'wiki-broken', 'wiki-badflag', 'wiki-missing'], warn)
  assert.deepEqual(bundles.map((b) => b.name), ['wiki-collect'])
  assert.equal(messages.length, 3, `应各 warn 一次，实际：${messages.join(' | ')}`)
  assert.ok(messages.some((m) => m.includes('wiki-broken')), '缺 name 的应被跳过')
  assert.ok(messages.some((m) => m.includes('wiki-badflag')), '布尔非法的应被跳过')
  assert.ok(messages.some((m) => m.includes('wiki-missing')), '缺失目录的应被跳过')
  assert.match(bundles[0].body, /FIXTURE-BODY-OK/)
})

test('parseFrontmatter：无 frontmatter 返回 undefined，折叠块合成单行', () => {
  assert.equal(parseFrontmatter('# 没有 frontmatter'), undefined)
  assert.equal(parseFrontmatter('---\nname: x\n'), undefined)
  const parsed = parseFrontmatter('---\nname: demo\ndescription: >\n  第一行\n  第二行\n---\n正文')
  assert.ok(parsed)
  assert.equal(parsed.data.name, 'demo')
  assert.equal(parsed.data.description, '第一行 第二行')
  assert.equal(parsed.body, '正文')
})

test('mountSkillProvider：注入 skills 并注册可列出 5 个 skill 的 provider', async () => {
  const injected = []
  let registered
  let registrationDisposed = 0
  const skillCtx = {
    skills: {
      // 真实注册表：registerProvider 返回 disposer（@deepseek-ai/dsh-skill 契约）
      registerProvider: (factory) => {
        registered = factory()
        return () => { registrationDisposed += 1 }
      },
    },
  }
  const ctx = {
    inject: (deps, callback) => {
      injected.push(deps)
      if (deps.includes('skills')) callback(skillCtx)
      return () => {}
    },
  }
  const dispose = mountSkillProvider(ctx, { root: ROOT, warn: collector().warn })
  assert.deepEqual(injected, [['skills']])
  assert.ok(registered, '应注册 provider')
  assert.equal(registered.name, SKILL_PROVIDER_NAME)
  assert.deepEqual((await registered.list()).map((c) => c.name), EXPECTED)
  assert.equal(typeof dispose, 'function')
  dispose()
  assert.equal(registrationDisposed, 1, 'dispose 必须调用 registerProvider 返回的注销函数')
})

test('skills 服务缺失或 inject 抛错时静默降级，不抛错也不影响调用方', () => {
  const { messages, warn } = collector()
  const withoutSkills = { inject: (deps, callback) => { callback({}) } }
  assert.doesNotThrow(() => mountSkillProvider(withoutSkills, { root: ROOT, warn }))
  const throwing = { inject: () => { throw new Error('boom') } }
  assert.doesNotThrow(() => mountSkillProvider(throwing, { root: ROOT, warn }))
  const noInject = {}
  assert.doesNotThrow(() => mountSkillProvider(noInject, { root: ROOT, warn }))
  assert.equal(messages.length, 3, `三种情形各 warn 一次，实际：${messages.join(' | ')}`)
})

test('插件 apply() 必须挂载 skill provider（否则包内 skill 对模型不可见）', async () => {
  const injected = []
  let registered
  const ctx = {
    inject: (deps, callback) => {
      injected.push(deps)
      // 只驱动 skills 注入：tools/webServer 那支需要真实宿主服务，这里不执行
      if (deps.includes('skills')) callback({ skills: { registerProvider: (factory) => { registered = factory() } } })
      return () => {}
    },
  }
  apply(ctx)
  const skillDeps = injected.filter((deps) => deps.includes('skills'))
  assert.equal(skillDeps.length, 1, `apply 应注入一次 skills，实际注入：${JSON.stringify(injected)}`)
  assert.equal(skillDeps[0].length, 1, 'skills 必须单独注入，不得并入 tools/webServer（硬依赖缺失会置 INACTIVE）')
  assert.ok(registered, 'apply 应注册 skill provider')
  assert.deepEqual((await registered.list()).map((c) => c.name), EXPECTED)
})
