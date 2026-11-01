// manifest-peers.test.mjs — 宿主兼容性声明面
//
// 背景（2026-11-01 实测）：DSH 至今没有正式版，`latest` 是 `0.2.1-rc.5` 这类**预发布版**。
// semver 规定预发布版只能被「同一 x.y.z 上的预发布比较符」命中，所以本包原先那两条
// `@deepseek-ai/dsh-llm|dsh-tools: ">=0.1.2-rc.1 <0.3.0-0"` 永远放行不了 0.2.1-rc.x 宿主，
// npm 安装期必然 ERESOLVE（即使声明为 optional peer 也照样拦）：
//
//   npm error Could not resolve dependency:
//   peerOptional @deepseek-ai/dsh-llm@">=0.1.2-rc.1 <0.3.0-0" from dsh-knj-obsidian@2026.11.11
//
// 而这两个包本来就由宿主运行时提供（apply 只 inject tools/webServer，模块解析走宿主模块表），
// 安装期声明 peer 对运行时毫无作用，只会把「宿主升到新 rc」变成「插件装不上」。
// 因此 2026.11.12 起移除这两条 peer，兼容性改由 engines.dsh + 启动日志承载。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const pkg = JSON.parse(readFileSync(ROOT + 'package.json', 'utf8'))

/** 宿主运行时自带的包：声明 peer 只会在安装期制造 ERESOLVE，对运行时零收益。 */
const HOST_PROVIDED = ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-tools']

function assertNoHostPeer(manifest, label) {
  for (const name of HOST_PROVIDED) {
    assert.ok(
      !(name in (manifest.peerDependencies ?? {})),
      `${label} 不应把宿主自带的 ${name} 声明为 peerDependency：rc 宿主上会必然 ERESOLVE（见文件头注释）`,
    )
  }
}

test('声明面：宿主自带的 dsh-llm / dsh-tools 不得出现在 peerDependencies', () => {
  assertNoHostPeer(pkg, 'package.json')
  // 非宿主包保留声明才有意义：cordis 是插件框架（运行期由宿主提供，缺失即整包不可用），
  // qmd 是可选能力（缺失时 wiki_search_semantic 返回 library-missing 并降级）。
  assert.ok(pkg.peerDependencies['@deepseek-ai/cordis'], 'cordis 仍应是 optional peer')
  assert.ok(pkg.peerDependencies['@tobilu/qmd'], 'qmd 仍应是 optional peer')
})

test('engines.dsh 只写下界：上界会把未来的预发布宿主误判为不兼容', () => {
  const range = pkg.engines?.dsh
  assert.ok(range, 'engines.dsh 应存在（npm 默认不强制，仅作文档与 --engine-strict 依据）')
  assert.match(range, /^>=\d+\.\d+\.\d+(-rc\.\d+|-alpha\.\d+)?$/, `engines.dsh 不应带上界：${range}`)
})

test('可观测性：apply() 启动即打印插件版本（bundle 被静默跳过时这行不会出现）', () => {
  const src = readFileSync(ROOT + 'src/index.ts', 'utf8')
  assert.match(src, /\[dsh-knj-obsidian\] v/, '启动日志是「插件到底加载了没有」的唯一信号，不可删')
  assert.match(
    src,
    /new URL\('\.\.\/package\.json', import\.meta\.url\)/,
    '版本须从 package.json 读取：写死常量会与发布版本两处维护（CLIENT_BUILD 已踩过）',
  )
})

test('产物级：lib/index.js 必须携带启动日志（只改源码不重建 = 线上照旧无信号）', () => {
  const built = ROOT + 'lib/index.js'
  assert.ok(existsSync(built), 'lib/index.js 应存在（node --test 前会先跑 pretest=build）')
  assert.match(readFileSync(built, 'utf8'), /\[dsh-knj-obsidian\] v/, '构建产物须含启动日志')
})

test('护栏自检：把宿主 peer 加回伪造清单必须被判红（防止护栏本身假绿）', () => {
  assert.throws(
    () => assertNoHostPeer({ peerDependencies: { '@deepseek-ai/dsh-llm': '>=0.1.2-rc.1 <0.3.0-0' } }, 'fake'),
    /dsh-llm/,
  )
  assert.throws(
    () => assertNoHostPeer({ peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.2.1-rc.1 <0.2.2-0' } }, 'fake'),
    /dsh-tools/,
  )
})
