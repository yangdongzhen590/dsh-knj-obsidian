// client-api.test.mjs
// Task 3 存在性测试：api.ts 三个 fetch 函数、WikiSidebar 空态引导、三个子组件文件。
// 不重复 client-build.test.mjs 对 registerTab render 字段的窄禁令。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath（而非 URL.pathname + join）：Windows 上 pathname 形如 /D:/…，
// join 后产生 \\D:\…，fs 会解析成不存在的 D:\D:\…（见 client-build.test.mjs 同款约定）
const ROOT = fileURLToPath(new URL('.', import.meta.url))

test('api.ts 存在且导出三个 fetch 函数', () => {
  const api = join(ROOT, 'src/client/api.ts')
  assert.ok(existsSync(api), 'src/client/api.ts 应存在')
  const text = readFileSync(api, 'utf8')
  assert.match(text, /fetchPages/)
  assert.match(text, /fetchSearch/)
  assert.match(text, /fetchLint/)
})

test('空态引导文案存在且被边栏渲染', () => {
  // brief 缺陷修正：空态文案按 brief 实现位于 VaultTree（页面数为 0 时渲染），
  // 故断言 VaultTree 含文案、WikiSidebar 挂载 VaultTree（引导必然出现在边栏）。
  const vt = join(ROOT, 'src/client/VaultTree.tsx')
  assert.ok(existsSync(vt), 'src/client/VaultTree.tsx 应存在')
  assert.match(readFileSync(vt, 'utf8'), /吸收进 wiki/)
  const ws = join(ROOT, 'src/client/WikiSidebar.tsx')
  assert.ok(existsSync(ws))
  assert.match(readFileSync(ws, 'utf8'), /VaultTree/)
})

test('VaultTree/SearchBox/LintPanel 组件存在（v2 起 LintBadge 由 LintPanel 取代）', () => {
  for (const f of ['VaultTree.tsx', 'SearchBox.tsx', 'LintPanel.tsx']) {
    assert.ok(existsSync(join(ROOT, 'src/client', f)), `${f} 应存在`)
  }
})
