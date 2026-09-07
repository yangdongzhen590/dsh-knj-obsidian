// design-system.test.mjs
// 设计系统 v2 契约（红绿测试）：
// 1. styles.ts 存在，基于宿主令牌（--dsw-alias-* / --dsw-static-*）定义 WIKI_CSS，并导出 injectWikiStyles
// 2. index.ts 挂载时注入样式
// 3. 各组件使用 className 类样式（不再全部内联 style）
// 4. 组件不再硬编码旧暗色色板（#0b1020 / #1f2937 / #374151 / …）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const CLIENT = join(ROOT, 'src/client')

const FILES = [
  'VaultHeader.tsx', 'VaultTree.tsx', 'SearchBox.tsx', 'LintPanel.tsx',
  'GraphView.tsx', 'WikiSidebar.tsx', 'NoteView.tsx', 'NoteWorkbench.tsx',
]
// 旧界面的硬编码色板（含暗色小按钮/边框/背景的典型值）
const OLD_HEX = /#(?:0b1020|1f2937|374151|111827|052e16|450a0a|451a03)\b/i

test('设计系统：styles.ts 存在且基于宿主令牌', () => {
  const s = join(CLIENT, 'styles.ts')
  assert.ok(existsSync(s), 'src/client/styles.ts 应存在（设计系统 v2）')
  const text = readFileSync(s, 'utf8')
  assert.match(text, /WIKI_CSS/, '应导出 WIKI_CSS')
  assert.match(text, /injectWikiStyles/, '应导出 injectWikiStyles')
  assert.match(text, /--dsw-alias-/, '应引用宿主别名令牌 --dsw-alias-*')
  assert.match(text, /--dsw-static-/, '应引用宿主静态色板 --dsw-static-*')
})

test('index.ts 挂载时注入样式', () => {
  const text = readFileSync(join(CLIENT, 'index.ts'), 'utf8')
  assert.match(text, /injectWikiStyles\(\)/, 'apply 时应调用 injectWikiStyles()')
})

test('组件使用 className 类样式（不再全部内联 style）', () => {
  for (const f of FILES) {
    const text = readFileSync(join(CLIENT, f), 'utf8')
    assert.match(text, /className/, `${f} 应使用 className 样式类`)
  }
})

test('组件不再硬编码旧暗色色板', () => {
  for (const f of FILES) {
    const text = readFileSync(join(CLIENT, f), 'utf8')
    assert.doesNotMatch(text, OLD_HEX, `${f} 不应出现旧色板硬编码（应走宿主令牌）`)
  }
})

// ---- v8 滚动回归契约（falsifiable：回退任一断言即红） ----

test('NoteWorkbench 工作台根容器自带纵向滚动（笔记 tab 在右侧面板 paneContent overflow:hidden 内，无宿主滚动容器）', () => {
  const wb = readFileSync(join(CLIENT, 'NoteWorkbench.tsx'), 'utf8')
  assert.match(wb, /className="knj-wiki knj-wb-scroll"/, '正常态根容器应为 .knj-wiki.knj-wb-scroll')
  const styles = readFileSync(join(CLIENT, 'styles.ts'), 'utf8')
  const rule = styles.match(/\.knj-wiki\.knj-wb-scroll\s*\{[^}]*\}/)
  assert.ok(rule, 'styles.ts 应存在 .knj-wiki.knj-wb-scroll 规则')
  assert.match(rule[0], /height:\s*100%/, '滚动根容器应 height:100%（填满宿主 paneTab）')
  assert.match(rule[0], /overflow-y:\s*auto/, '滚动根容器应 overflow-y:auto（内容超高时出现纵向滚动条）')
})

test('NoteWorkbench 空态：knj-wiki 必须是 knj-empty 的祖先（styles.ts 用后代选择器 .knj-wiki .knj-empty）', () => {
  const text = readFileSync(join(CLIENT, 'NoteWorkbench.tsx'), 'utf8')
  assert.match(text, /<div className="knj-wiki"[\s\S]*?<div className="knj-empty"/, '空态应为外层 knj-wiki 包内层 knj-empty')
})

