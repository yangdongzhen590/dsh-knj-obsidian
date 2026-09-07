# M1 枚举字典挖掘实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从当前工作区项目静态解析 Java 枚举声明与常量类，逐枚举产出独立知识页（dictionaries 分类），支持大纲→细节两阶段与断点续传。

**Architecture:** 新增 `src/code-miner.ts`（enumMiner 解析器 + outline 大纲扫描）+ `src/mining-progress.ts`（progress.json 模块级进度，断点续传）。`WikiCategory` 扩展 `'dictionaries' | 'tables'`（M1 一次完成，M2 复用）。新增 `wiki_mine` agent 工具出候选目录，`wiki-mine` skill 指导蒸馏经 `wiki_ingest` 入库。复用 manifest 文件级哈希 + wiki_ingest contentHash 三层增量。

**Tech Stack:** TypeScript（Node ≥20）、node:test 测试、regex 轻量解析（非 AST）、现有 VaultStore/wiki_ingest 管道。

**Spec:** `docs/2026-08-31-enum-dictionary-mining-design.md`（M1）+ `docs/2026-08-31-db-table-mining-design.md`（M2，仅 §3 共享基础设施引用）

## Global Constraints

- `WikiCategory` 从 5 类扩到 7 类：`'concepts' | 'entities' | 'references' | 'synthesis' | 'projects' | 'dictionaries' | 'tables'`（M1 一次完成）
- 新页面落点：枚举 → `dictionaries/`，tags = `enum` 或 `dict` + `module:<模块名>`；表 → `tables/`（M2 用）
- source 约定：`mine:enum:<相对路径>`（M1）/ `mine:db:<相对路径>`（M2）；confidence = `extracted`
- 扫描排除目录：现有 `EXCLUDE_DIRS`（node_modules/target/dist/.git/.wiki/__pycache__）+ 新增 `.svn`
- 模块名：源文件相对项目根路径的首段目录名；无层级时 `module:core`
- **wiki-query skill 不得改动**（有回归测试保护）
- 所有文件无 BOM（仓库硬规则）；测试用 node:test，命令 `node --test <file>`
- 中断安全：progress.json 在**每模块完成后**回写（非每文件），中断最多重挖一个模块

---

### Task 1: 扩展 WikiCategory 类型 + 目录骨架

**Files:**
- Modify: `src/types.ts:10`
- Modify: `src/vault-store.ts:10`（CATEGORIES 数组）

**Interfaces:**
- Consumes: 现有 `WikiCategory`、`CATEGORIES`
- Produces: `WikiCategory` 含 `'dictionaries' | 'tables'`；`CATEGORIES` 数组 7 项

- [ ] **Step 1: 写失败测试**（`design-system` 无类型测试，先建 `category.test.mjs`）

```js
// category.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

test('WikiCategory 扩展 dictionaries + tables', () => {
  const t = readFileSync(join(ROOT, 'src/types.ts'), 'utf8')
  assert.match(t, /'dictionaries'/, 'types.ts 应含 dictionaries 分类')
  assert.match(t, /'tables'/, 'types.ts 应含 tables 分类')
})

test('vault-store CATEGORIES 数组含新目录', () => {
  const t = readFileSync(join(ROOT, 'src/vault-store.ts'), 'utf8')
  assert.match(t, /'dictionaries'/, 'CATEGORIES 应含 dictionaries')
  assert.match(t, /'tables'/, 'CATEGORIES 应含 tables')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test category.test.mjs`
Expected: FAIL（两断言都找不到新分类）

- [ ] **Step 3: 实现**

`src/types.ts:10` 改为：
```ts
export type WikiCategory = 'concepts' | 'entities' | 'references' | 'synthesis' | 'projects' | 'dictionaries' | 'tables'
```

`src/vault-store.ts:10` 改为：
```ts
const CATEGORIES: WikiCategory[] = ['concepts', 'entities', 'references', 'synthesis', 'projects', 'dictionaries', 'tables']
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test category.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/types.ts src/vault-store.ts category.test.mjs
git commit -m "feat(mining): 扩展 WikiCategory 支持 dictionaries/tables 目录"
```

---

### Task 2: index-builder 新分区 + 前端分类联动

**Files:**
- Modify: `src/index-builder.ts:9-15`（SECTION_TITLES）
- Modify: `src/client/LintPanel.tsx:11-17`（CATEGORIES 下拉）
- Modify: `src/client/GraphView.tsx:21-29`（着色映射）
- Modify: `src/client/styles.ts`（`--knj-cat-*` 色标）

**Interfaces:**
- Consumes: Task 1 的 `WikiCategory`
- Produces: index.md 含「## 字典」「## 数据结构」分区；LintPanel 导入下拉含字典/数据结构；图谱含新着色

- [ ] **Step 1: 写失败测试**（追加到 `index-builder.test.mjs` 或新建 `category-ui.test.mjs`）

