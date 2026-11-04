/**
 * 面板「切换知识库」的作用域契约（P1-1，2026-11-05 评审）。
 *
 * 为什么钉这条：`VaultHeader` 用本地 `overrideRoot` 表示"本面板切到哪个库"，
 * 但 `WikiSidebar` 只把会话工作区根 `root` 传给 VaultTree/SearchBox/GraphView/
 * LintPanel/KnowledgeDistillLauncher —— 于是下拉框只换了头部徽章，内容区仍查原库。
 * 现有 client-session-follow.test.mjs:40 恰好把这种接法断言成"契约"，这里改成钉住
 * 真正该有的行为：overrideRoot 由 WikiSidebar 持有，并作为 effectiveRoot 下发。
 * 这是源文本断言（不渲染 React），与同目录其它 client 测试一致。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
/** 去注释后再断言：注释里出现旧写法不算数。 */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'])\/\/[^\n]*/g, '$1')

const sidebarCode = stripComments(read('src/client/WikiSidebar.tsx'))
const headerCode = stripComments(read('src/client/VaultHeader.tsx'))

/** 取某个 JSX 元素的**开标签区域**：从 `<Name` 到下一个 `<`（属性里可能有 `=>`，不能按 '>' 截）。 */
function openTag(code, name) {
  const start = code.indexOf(`<${name}`)
  assert.ok(start >= 0, `WikiSidebar 应渲染 <${name}>`)
  const next = code.indexOf('<', start + 1)
  return next === -1 ? code.slice(start) : code.slice(start, next)
}

const VIEWS = ['SearchBox', 'GraphView', 'KnowledgeDistillLauncher', 'VaultTree', 'LintPanel']

test('overrideRoot 由 WikiSidebar 持有，并作为 effectiveRoot 下发给每个取数视图', () => {
  assert.match(
    sidebarCode,
    /const \[overrideRoot, setOverrideRoot\] = useState/,
    '面板级 overrideRoot 必须上提到 WikiSidebar：留在 VaultHeader 里就传不到内容区',
  )
  assert.match(
    sidebarCode,
    /const effectiveRoot = overrideRoot \?\? root/,
    '需要 effectiveRoot = overrideRoot ?? root，否则无覆盖时行为会退化',
  )
  for (const view of VIEWS) {
    const tag = openTag(sidebarCode, view)
    assert.ok(
      tag.includes('root={effectiveRoot}'),
      `<${view}> 仍在吃会话 root：切库只会换头部徽章，内容区照旧查原库`,
    )
  }
  // VaultHeader 自己的 root={root} 是基线（它的 effectiveRoot = overrideRoot ?? root），
  // 所以只看它之后的部分：那里不应再有视图吃 root={root}。
  const headerTag = openTag(sidebarCode, 'VaultHeader')
  const afterHeader = sidebarCode.slice(sidebarCode.indexOf(headerTag) + headerTag.length)
  assert.ok(
    !/root=\{root\}/.test(afterHeader),
    'VaultHeader 之后不应再有视图吃 root={root}（除 VaultHeader 自身的跟随基线外全部换成 effectiveRoot）',
  )
})

test('VaultHeader 变成受控组件：不再自持 overrideRoot，改用 props 回调', () => {
  assert.ok(
    !/const \[overrideRoot, setOverrideRoot\] = useState/.test(headerCode),
    'VaultHeader 不应再自己存 overrideRoot（状态在 WikiSidebar）',
  )
  assert.match(headerCode, /onOverrideRoot\s*\??:/, 'VaultHeader 需要 onOverrideRoot 回调把切库意图交给父级')
  assert.ok(
    !/setOverrideRoot\(/.test(headerCode),
    'VaultHeader 内不应再出现 setOverrideRoot 调用（全部改走 onOverrideRoot）',
  )
})

test('切库时派发 wiki:vault-changed，让监听者清掉跨库选择', () => {
  assert.match(
    sidebarCode,
    /dispatchEvent\(new CustomEvent\('wiki:vault-changed'/,
    "切库必须派发 'wiki:vault-changed'：KnowledgeDistillLauncher/SemanticIndexPanel 靠它清跨库选择（当前全仓只有监听方，没人派发）",
  )
})

test('笔记历史栈随库重置（P2-3）：切库后「返回」不得打开另一库的同名页', () => {
  const noteWorkbench = stripComments(read('src/client/NoteWorkbench.tsx'))
  const m = noteWorkbench.match(/setStack\(\[\{ id: seed\.id[\s\S]{0,400}?\}, \[([^\]]*)\]\)/)
  assert.ok(m, '找不到 NoteWorkbench 里重置历史栈的 effect')
  assert.match(m[1], /\broot\b/, '历史栈重置的依赖里没有 root：切库/换工作区后「返回」会打开另一库的同名页')
})