test('styles.ts 不自定义滚动条（宿主已有 --dsw-alias-scrollbar-* 主题，插件不得重复声明）', () => {
  const text = readFileSync(join(CLIENT, 'styles.ts'), 'utf8')
  assert.doesNotMatch(text, /::-webkit-scrollbar/, 'styles.ts 不得含 ::-webkit-scrollbar 规则')
})

// ---- 根节点双类布局契约（后代选择器不匹配自身，须有复合选择器） ----

// ---- v10 跨插件撞名契约（用户实测：dsh-knj-workflow 全局 .knj-col{max-width:300px} 钳住知识库根节点） ----
// 同作者 knj-* 插件家族存在共享前缀；dsh-knj-workflow 注入未加作用域的全局规则
// .knj-col{flex:1;min-width:210px;max-width:300px;...}、.knj-row{margin-bottom:12px}、
// .knj-btn{height:32px}、.knj-input{height:36px}。我方规则虽以 .knj-wiki 前缀取胜于
// 已声明属性，但未声明属性（max-width/min-width/height/margin-bottom）会被渗入。
// 契约：① 结构布局类更名退出撞名区（knj-vcol/knj-hrow）；② 根节点 max-width 防御；
// ③ 保留类名的漏属性显式声明。

test('布局类更名退出撞名区：组件与样式不再使用 knj-col / knj-row', () => {
  // 只钉真实用法：JSX className 属性、CSS 规则选择器（.knj-col{...} / .knj-wiki .knj-col{...}）。
  // 注释中解释性提及旧类名属文档价值，不拦截。
  for (const f of [...FILES, 'styles.ts']) {
    const text = readFileSync(join(CLIENT, f), 'utf8')
    assert.doesNotMatch(text, /className=["'][^"']*\bknj-col\b/, `${f} className 不得含 knj-col（与 dsh-knj-workflow 全局类撞名）`)
    assert.doesNotMatch(text, /className=["'][^"']*\bknj-row\b/, `${f} className 不得含 knj-row（同上）`)
  }
  const styles = readFileSync(join(CLIENT, 'styles.ts'), 'utf8')
  assert.doesNotMatch(styles, /\.knj-col\s*[,\{]/s, 'styles.ts 不得存在 .knj-col 规则选择器（含组合选择器形式）')
  assert.doesNotMatch(styles, /\.knj-row\s*[,\{]/s, 'styles.ts 不得存在 .knj-row 规则选择器（含组合选择器形式）')
})

test('styles.ts 提供根节点复合选择器 .knj-wiki.knj-vcol（WikiSidebar 根同节点双类）', () => {
  const text = readFileSync(join(CLIENT, 'styles.ts'), 'utf8')
  assert.match(text, /\.knj-wiki\.knj-vcol/, '应存在 .knj-wiki.knj-vcol 复合选择器（原 .knj-wiki.knj-col 更名）')
})

test('styles.ts 根节点 .knj-wiki 声明 max-width:none（外部全局样式钳制防御）', () => {
  const text = readFileSync(join(CLIENT, 'styles.ts'), 'utf8')
  const rootRule = text.match(/\.knj-wiki\s*\{[^}]*\}/)
  assert.ok(rootRule, '应存在 .knj-wiki 根规则')
  assert.match(rootRule[0], /max-width:\s*none/, '.knj-wiki 根规则必须声明 max-width:none')
})

test('styles.ts 按钮/输入框显式声明 height（防 dsh-knj-workflow .knj-btn{height:32px}/.knj-input{height:36px} 渗入）', () => {
  const text = readFileSync(join(CLIENT, 'styles.ts'), 'utf8')
  const btn = text.match(/\.knj-wiki \.knj-btn\s*\{[^}]*\}/)
  assert.ok(btn, '应存在 .knj-wiki .knj-btn 规则')
  assert.match(btn[0], /height:\s*auto/, '.knj-btn 必须显式 height:auto')
  const input = text.match(/\.knj-wiki \.knj-input[^{]*\{[^}]*\}/)
  assert.ok(input, '应存在 .knj-wiki .knj-input 规则（否则输入框被外部全局 .knj-input 全权接管）')
  assert.match(input[0], /height:\s*auto/, '.knj-input 必须显式 height:auto')
})

test('styles.ts 搜索框规则中和外部渗入（dsh-knj-workflow 全局 .knj-search{height:30px;max-width:260px;border-radius:999px}）', () => {
  const text = readFileSync(join(CLIENT, 'styles.ts'), 'utf8')
  const rule = text.match(/\.knj-wiki \.knj-search\s*\{[^}]*\}/)
  assert.ok(rule, '应存在 .knj-wiki .knj-search 规则')
  assert.match(rule[0], /height:\s*auto/, '.knj-search 必须声明 height:auto（防外部 30px 钳制）')
  assert.match(rule[0], /max-width:\s*none/, '.knj-search 必须声明 max-width:none（防外部 260px 钳窄）')
  assert.match(rule[0], /border-radius:\s*0/, '.knj-search 必须还原 border-radius:0（防外部药丸形）')
})

test('构建产物同步撞名防御（client.js 含 knj-vcol 与 max-width:none，不含裸 .knj-col 规则）', () => {
  const bundle = readFileSync(join(ROOT, 'client/client.js'), 'utf8')
  assert.match(bundle, /knj-vcol/, '构建产物应含更名后的 knj-vcol')
  assert.match(bundle, /max-width:\s*none/, '构建产物 .knj-wiki 应含 max-width:none')
  assert.doesNotMatch(bundle, /\.knj-wiki\s*\.knj-col\b/, '构建产物不得残留 .knj-wiki .knj-col 选择器')
})

test('styles.ts 空态撑满滚动内容区（.knj-scroll > .knj-empty 垂直居中）', () => {
  const text = readFileSync(join(CLIENT, 'styles.ts'), 'utf8')
  assert.match(text, /\.knj-scroll\s*>\s*\.knj-empty\s*\{\s*height:\s*100%/, '滚动区内空态应 height:100%')
})

// ---- v9 宽度回归契约（用户实测：knj-wiki knj-col 根 div 宽度塌缩） ----
// 宿主链 .panelBody/.workbench/.splitChild 都是 display:flex（默认 row）的容器；
// 插件根 .knj-wiki 若只声明 height:100% 而无宽度，作为行向 flex 子项宽度
// 会退化为内容宽度（flex-basis:auto + flex-grow:0），界面表现为整个知识库
// 面板"宽度很小"。根节点必须自带 width:100%，不依赖父级 stretch。
// width:100% 在 block 父级、flex-column 父级（等效 stretch）、flex-row 父级
// （占满主轴）三种场景下都正确撑满。

test('styles.ts 根节点 .knj-wiki 声明 width:100%（行向 flex 父容器下宽度不塌缩）', () => {
  const text = readFileSync(join(CLIENT, 'styles.ts'), 'utf8')
  const rootRule = text.match(/\.knj-wiki\s*\{[^}]*\}/)
  assert.ok(rootRule, '应存在 .knj-wiki 根规则')
  assert.match(rootRule[0], /width:\s*100%/, '.knj-wiki 根规则必须声明 width:100%')
})

test('构建产物携带宽度自防御（client.js 注入的 WIKI_CSS 含 width:100%）', () => {
  const bundle = readFileSync(join(ROOT, 'client/client.js'), 'utf8')
  const rootRule = bundle.match(/\.knj-wiki\s*\{[^}]*\}/)
  assert.ok(rootRule, '构建产物应含 .knj-wiki 根规则')
  assert.match(rootRule[0], /width:\s*100%/, '构建产物的 .knj-wiki 必须含 width:100%')
})