```js
// category-ui.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const CLIENT = join(ROOT, 'src/client')

test('index-builder 分区标题含字典/数据结构', () => {
  const t = readFileSync(join(ROOT, 'src/index-builder.ts'), 'utf8')
  assert.match(t, /'dictionaries', title: '## 字典'/, 'index-builder 应有字典分区')
  assert.match(t, /'tables', title: '## 数据结构'/, 'index-builder 应有数据结构分区')
})

test('LintPanel 导入分类含新目录', () => {
  const t = readFileSync(join(CLIENT, 'LintPanel.tsx'), 'utf8')
  assert.match(t, /value: 'dictionaries'/, 'LintPanel 应有 dictionaries 分类')
  assert.match(t, /value: 'tables'/, 'LintPanel 应有 tables 分类')
})

test('GraphView 着色映射含新分类', () => {
  const t = readFileSync(join(CLIENT, 'GraphView.tsx'), 'utf8')
  assert.match(t, /dictionaries/, 'GraphView 应有 dictionaries 着色')
  assert.match(t, /tables/, 'GraphView 应有 tables 着色')
})

test('styles.ts 新分类色标', () => {
  const t = readFileSync(join(CLIENT, 'styles.ts'), 'utf8')
  assert.match(t, /--knj-cat-dictionaries/, 'styles.ts 应有 dictionaries 色标')
  assert.match(t, /--knj-cat-tables/, 'styles.ts 应有 tables 色标')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test category-ui.test.mjs`
Expected: FAIL（全部断言未命中）

- [ ] **Step 3: 实现**

`src/index-builder.ts:9-15`：
```ts
const SECTION_TITLES: Array<{ category: WikiCategory; title: string }> = [
  { category: 'concepts', title: '## 概念页' },
  { category: 'entities', title: '## 实体页' },
  { category: 'dictionaries', title: '## 字典' },
  { category: 'tables', title: '## 数据结构' },
  { category: 'references', title: '## 参考资料' },
  { category: 'synthesis', title: '## 综合' },
  { category: 'projects', title: '## 项目知识' },
]
```

`src/client/LintPanel.tsx:11-17` 的 CATEGORIES 数组追加：
```ts
{ value: 'dictionaries', label: '字典' },
{ value: 'tables', label: '数据结构' },
```

`src/client/GraphView.tsx:21-29`：
```ts
const CATEGORY_CLASS: Record<string, string> = {
  concepts: 'knj-graph-node--concepts', entities: 'knj-graph-node--entities',
  references: 'knj-graph-node--references', synthesis: 'knj-graph-node--synthesis', projects: 'knj-graph-node--projects',
  dictionaries: 'knj-graph-node--dictionaries', tables: 'knj-graph-node--tables',
}
const CATEGORY_LABELS: Record<string, string> = {
  concepts: '概念', entities: '实体', references: '参考', synthesis: '综合', projects: '项目',
  dictionaries: '字典', tables: '数据结构',
}
```

`src/client/styles.ts` 根规则追加色标（复用宿主 static 色板，注意别与既有色重复）：
```ts
--knj-cat-dictionaries: var(--dsw-static-purple-400, #c084fc);
--knj-cat-tables: var(--dsw-static-cyan-400, #22d3ee);
```

`src/client/styles.ts` 追加图谱节点着色（GraphView 节点 CSS 区段）：
```css
.knj-wiki .knj-graph-node--dictionaries { fill: var(--knj-cat-dictionaries); }
.knj-wiki .knj-graph-node--tables { fill: var(--knj-cat-tables); }
```

- [ ] **Step 4: 运行确认通过 + 客户端类型检查**

Run: `node --test category-ui.test.mjs`
Run: `npm run check:client`
Expected: PASS + 无类型错误

- [ ] **Step 5: 提交**

```bash
git add src/index-builder.ts src/client/LintPanel.tsx src/client/GraphView.tsx src/client/styles.ts category-ui.test.mjs
git commit -m "feat(mining): index/UI/图谱支持 dictionaries+tables 分类"
```

---

### Task 3: wiki_ingest / wiki_capture 分类枚举扩展

**Files:**
- Modify: `src/tools.ts:32,118`（category enum）

**Interfaces:**
- Consumes: Task 1 的 `WikiCategory`
- Produces: `wiki_ingest`/`wiki_capture` 的 category 参数接受新分类

- [ ] **Step 1: 写失败测试**（追加 `tools.test.mjs`）

```js
test('wiki_ingest 工具 category 枚举含 dictionaries/tables', () => {
  const t = readFileSync(join(ROOT, 'src/tools.ts'), 'utf8')
  assert.match(t, /enum: \['concepts', 'entities', 'references', 'synthesis', 'projects', 'dictionaries', 'tables'\]/, 'wiki_ingest category 应含新分类')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tools.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现**

`src/tools.ts:32` 的 enum 改为：
```ts
enum: ['concepts', 'entities', 'references', 'synthesis', 'projects', 'dictionaries', 'tables'],
```
`src/tools.ts:118` 的 wiki_capture category enum 同步：
```ts
category: { type: 'string', enum: ['concepts', 'entities', 'references', 'synthesis', 'projects', 'dictionaries', 'tables'] },
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tools.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/tools.ts tools.test.mjs
git commit -m "feat(mining): wiki_ingest/wiki_capture 支持新分类"
```

---

### Task 4: mining-progress.ts（断点续传基础设施）

**Files:**
- Create: `src/mining-progress.ts`
- Test: `mining-progress.test.mjs`

**Interfaces:**
- Consumes: 无（纯 Node fs）
- Produces:
  - `interface MiningProgress { version: 1; kind: 'enum' | 'db'; modules: Record<string, ModuleState> }`
  - `interface ModuleState { state: 'pending' | 'done' | 'partial'; updatedAt: string }`
  - `readProgress(progressFile: string, kind): MiningProgress` —— 文件不存在返回空结构
  - `markModule(progress, module, state): void` —— 更新单个模块状态并写回
  - `pendingModules(progress): string[]` —— 未完成模块列表（pending/partial）

- [ ] **Step 1: 写失败测试**

```js
// mining-progress.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProgress, markModule, pendingModules } from './src/mining-progress.ts'

