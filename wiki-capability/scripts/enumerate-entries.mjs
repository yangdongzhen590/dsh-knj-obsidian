#!/usr/bin/env node
// enumerate-entries.mjs — 确定性入口枚举（段①）
//
// 产出 .wiki/_system/capability-mining/entries.json：工作区的全部「入口」清单。
// 入口 = 用户/agent 能触发一个功能的地方。四类适配器：
//   ① 工具注册   ctx.tools.register({ name }) / defineTool({ name })
//   ② HTTP 路由  webServer.register({ path, kind }) / router.get(...)
//   ③ 宿主钩子   ctx.on('agent/pre-step', ...)
//   ④ 前端路由   { path: '/x', component: ... }（Vue/React）
//   ⑤ 后端接口   @RequestMapping / @GetMapping 等注解
//
// 纪律：纯文本扫描（grep 级），不调用 LLM。info:line 必须真实（由本脚本产出，
// 不是模型写的）。glob 自己实现——不依赖外部 CLI（见设计文档 P1-5）。
//
// 用法:
//   node scripts/enumerate-entries.mjs --project <dir> [--out <path>] [--pretty]

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, relative, resolve, dirname, extname } from 'node:path'

const DEFAULT_EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'bin', 'obj', 'vendor',
  '.git', '.svn', '.hg', '.idea', '.vscode', 'coverage', '.next', '.nuxt',
  '__pycache__', '.pytest_cache', '.mypy_cache', 'logs', 'tmp', 'temp',
  // 本插件的特殊排除：编译产物 / 知识库自身 / 示例 / 本技能自己
  'lib', '.wiki', 'examples', 'docs', 'test-fixtures',
])

// 只扫源码目录（默认 src；可用 --scan 覆盖）
const DEFAULT_SCAN_DIRS = ['src']

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue',
  '.py', '.java', '.kt', '.go', '.rs', '.rb', '.php', '.cs', '.swift',
])

/** 测试/规格文件：不是入口，排除（避免断言里的 name: 'x' 被误当成注册） */
function isTestFile(p) {
  const s = p.replace(/\\/g, '/')
  return /\.(test|spec)\.(mjs|cjs|js|ts|tsx)$/.test(s) || /\/__tests__\//.test(s) || /\/tests?\//.test(s)
}


/** 递归枚举候选文件（fs.readdirSync + withFileTypes，避开 glob 与中文路径问题） */
function walk(dir, out = [], root = dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (DEFAULT_EXCLUDED_DIRS.has(e.name)) continue
      walk(join(dir, e.name), out, root)
    } else if (e.isFile()) {
      if (!CODE_EXTENSIONS.has(extname(e.name).toLowerCase())) continue
      out.push(join(dir, e.name))
    }
  }
  return out
}

/** 行号（1-based）：从文件文本 + 字符偏移算出来 */
function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++
  return line
}

const PATTERNS = [
  // ① 工具注册：name: 'x' 且前文 300 字符内有 register/defineTool（过滤普通对象字面量的误报）
  {
    type: 'tool',
    re: /name:\s*['"]([a-z][a-z0-9_]*)['"]/g,
    contextBefore: /(?:register|defineTool)\s*\(/,
    contextWindow: 300,
  },
  // ② HTTP 路由：模板串 `${BASE}/xxx`（本插件的路由以 BASE + 路径判定）
  { type: 'route', re: /\$\{BASE\}\/([a-z][a-z-]*)/g },
  // ②b HTTP 路由：字面量 '/api/...'
  { type: 'route', re: /['"`](\/api\/[a-z0-9/_-]+)['"`]/g },
  // ③ 宿主钩子：ctx.on('a/b') 或 register('a/b')（trigger 层用包装函数 register）
  { type: 'hook', re: /(?:\.on|register)\(\s*['"]([a-z][a-z-]*\/[a-z-]+)['"]/g },
  // ④ 前端路由：path: '/x', component: ...
  { type: 'frontend-route', re: /path:\s*['"]([^'"]+)['"][^}]{0,200}?(?:component|element):/g },
  // ⑤ 后端接口：@RequestMapping("/x") / @GetMapping("/x")
  { type: 'backend-api', re: /@(?:Request|Get|Post|Put|Delete|Patch)Mapping\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g },
]

function scanFile(absPath, root) {
  if (isTestFile(absPath)) return []
  let text
  try {
    text = readFileSync(absPath, 'utf8')
  } catch {
    return []
  }
  const rel = relative(root, absPath).replace(/\\/g, '/')
  const found = []
  for (const pat of PATTERNS) {
    const { type, re, contextBefore, contextWindow } = pat
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      const name = (m[1] ?? m[2] ?? '').trim()
      if (!name) continue
      // 过滤明显的误报：name 太短/纯数字/含空白
      if (name.length < 2 || /^\d+$/.test(name)) continue
      // 上下文校验（仅 tool 类需要：确保 name 出现在 register/defineTool 附近）
      if (contextBefore) {
        const from = Math.max(0, m.index - (contextWindow ?? 300))
        const before = text.slice(from, m.index)
        if (!contextBefore.test(before)) continue
      }
      found.push({
        type: type === 'route' && rel.startsWith('src/client/') ? 'client-call' : type,
        name,
        file: rel,
        line: lineOf(text, m.index),
      })
    }
  }
  return found
}

// ── main ──
const args = process.argv.slice(2)
const projectArg = args.indexOf('--project')
if (projectArg < 0 || !args[projectArg + 1]) {
  console.error('用法: node enumerate-entries.mjs --project <dir> [--out <path>] [--pretty]')
  process.exit(1)
}
const projectRoot = resolve(args[projectArg + 1])
const scanArg = args.indexOf('--scan')
const scanDirs = scanArg >= 0 ? args[scanArg + 1].split(',') : DEFAULT_SCAN_DIRS
const outArg = args.indexOf('--out')
const outPath = outArg >= 0
  ? resolve(args[outArg + 1])
  : join(projectRoot, '.wiki', '_system', 'capability-mining', 'entries.json')
const pretty = args.includes('--pretty')

const files = []
for (const d of scanDirs) {
  const dir = resolve(projectRoot, d)
  if (existsSync(dir)) files.push(...walk(dir, [], projectRoot))
}
const entries = []
for (const f of files) entries.push(...scanFile(f, projectRoot))

// 去重（同一 file:line:name 只留一条）
const seen = new Set()
const unique = entries.filter((e) => {
  const k = `${e.type}|${e.name}|${e.file}|${e.line}`
  if (seen.has(k)) return false
  seen.add(k)
  return true
})

const payload = {
  scanned_at: new Date().toISOString(),
  project_root: projectRoot.replace(/\\/g, '/'),
  files_scanned: files.length,
  count: unique.length,
  by_type: unique.reduce((acc, e) => ((acc[e.type] = (acc[e.type] ?? 0) + 1), acc), {}),
  entries: unique.sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line)),
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(payload, null, pretty ? 2 : 0), 'utf8')
console.log(`[OK] ${unique.length} 个入口 → ${outPath}`)
console.log(`     ${JSON.stringify(payload.by_type)}（扫描 ${files.length} 个文件）`)