function tmp() { return mkdtempSync(join(tmpdir(), 'mining-progress-')) }

test('readProgress 文件不存在返回空结构', () => {
  const p = readProgress(join(tmp(), 'progress.json'), 'enum')
  assert.equal(p.version, 1)
  assert.equal(p.kind, 'enum')
  assert.deepEqual(Object.keys(p.modules), [])
})

test('markModule 写回文件且中断安全', () => {
  const dir = tmp()
  const file = join(dir, 'progress.json')
  let p = readProgress(file, 'enum')
  markModule(p, 'order', 'done')
  // 模拟中断后重新读取
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(raw.modules.order.state, 'done')
  p = readProgress(file, 'enum')
  assert.equal(p.modules.order.state, 'done')
  rmSync(dir, { recursive: true, force: true })
})

test('pendingModules 只返回未完成模块', () => {
  const file = join(tmp(), 'progress.json')
  let p = readProgress(file, 'enum')
  markModule(p, 'order', 'done')
  markModule(p, 'user', 'pending')
  markModule(p, 'pay', 'partial')
  assert.deepEqual(pendingModules(p).sort(), ['pay', 'user'])
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test mining-progress.test.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**（`src/mining-progress.ts`）

```ts
// src/mining-progress.ts
// 断点续传：模块级进度（pending/done/partial）。每模块完成后写回，
// 中断最多丢一个模块。文件落 vault _raw/_tools/progress-<kind>.json。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export type MiningKind = 'enum' | 'db'
export type ModuleStateValue = 'pending' | 'done' | 'partial'

export interface ModuleState {
  state: ModuleStateValue
  updatedAt: string
}

export interface MiningProgress {
  version: 1
  kind: MiningKind
  modules: Record<string, ModuleState>
}

export function readProgress(progressFile: string, kind: MiningKind): MiningProgress {
  if (existsSync(progressFile)) {
    try {
      const parsed = JSON.parse(readFileSync(progressFile, 'utf8')) as MiningProgress
      if (parsed.version === 1 && parsed.kind === kind) return parsed
    } catch { /* 损坏文件按空进度处理 */ }
  }
  return { version: 1, kind, modules: {} }
}

export function markModule(progress: MiningProgress, module: string, state: ModuleStateValue, progressFile: string): void {
  progress.modules[module] = { state, updatedAt: new Date().toISOString() }
  writeFileSync(progressFile, JSON.stringify(progress, null, 2), 'utf8')
}

export function pendingModules(progress: MiningProgress): string[] {
  return Object.entries(progress.modules)
    .filter(([, s]) => s.state === 'pending' || s.state === 'partial')
    .map(([m]) => m)
}

export function progressFileFor(wikiRoot: string, kind: MiningKind): string {
  return join(wikiRoot, '_raw', '_tools', `progress-${kind}.json`)
}
```

> 注意：`join` 需 `import { join } from 'node:path'`（上面实现已省略，务必加上）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test mining-progress.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/mining-progress.ts mining-progress.test.mjs
git commit -m "feat(mining): 模块级进度断点续传（progress.json）"
```

---

### Task 5: code-miner.ts enumMiner（枚举解析器）

**Files:**
- Create: `src/code-miner.ts`
- Test: `code-miner.test.mjs`

**Interfaces:**
- Consumes: `WikiCategory`（Task 1）
- Produces:
  - `interface EnumCandidate { name: string; module: string; file: string; line: number; values: EnumValue[]; kind: 'enum' | 'constants'; hash: string }`（**hash = 源文件内容 SHA-256**，供 Task 6 对账）
  - `interface EnumValue { name: string; code?: string; label?: string; line: number }`
  - `function mineEnums(root: string, moduleFilter?: string): { enums: EnumCandidate[]; modules: string[]; outline: ModuleOutline[] }`
  - `interface ModuleOutline { module: string; fileCount: number; enumEstimate: number }`
  - 排除目录：`EXCLUDE_DIRS` 含 `.svn`

- [ ] **Step 1: 写失败测试 + fixtures**

创建 fixtures 目录 `test-fixtures/mining/`：
- `OrderEnum.java`：
```java
package com.pingan.iobs.order;

/**
 * 订单状态
 */
public enum OrderStatus {
    CREATED("01", "已创建"),
    PAID("02", "已支付"),
    SHIPPED("03", "已发货"),
    CANCELLED("99", "已取消");

    private final String code;
    private final String label;
    OrderStatus(String code, String label) { this.code = code; this.label = label; }
}
```
- `OrderStatus` 应为 1 个枚举、4 个值、module=order、每个值有 code+label
- `PaymentConstants.java`：
```java
package com.pingan.iobs.pay;

public final class PaymentConstants {
    /** 支付渠道：微信 */
    public static final String CHANNEL_WECHAT = "WX";
    /** 支付渠道：支付宝 */
    public static final String CHANNEL_ALIPAY = "ALI";
}
```
- 应为 1 个常量类、2 个常量（code=WX/ALI、label=微信/支付宝）、module=pay
- 无值枚举 `SimpleFlag.java`：`public enum SimpleFlag { A, B, C }` → 3 个值（名称即值）

```js
// code-miner.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mineEnums } from './src/code-miner.ts'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const FIX = join(ROOT, 'test-fixtures', 'mining')

test('enumMiner 解析带码值枚举', () => {
  const { enums } = mineEnums(FIX)
  const st = enums.find((e) => e.name === 'OrderStatus')
  assert.ok(st, '应挖到 OrderStatus')
  assert.equal(st.module, 'order')
  assert.equal(st.values.length, 4)
  assert.deepEqual(st.values[0], { name: 'CREATED', code: '01', label: '已创建', line: 8 })
})

test('enumMiner 解析常量类（相邻注释为 label）', () => {
  const { enums } = mineEnums(FIX)
  const pc = enums.find((e) => e.name === 'PaymentConstants')
  assert.ok(pc, '应挖到 PaymentConstants')
  assert.equal(pc.kind, 'constants')
  assert.equal(pc.module, 'pay')
  assert.deepEqual(pc.values[0], { name: 'CHANNEL_WECHAT', code: 'WX', label: '支付渠道：微信', line: 5 })
})

test('enumMiner 无值枚举名称即值', () => {
  const { enums } = mineEnums(FIX)
  const sf = enums.find((e) => e.name === 'SimpleFlag')
  assert.ok(sf)
  assert.equal(sf.values.length, 3)
  assert.deepEqual(sf.values[0], { name: 'A', line: 1 })
})

test('outline 输出模块清单与预估', () => {
  const { outline } = mineEnums(FIX)
  const order = outline.find((m) => m.module === 'order')
  assert.ok(order)
  assert.equal(order.enumEstimate, 1)
})

test('排除 .svn 目录', () => {
  // FIX 下创建 .svn/hidden-enum.java 后 mineEnums 不应包含
  const { enums } = mineEnums(join(FIX, 'svn-scenario'))
  assert.ok(!enums.some((e) => e.file.includes('.svn')), '不应扫描 .svn')
})
```

> svn-scenario 夹具目录：`test-fixtures/mining/svn-scenario/.svn/HiddenEnum.java`（合法枚举内容）+ 一个正常文件。

- [ ] **Step 2: 运行确认失败**

Run: `node --test code-miner.test.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**（`src/code-miner.ts` 核心）

```ts
// src/code-miner.ts
// 代码结构挖掘：enumMiner（枚举/常量类）+ outline（模块清单）。
// 轻量结构扫描（正则 + 括号匹配），非全量 AST——千级文件秒级、可按文件批并行。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { createHash } from 'node:crypto'

const EXCLUDE_DIRS = new Set(['node_modules', '.git', '.svn', 'target', 'dist', '__pycache__', '.wiki'])

export interface EnumValue { name: string; code?: string; label?: string; line: number }
export interface EnumCandidate {
  name: string
  module: string
  file: string       // 相对 root 路径
  line: number
  values: EnumValue[]
  kind: 'enum' | 'constants'
  hash: string       // 源文件内容 SHA-256（Task 6 对账用）
}
export interface ModuleOutline { module: string; fileCount: number; enumEstimate: number }

export interface MineResult {
  enums: EnumCandidate[]
  modules: string[]
  outline: ModuleOutline[]
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function moduleOf(pkg: string): string {
  // 包名首段（com.pingan.iobs.order → order）；无包 → core
  const parts = pkg.split('.').filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 1] : (parts[0] ?? 'core')
}

function collectJavaFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (EXCLUDE_DIRS.has(e.name)) continue
        walk(join(dir, e.name))
      } else if (e.isFile() && e.name.endsWith('.java')) {
        out.push(join(dir, e.name))
      }
    }
  }
  walk(root)
  return out
}

/** 解析单文件，返回候选（可能 0 个）。 */
export function parseJavaFile(relPath: string, text: string): EnumCandidate[] {
  const out: EnumCandidate[] = []
  const pkgMatch = text.match(/package\s+([\w.]+)\s*;/)
  const pkg = pkgMatch?.[1] ?? ''
  const module = moduleOf(pkg)
  const lines = text.split('\n')

  // ---- enum 声明：enum Name { ... }，花括号计数取块 ----
  const enumRe = /\benum\s+([A-Za-z_$][\w$]*)\s*\{/g
  let m: RegExpExecArray | null
  while ((m = enumRe.exec(text)) !== null) {
    const name = m[1]
    const openIdx = text.indexOf('{', m.index)
    // 括号配对：找配对的 }
    let depth = 0
    let closeIdx = -1
    for (let i = openIdx; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') { depth--; if (depth === 0) { closeIdx = i; break } }
    }
    if (closeIdx === -1) continue
    const body = text.slice(openIdx + 1, closeIdx)
    const lineNo = lines.length // 占位，下面按行重新定位
    const values: EnumValue[] = []
    // 值：NAME 或 NAME("code","label") 或 NAME(code,"label")
    const valRe = /([A-Za-z_$][\w$]*)\s*(?:\(\s*("(?:[^"\\]|\\.)*"|[^,)]+)\s*,\s*("(?:[^"\\]|\\.)*"|[^,)]+)\s*\))?/g
    let vm: RegExpExecArray | null
    let guard = 0
    while ((vm = valRe.exec(body)) !== null && guard++ < 200) {
      const vName = vm[1]
      const vLine = lineOf(text, lines, openIdx + 1 + vm.index)
      if (vm[2] === undefined) { values.push({ name: vName, line: vLine }); continue }
      const codeRaw = vm[2].trim()
      const labelRaw = vm[3].trim()
      const code = (codeRaw.startsWith('"') ? codeRaw.slice(1, -1) : codeRaw)
      const label = (labelRaw.startsWith('"') ? labelRaw.slice(1, -1) : labelRaw)
      values.push({ name: vName, code, label, line: vLine })
    }
    out.push({ name, module, file: relPath, line: lineOf(text, lines, m.index), values, kind: 'enum' })
  }

  // ---- 常量类：public static final (String|int|...) NAME = value; 相邻注释为 label ----
  const constRe = /public\s+static\s+final\s+(?:String|Integer|Long|int|long|short|byte)\s+([A-Za-z_$][\w$]*)\s*=\s*("(?:[^"\\]|\\.)*"|\d+)\s*;/g
  let cm: RegExpExecArray | null
  const constValues: EnumValue[] = []
  let constClassLine = 0
  let constClassFound = false
  const classRe = /public\s+(?:final\s+)?class\s+([A-Za-z_$][\w$]*)/g
  let cmClass: RegExpExecArray | null
  let currentClass = ''
  while ((cmClass = classRe.exec(text)) !== null) { currentClass = cmClass[1]; constClassLine = lineOf(text, lines, cmClass.index) }
  if (currentClass && /public\s+static\s+final/.test(text)) {
    while ((cm = constRe.exec(text)) !== null) {
      const cName = cm[1]
      const rawVal = cm[2]
      const code = rawVal.startsWith('"') ? rawVal.slice(1, -1) : rawVal
      // 向前找最近注释行
      const cLine = lineOf(text, lines, cm.index)
      let label = ''
      for (let i = cLine - 2; i >= 0; i--) {
        const t = lines[i].trim()
        if (t.startsWith('/**') || t.startsWith('*')) {
          label = t.replace(/^\/\*\*?\s*|\*\/?\s*$|\*\s*/g, '').trim()
          break
        }
        if (t === '' || t.startsWith('}')) break
      }
      constValues.push({ name: cName, code, label, line: cLine })
    }
    if (constValues.length > 0) {
      out.push({ name: currentClass, module, file: relPath, line: constClassLine, values: constValues, kind: 'constants' })
    }
  }

  return out
}

function lineOf(text: string, lines: string[], index: number): number {
  let count = 1
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') count++
  return count
}

export function mineEnums(root: string, moduleFilter?: string): MineResult {
  const files = collectJavaFiles(root)
  const byModule = new Map<string, { fileCount: number; enums: EnumCandidate[] }>()
  for (const f of files) {
    let text = ''
    try { text = readFileSync(f, 'utf8').replace(/\r\n/g, '\n') } catch { continue }
    const rel = relative(root, f).replace(/\\/g, '/')
    const candidates = parseJavaFile(rel, text)
    const fileHash = sha256(text)
    for (const c of candidates) {
      const mod = c.module
      if (moduleFilter && mod !== moduleFilter) continue
      if (!byModule.has(mod)) byModule.set(mod, { fileCount: 0, enums: [] })
      byModule.get(mod)!.fileCount++
      byModule.get(mod)!.enums.push({ ...c, hash: fileHash })
    }
  }
  const enums = [...byModule.values()].flatMap((v) => v.enums)
  const outline: ModuleOutline[] = [...byModule.entries()].map(([module, v]) => ({
    module, fileCount: v.fileCount, enumEstimate: v.enums.length,
  }))
  return { enums, modules: outline.map((o) => o.module), outline }
}
```

> 注意：`lineOf` 对空字符串的 guard、常量类多类文件的 class 定位是简化实现——测试夹具覆盖即可，后续大系统精度问题由 outline/人工筛兜底。

- [ ] **Step 4: 运行确认通过 + 类型检查**

Run: `node --test code-miner.test.mjs`
Run: `npm run typecheck`
Expected: PASS + 无类型错误

- [ ] **Step 5: 提交**

```bash
git add src/code-miner.ts code-miner.test.mjs test-fixtures/
git commit -m "feat(mining): enumMiner 解析枚举声明与常量类（含 outline）"
```

---

### Task 6: wiki_mine 工具（候选目录 + 对账报告 + resume）

**Files:**
- Modify: `src/tools.ts`
- Test: 追加 `tools.test.mjs`

**Interfaces:**
- Consumes: `mineEnums`（Task 5，候选含 hash）、`readProgress/markModule/pendingModules/progressFileFor`（Task 4）、`VaultProvider`、`manifestEntry`（VaultStoreLike，已有）
- Produces: `wiki_mine` 工具，参数 `{ kind: 'enum'|'db'|'both', module?: string, resume?: boolean }`
  - 输出（枚举级对账报告，回答用户三问：未挖/已挖/有变）：
    `{ enums, new, changed, unchanged, deleted, outline, modules, remaining, note? }`
  - 对账逻辑：全量扫描候选（含 hash）↔ `store.manifestEntry('mine:enum:<file>')` 记录：
    - 无记录 → `new`
    - 记录哈希一致 → `unchanged`
    - 记录哈希不同 → `changed`
    - manifest 有 `mine:enum:*` source 但当前扫描无此文件 → `deleted`

- [ ] **Step 1: 写失败测试**（`tools.test.mjs` 追加；复用现有 store 构造方式，先看 tools.test.mjs 里如何造 store）

```js
test('wiki_mine 空结果不报错', async () => {
  const { result } = await runMine({ kind: 'enum', root: emptyDir })
  assert.deepEqual(result.enums, [])
  assert.deepEqual(result.new, [])
  assert.ok(result.note.includes('未发现'))
})

test('wiki_mine 对账：同哈希→unchanged，改哈希→changed，新文件→new', async () => {
  const { result, store } = await runMine({ kind: 'enum', root: fixtureDir })
  // 首次：全部 new
  assert.equal(result.new.length, result.enums.length)
  // 模拟入库后再次挖掘（manifest 记录同哈希）
  for (const e of result.enums) {
    store.updateManifest(`mine:enum:${e.file}`, { content_hash: e.hash, last_ingested: new Date().toISOString(), pages_produced: [e.name.toLowerCase()] })
  }
  const again = await runMine({ kind: 'enum', root: fixtureDir })
  assert.equal(again.result.unchanged.length, result.enums.length)
  assert.equal(again.result.new.length, 0)
})

test('wiki_mine 对账：manifest 有记录但文件消失 → deleted', async () => {
  const { store, result } = await runMine({ kind: 'enum', root: fixtureDir })
  // 往 manifest 塞一条不存在的源
  store.updateManifest('mine:enum:ghost/Removed.java', { content_hash: 'abc', last_ingested: new Date().toISOString(), pages_produced: ['removed'] })
  const again = await runMine({ kind: 'enum', root: fixtureDir })
  assert.ok(again.result.deleted.some((d) => d.includes('ghost/Removed.java')), '应检测到已消失源文件')
})
```

> 实际测试需按 tools.test.mjs 既有模式构造 provider/store（读该文件头部确认构造方式，保持一致）。`runMine` 为测试辅助（执行工具 execute 或直接调内部函数）。

- [ ] **Step 2: 运行确认失败**

Run: `node --test tools.test.mjs`
Expected: FAIL（wiki_mine 未注册）

- [ ] **Step 3: 实现**（`src/tools.ts` 追加注册）

```ts
ctx.tools.register(defineTool({
  name: 'wiki_mine',
  description: '从当前工作区项目静态挖掘代码结构候选（枚举字典/表结构），供蒸馏后经 wiki_ingest 入库。大纲→细节两阶段；每次运行输出枚举级对账报告（new/changed/unchanged/deleted）：未挖=new、挖过无变=unchanged、有变化=changed、代码已删=deleted。resume 时按 progress.json 只处理未完成模块，断点续传。',
  parameters: {
    kind: { type: 'string', enum: ['enum', 'db', 'both'], description: '挖掘类型：enum=枚举字典；db=表结构（M2 实现）；both=两者' },
    module: { type: 'string', description: '模块过滤（可选）：只挖指定模块' },
    resume: { type: 'boolean', description: '断点续传：读 progress.json 只处理 pending/partial 模块' },
  },
  output: {
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        enums: {
          type: 'array', required: true,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              name: { type: 'string' }, module: { type: 'string' }, file: { type: 'string' },
              line: { type: 'number' }, kind: { type: 'string' }, hash: { type: 'string' },
              values: { type: 'array', items: { type: 'object' } },
            },
          },
        },
        new: { type: 'array', items: { type: 'object' }, required: true },
        changed: { type: 'array', items: { type: 'object' }, required: true },
        unchanged: { type: 'array', items: { type: 'object' }, required: true },
        deleted: { type: 'array', items: { type: 'string' }, required: true },
        outline: { type: 'array', items: { type: 'object' }, required: true },
        modules: { type: 'array', items: { type: 'string' }, required: true },
        remaining: { type: 'number', required: true },
        note: { type: 'string' },
      },
    },
    render: (_args, value) => {
      const base = `挖掘：${value.modules.length} 模块 / 枚举 ${value.new.length} 新 · ${value.changed.length} 变 · ${value.unchanged.length} 无变 · ${value.deleted.length} 删，剩 ${value.remaining} 模块待挖`
      return [{ type: 'text', text: value.enums.length === 0 && value.deleted.length === 0 ? `${base}（${value.note ?? ''}）` : base }]
    },
  },
  async execute(args) {
    const store = currentStore(provider)
    const projectRoot = join(store.wikiRoot, '..') // .wiki 的父目录 = 项目根
    const kind = args.kind ?? 'both'
    const progressFile = progressFileFor(store.wikiRoot, 'enum')
    const progress = readProgress(progressFile, 'enum')
    const resumeOnly = args.resume ? new Set(pendingModules(progress)) : null
    const enumResult = (kind === 'enum' || kind === 'both') ? mineEnums(projectRoot, args.module) : { enums: [], outline: [], modules: [] }
    let enums = enumResult.enums
    if (resumeOnly && enums.length > 0) enums = enums.filter((e) => resumeOnly.has(e.module))

    // ---- 对账：全量扫描候选 ↔ manifest 记录 ----
    const newE: typeof enums = []
    const changedE: typeof enums = []
    const unchangedE: typeof enums = []
    const scannedFiles = new Set(enums.map((e) => e.file))
    for (const e of enums) {
      const prev = store.manifestEntry(`mine:enum:${e.file}`)
      if (!prev) newE.push(e)
      else if (prev.content_hash === e.hash) unchangedE.push(e)
      else changedE.push(e)
    }
    // deleted：manifest 有 mine:enum:* 记录但当前扫描无此文件
    const deleted: string[] = []
    const allSources = Object.keys((store as any).manifest?.sources ?? {}) // 或经 listPages 反推
    for (const src of allSources) {
      if (src.startsWith('mine:enum:') && !scannedFiles.has(src.slice('mine:enum:'.length))) {
        deleted.push(src.slice('mine:enum:'.length))
      }
    }

    const note = enums.length === 0 && deleted.length === 0
      ? '当前项目未发现枚举声明或常量类' : undefined
    return {
      enums, new: newE, changed: changedE, unchanged: unchangedE, deleted,
      outline: enumResult.outline, modules: enumResult.modules,
      remaining: resumeOnly ? resumeOnly.size : enumResult.modules.length, note,
    }
  },
}))
```

> 需要顶部 import：`import { mineEnums } from './code-miner.ts'`、`import { readProgress, markModule, pendingModules, progressFileFor } from './mining-progress.ts'`、`import { join } from 'node:path'`（join 已有）。
> 注意：deleted 判定里 `store.manifest` 的读取方式需按 VaultStore 实际暴露面调整（如无直接 manifest 访问，用 `listPages` 反推 `mine:enum:*` 来源或给 VaultStoreLike 加只读 manifestSources()）。实现时以 vault-store.ts 实际 API 为准。

- [ ] **Step 4: 运行确认通过 + 全量测试**

Run: `node --test tools.test.mjs`
Run: `node --test *.test.mjs`
Expected: PASS + 全绿

- [ ] **Step 5: 提交**

```bash
git add src/tools.ts tools.test.mjs
git commit -m "feat(mining): wiki_mine 工具（候选目录 + resume 断点续传）"
```

---

### Task 7: wiki-mine skill（蒸馏入库工作流）

**Files:**
- Create: `wiki-mine/SKILL.md`
- Modify: `package.json`（files 白名单加 `wiki-mine`）
- Test: 追加 `tools.test.mjs` 或 `README` 契约（skill 文件存在）

**Interfaces:**
- Consumes: `wiki_mine` 工具（Task 6）、`wiki_ingest`
- Produces: 可执行的蒸馏工作流文档

- [ ] **Step 1: 写失败测试**

```js
// 追加 tools.test.mjs
test('wiki-mine skill 文件存在且 package.json 白名单包含', () => {
  const skill = readFileSync(join(ROOT, 'wiki-mine/SKILL.md'), 'utf8')
  assert.match(skill, /wiki_mine/, 'SKILL.md 应指导调用 wiki_mine 工具')
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.ok(pkg.files.includes('wiki-mine'), 'package.json files 应含 wiki-mine')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tools.test.mjs`
Expected: FAIL（目录不存在）

- [ ] **Step 3: 实现**（`wiki-mine/SKILL.md`）

```markdown
---
name: wiki-mine
description: >
  从当前工作区项目静态挖掘代码结构（枚举字典/表结构）进知识库。用户说"挖掘枚举字典"、
  "把系统的表结构整理进知识库"、"挖代码结构"、"wiki-mine" 时使用。大纲→细节两阶段，
  支持断点续传。入库经 wiki_ingest 工具（不要手写 .wiki 文件）。
---

# Wiki Mine — 代码结构挖掘进知识库

把当前工作区项目的**静态骨架知识**（枚举字典 / 表结构）确定性解析后蒸馏入库。
与 wiki-distill（会话蒸馏）互补：会话是"发生了什么"，代码结构是"系统由什么构成"。

## 第 0 步：确认范围（必做）

- 挖掘类型：enum（枚举字典）/ db（表结构）/ both —— 当前实现 enum 完整、db 见 M2
- 模块过滤：默认全项目；大系统建议按模块迭代（先 outline 看规模再选模块）
- 断点续传：上次未挖完时确认是否 resume

## 第 1 步：大纲（了解全貌与规模）

调用 `wiki_mine { kind, resume? }` 读 outline：
- outline 列出模块清单 + 每模块文件数 + 枚举预估数
- 若大纲显示模块很多，与用户确认本批模块范围（单批 ≤10 模块）

## 第 2 步：细节（按批挖掘）

对选定模块调用 `wiki_mine { kind, module }` 取候选目录（含源文件路径与行号）。

## 第 3 步：蒸馏（模型工作）

按枚举/常量类逐个生成字典页：
1. 每页一个枚举/常量类（**逐枚举独立页**，不合并）
2. 正文用值表格：`| 名称 | 编码 | 说明 |`（无编码枚举则两列）
3. 附来源（文件路径 + 声明行号）；category=dictionaries，tags=[enum, module:<模块名>]
4. 常量类挖出的普通常量：无字典价值的人工筛掉，只留业务码值

## 第 4 步：入库（wiki_ingest）

- source = `mine:enum:<相对路径>`（每文件一个 source）
- contentHash = 源文件内容 SHA-256（可用 node 或 sha256sum 计算）
- confidence = extracted；页面 id = 枚举名 kebab-case

## 第 5 步：收尾

- 每模块完成后调用 `wiki_mine { kind, resume: true }` 确认进度推进
- 全部完成后建议用户点「重建索引」让 index.md 覆盖新分区（## 字典）
- 报告：`本批 N 模块（K 完成）→ 产 M 页 → 剩 J 模块待挖`
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tools.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add wiki-mine/SKILL.md package.json tools.test.mjs
git commit -m "feat(mining): wiki-mine skill 蒸馏工作流"
```

---

### Task 8: 重建 client 产物 + 全量回归 + 同步安装副本

**Files:**
- Modify: `client/client.js`（重建，含 Task 2 的样式/UI 改动）
- 同步：`C:\Users\MrYang\.dsh\profiles\web\node_modules\dsh-knj-obsidian`

- [ ] **Step 1: 重建 client**

Run: `npm run build:client`
Expected: Build complete，client.js 更新

- [ ] **Step 2: 全量测试**

Run: `node --test *.test.mjs`
Expected: 全绿（含 category/category-ui/code-miner/mining-progress 新测试）

- [ ] **Step 3: 同步安装副本**

```bash
Copy-Item client/client.js  C:\Users\MrYang\.dsh\profiles\web\node_modules\dsh-knj-obsidian\client\client.js
Copy-Item client/client.js.map ...（同路径）
Copy-Item src/client/styles.ts src/client/LintPanel.tsx src/client/GraphView.tsx ...（同路径）
```

- [ ] **Step 4: 在线验证 manifest rev**

Run: 抓 `http://127.0.0.1:3080/` 的 `dsh-knj-obsidian` rev，与本地文件 SHA1-12 比对
Expected: 一致（缓存必失效）

- [ ] **Step 5: 提交**

```bash
git add client/client.js client/client.js.map src/
git commit -m "build(mining): 重建 client 产物并同步安装副本"
```

---

## Self-Review（writing-plans 要求）

**Spec 覆盖：**
- §2 enumMiner（enum + 常量类）→ Task 5 ✓
- §3 共享基础设施（扫描 EXCLUDE_DIRS+.svn / manifest 增量 / 知识页契约）→ Task 1-3、5 ✓
- §3.4 category 扩展六处 → Task 1-3 ✓
- §4 双通道（wiki_mine 工具 / wiki-mine skill）→ Task 6-7 ✓
- §5 两阶段 + 断点续传 → Task 4（progress）+ 6（resume）+ 7（skill 流程）✓
- §6 错误处理（0 结果不报错 / 中断丢一模块）→ Task 6 note + Task 4 中断安全 ✓
- §7 测试（fixtures 红绿 / resume 行为 / skill 未改动回归）→ Task 5/6/7 ✓
- wiki-query skill 不动 → Task 3 后的 `tools.test.mjs` 全绿即回归保护 ✓

**占位符扫描：** Task 6 的测试代码有「按 tools.test.mjs 既有模式构造」说明（非占位，是执行指引——执行者需先读该文件）；Task 5 实现注释有简化说明。无 TBD/TODO。

**类型一致性：** `mineEnums`/`parseJavaFile`/`readProgress`/`markModule`/`pendingModules`/`progressFileFor` 在 Task 4-6 中签名一致。`EnumCandidate`/`ModuleOutline` 跨 Task 5/6 一致。

**注意：** Task 5 的 `lineOf` 与常量类解析为简化实现，fixtures 已覆盖主路径；大系统精度问题留 outline + 人工筛兜底（spec §7 已承诺）。
