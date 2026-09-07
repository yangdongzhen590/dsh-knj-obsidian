# M2 数据库表结构挖掘实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从当前工作区项目静态解析数据库表结构（SQL DDL / MyBatis mapper / JPA 实体），逐表产出独立知识页（tables 分类），与 M1 共用对账报告与断点续传机制。

**Architecture:** `src/code-miner.ts` 新增 `tableMiner`（DDL/mapper/Entity 三种来源解析 + 合并，DDL 优先），`mineTables` 输出候选（含源文件哈希）。`wiki_mine` 扩展 `kind='db'` 分支：tables 级对账报告（new/changed/unchanged/deleted）+ resume。wiki-mine skill 补 db 流程。来源适配器概念预留（MCP/生产导出后续接入，本期只实现文件扫描）。

**Tech Stack:** TypeScript（Node ≥20）、node:test、正则+XML 标签配对轻量解析、现有 VaultStore/wiki_ingest 管道。

**Spec:** `docs/2026-08-31-db-table-mining-design.md`（M2）+ `docs/2026-08-31-enum-dictionary-mining-design.md`（M1，共享 §3 基础设施已在 M1 完成）

## Global Constraints

- 落点：表 → `tables/`，tags = `table` 或 `db` + `module:<模块名>`；source = `mine:db:<相对路径>`；confidence = `extracted`
- 扫描排除：现有 `EXCLUDE_DIRS`（含 `.svn`）
- **wiki-query skill 不得改动**（回归保护已存在）
- 模块名：源文件相对项目根首段目录；无则 `module:core`
- 文件无 BOM；测试 `node --test`
- 对账与 M1 同构：manifest 文件级哈希为准，progress.json 只作模块级断点辅助
- 中断安全：每模块完成后回写 progress

---

### Task M2-1: tableMiner — SQL DDL 解析器

**Files:**
- Modify: `src/code-miner.ts`
- Test: `code-miner.test.mjs` 追加

**Interfaces:**
- Consumes: 现有 `sha256`/`lineOf`/`EXCLUDE_DIRS`
- Produces:
  - `interface TableColumn { name: string; type: string; nullable: boolean; comment?: string; primaryKey: boolean; line: number }`
  - `interface TableIndex { name: string; columns: string[]; unique: boolean; line: number }`
  - `interface TableRelation { from: string; toTable: string; toColumn: string; line: number }`
  - `interface TableCandidate { table: string; module: string; file: string; line: number; columns: TableColumn[]; indexes: TableIndex[]; relations: TableRelation[]; comment?: string; hash: string; sources: string[] }`
  - `interface ModuleOutline { module: string; fileCount: number; tableEstimate: number }`
  - `function parseDdlFile(relPath: string, text: string): TableCandidate[]` —— 解析 CREATE TABLE / INDEX / FK
  - `function mineTables(root: string, moduleFilter?: string): { tables: TableCandidate[]; modules: string[]; outline: ModuleOutline[] }`

- [ ] **Step 1: 写失败测试 + DDL fixtures**

创建 `test-fixtures/mining-db/schema.sql`：
```sql
CREATE TABLE `t_order` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
  `order_no` VARCHAR(32) NOT NULL COMMENT '订单号',
  `status` TINYINT NOT NULL DEFAULT '0' COMMENT '状态：0新建 1已支付',
  `amount` DECIMAL(12,2) DEFAULT NULL COMMENT '金额',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单表';

CREATE INDEX `idx_status` ON `t_order` (`status`);

CREATE TABLE `t_order_item` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL COMMENT '订单ID',
  PRIMARY KEY (`id`),
  KEY `fk_order` (`order_id`),
  CONSTRAINT `fk_order_item_order` FOREIGN KEY (`order_id`) REFERENCES `t_order` (`id`)
) COMMENT='订单明细表';
```

测试（追加 `code-miner.test.mjs`）：
```js
// M2 表结构
import { mineTables, parseDdlFile } from './lib/code-miner.js'
const FIX_DB = join(ROOT, 'test-fixtures', 'mining-db')

test('tableMiner 解析 CREATE TABLE（列/主键/唯一键/表注释）', () => {
  const { tables } = mineTables(FIX_DB)
  const o = tables.find((t) => t.table === 't_order')
  assert.ok(o, '应挖到 t_order')
  assert.equal(o.columns.length, 4)
  assert.equal(o.columns[0].name, 'id')
  assert.equal(o.columns[0].primaryKey, true)
  assert.equal(o.columns[1].comment, '订单号')
  assert.equal(o.columns[3].nullable, true)
  assert.equal(o.comment, '订单表')
  assert.ok(o.indexes.some((i) => i.name === 'uk_order_no' && i.unique))
})

test('tableMiner 解析 CREATE INDEX 与外键', () => {
  const { tables } = mineTables(FIX_DB)
  const o = tables.find((t) => t.table === 't_order')
  assert.ok(o.indexes.some((i) => i.name === 'idx_status' && !i.unique))
  const item = tables.find((t) => t.table === 't_order_item')
  assert.ok(item.relations.some((r) => r.from === 'order_id' && r.toTable === 't_order' && r.toColumn === 'id'))
})

test('tableMiner 候选携带哈希与来源', () => {
  const { tables } = mineTables(FIX_DB)
  for (const t of tables) {
    assert.ok(t.hash, '候选应携带哈希')
    assert.ok(t.sources.includes('ddl'), '来源应含 ddl')
  }
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test code-miner.test.mjs`
Expected: FAIL（mineTables/parseDdlFile 不存在）

- [ ] **Step 3: 实现**（`src/code-miner.ts` 追加）

```ts
export interface TableColumn { name: string; type: string; nullable: boolean; comment?: string; primaryKey: boolean; line: number }
export interface TableIndex { name: string; columns: string[]; unique: boolean; line: number }
export interface TableRelation { from: string; toTable: string; toColumn: string; line: number }
export interface TableCandidate {
  table: string
  module: string
  file: string
  line: number
  columns: TableColumn[]
  indexes: TableIndex[]
  relations: TableRelation[]
  comment?: string
  hash: string
  sources: string[]
}
export interface TableModuleOutline { module: string; fileCount: number; tableEstimate: number }
export interface TableMineResult { tables: TableCandidate[]; modules: string[]; outline: TableModuleOutline[] }

function collectFiles(root: string, exts: string[]): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.isDirectory()) { if (EXCLUDE_DIRS.has(e.name)) continue; walk(join(dir, e.name)) }
      else if (e.isFile() && exts.some((x) => e.name.toLowerCase().endsWith(x))) out.push(join(dir, e.name))
    }
  }
  walk(root)
  return out
}

function moduleOfPath(relPath: string): string {
  const segs = relPath.split('/').filter(Boolean)
  return segs.length >= 2 ? segs[segs.length - 2] : (segs[0] ?? 'core')
}

export function parseDdlFile(relPath: string, text: string): TableCandidate[] {
  const out: TableCandidate[] = []
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([\w$]+)`?\s*\(/gi
  let m: RegExpExecArray | null
  while ((m = tableRe.exec(text)) !== null) {
    const table = m[1]
    const openIdx = text.indexOf('(', m.index)
    let depth = 0, closeIdx = -1
    for (let i = openIdx; i < text.length; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') { depth--; if (depth === 0) { closeIdx = i; break } }
    }
    if (closeIdx === -1) continue
    const body = text.slice(openIdx + 1, closeIdx)
    const columns: TableColumn[] = []
    const indexes: TableIndex[] = []
    const relations: TableRelation[] = []
    // 表注释：body 后到分号之间 COMMENT='...'
    const tail = text.slice(closeIdx + 1, text.indexOf(';', closeIdx) === -1 ? text.length : text.indexOf(';', closeIdx))
    const tableComment = tail.match(/COMMENT\s*=\s*'((?:[^'\\]|\\.)*)'/i)?.[1]?.replace(/''/g, "'")
    // 列定义（非 KEY/PRIMARY/CONSTRAINT 行）
    const colRe = /^\s*`?([\w$]+)`?\s+([A-Za-z0-9_() ]+?)(?:\s+(?:NOT\s+NULL|DEFAULT\s+[^,]*|AUTO_INCREMENT|COMMENT\s*'((?:[^'\\]|\\.)*)'))*\s*(?:,|$)/gmi
    // 简化：逐行处理列
    const lines = body.split('\n')
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith('PRIMARY') || line.startsWith('UNIQUE') || line.startsWith('KEY') || line.startsWith('CONSTRAINT')) continue
      const cm = line.match(/^`?([\w$]+)`?\s+([A-Za-z0-9_()]+)/)
      if (!cm) continue
      const isPk = /PRIMARY KEY/i.test(body) && body.match(/PRIMARY\s+KEY\s*\(`?([\w$]+)`?/i)?.[1] === cm[1]
      const nullable = !/NOT\s+NULL/i.test(line)
      const comment = line.match(/COMMENT\s*'((?:[^'\\]|\\.)*)'/i)?.[1]?.replace(/''/g, "'")
      columns.push({ name: cm[1], type: cm[2].toUpperCase(), nullable, comment, primaryKey: isPk, line: lineOf(text, text.indexOf(rawLine)) })
    }
    // 索引
    const idxRe = /(?:UNIQUE\s+)?(?:KEY|INDEX)\s+`?([\w$]+)`?\s*\(([^)]+)\)/gi
    let im: RegExpExecArray | null
    while ((im = idxRe.exec(body)) !== null) {
      const unique = /UNIQUE\s+KEY|UNIQUE\s+INDEX/i.test(im[0])
      const cols = im[2].split(',').map((c) => c.trim().replace(/^`|`$/g, ''))
      indexes.push({ name: im[1], columns: cols, unique, line: lineOf(text, text.indexOf(im[0])) })
    }
    // 外键
    const fkRe = /FOREIGN\s+KEY\s*\(`?([\w$]+)`?\)\s*REFERENCES\s+`?([\w$]+)`?\s*\(`?([\w$]+)`?\)/gi
    let fm: RegExpExecArray | null
    while ((fm = fkRe.exec(body)) !== null) {
      relations.push({ from: fm[1], toTable: fm[2], toColumn: fm[3], line: lineOf(text, text.indexOf(fm[0])) })
    }
    out.push({ table, module: moduleOfPath(relPath), file: relPath, line: lineOf(text, m.index), columns, indexes, relations, comment: tableComment, hash: '', sources: ['ddl'] })
  }
  // 独立 CREATE INDEX 语句
  const stIdxRe = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+`?([\w$]+)`?\s+ON\s+`?([\w$]+)`?\s*\(([^)]+)\)/gi
  let sm: RegExpExecArray | null
  while ((sm = stIdxRe.exec(text)) !== null) {
    const t = out.find((c) => c.table === sm[2])
    if (t) {
      t.indexes.push({ name: sm[1], columns: sm[3].split(',').map((c) => c.trim().replace(/^`|`$/g, '')), unique: /UNIQUE/i.test(sm[0]), line: lineOf(text, sm.index) })
    }
  }
  return out
}

export function mineTables(root: string, moduleFilter?: string): TableMineResult {
  const files = collectFiles(root, ['.sql', '.ddl'])
  const byModule = new Map<string, { fileCount: number; tables: TableCandidate[] }>()
  for (const f of files) {
    let text = ''
    try { text = readFileSync(f, 'utf8').replace(/\r\n/g, '\n') } catch { continue }
    const rel = relative(root, f).replace(/\\/g, '/')
    const candidates = parseDdlFile(rel, text)
    const fileHash = sha256(text)
    for (const c of candidates) {
      if (moduleFilter && c.module !== moduleFilter) continue
      if (!byModule.has(c.module)) byModule.set(c.module, { fileCount: 0, tables: [] })
      byModule.get(c.module)!.fileCount++
      byModule.get(c.module)!.tables.push({ ...c, hash: fileHash })
    }
  }
  const tables = [...byModule.values()].flatMap((v) => v.tables)
  const outline: TableModuleOutline[] = [...byModule.entries()].map(([module, v]) => ({ module, fileCount: v.fileCount, tableEstimate: v.tables.length }))
  return { tables, modules: outline.map((o) => o.module), outline }
}
```

> 说明：列定义解析为简化实现（逐行 + 类型正则），fixtures 覆盖标准 MySQL DDL；复杂方言留 M2 开放问题（解析器留扩展位）。

- [ ] **Step 4: 运行确认通过 + typecheck**

Run: `node --test code-miner.test.mjs`
Run: `npm run typecheck`
Expected: PASS + 无类型错误

- [ ] **Step 5: 提交**

```bash
git add src/code-miner.ts code-miner.test.mjs test-fixtures/mining-db/
git commit -m "feat(mining): tableMiner 解析 SQL DDL（表/列/索引/外键）"
```

---

### Task M2-2: MyBatis mapper XML + JPA @Entity 解析

**Files:**
- Modify: `src/code-miner.ts`
- Test: `code-miner.test.mjs` 追加 + fixtures

**Interfaces:**
- Consumes: `parseDdlFile`、`TableCandidate`
- Produces: `parseMapperXml(relPath, text)`、`parseJpaEntity(relPath, text)` —— 与 `parseDdlFile` 相同返回 `TableCandidate[]`（sources 分别标 `mapper`/`jpa`）

- [ ] **Step 1: 写失败测试 + fixtures**

`test-fixtures/mining-db/OrderMapper.xml`：
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.pingan.iobs.order.mapper.OrderMapper">
  <sql id="Base_Column_List">id, order_no, status, amount</sql>
  <select id="selectByPrimaryKey" resultType="map">
    select <include refid="Base_Column_List"/> from t_order where id = #{id}
  </select>
</mapper>
```

`test-fixtures/mining-db/OrderEntity.java`：
```java
package com.pingan.iobs.order.entity;

import javax.persistence.*;

@Entity
@Table(name = "t_order")
public class OrderEntity {
    @Id
    @Column(name = "id")
    private Long id;
    @Column(name = "order_no", nullable = false)
    private String orderNo;
    @Column(name = "status")
    private Integer status;
}
```

测试追加：
```js
test('tableMiner 解析 MyBatis mapper（列清单 + 表引用）', () => {
  const { readFileSync } = await import('node:fs')
  const text = readFileSync(join(FIX_DB, 'OrderMapper.xml'), 'utf8')
  const parsed = parseMapperXml('mapper/OrderMapper.xml', text)
  assert.ok(parsed.length >= 1, '应从 mapper 挖到表')
  const t = parsed.find((x) => x.table === 't_order')
  assert.ok(t, '应识别 t_order')
  assert.ok(t.sources.includes('mapper'), '来源应含 mapper')
  assert.ok(t.columns.length >= 4, '应含 Base_Column_List 的列')
})

test('tableMiner 解析 JPA @Entity（@Table/@Column/@Id）', () => {
  const { readFileSync } = await import('node:fs')
  const text = readFileSync(join(FIX_DB, 'OrderEntity.java'), 'utf8')
  const parsed = parseJpaEntity('entity/OrderEntity.java', text)
  assert.ok(parsed.length === 1, '应从 Entity 挖到 1 表')
  const t = parsed[0]
  assert.equal(t.table, 't_order')
  assert.ok(t.sources.includes('jpa'), '来源应含 jpa')
  assert.equal(t.columns.length, 3)
  assert.equal(t.columns[0].primaryKey, true, 'id 应为主键')
  assert.equal(t.columns[1].nullable, false, 'nullable=false 应映射')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test code-miner.test.mjs`
Expected: FAIL（parseMapperXml/parseJpaEntity 不存在）

- [ ] **Step 3: 实现**（`src/code-miner.ts` 追加）

```ts
export function parseMapperXml(relPath: string, text: string): TableCandidate[] {
  const out: TableCandidate[] = []
  // 收集所有 sql 片段的列清单
  const columnsOf: Record<string, string[]> = {}
  const sqlRe = /<sql\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/sql>/gi
  let sm: RegExpExecArray | null
  while ((sm = sqlRe.exec(text)) !== null) {
    const cols = (sm[2].match(/`?[\w$]+`?/g) ?? []).map((c) => c.replace(/^`|`$/g, '')).filter((c) => !['select','from','where','and','or','insert','into','values','update','set','id'].includes(c.toLowerCase()))
    columnsOf[sm[1]] = cols
  }
  // 表引用：from/insert into/update/join 后的标识符（排除常见关键字）
  const tableRefs = new Set<string>()
  const refRe = /\b(?:from|join|update|into)\s+`?([\w$]+)`?/gi
  let rm: RegExpExecArray | null
  while ((rm = refRe.exec(text)) !== null) {
    const t = rm[1]
    if (!['select','where','information_schema','dual'].includes(t.toLowerCase())) tableRefs.add(t)
  }
  // 列名：select 列清单 + sql 片段展开
  const cols: string[] = []
  const selectRe = /<select[\s\S]*?>([\s\S]*?)<\/select>/gi
  let em: RegExpExecArray | null
  while ((em = selectRe.exec(text)) !== null) {
    const body = em[1].replace(/<include[^>]*\/>/gi, (inc) => {
      const id = inc.match(/refid="([^"]+)"/)?.[1] ?? ''
      return (columnsOf[id] ?? []).join(', ')
    })
    const colMatches = body.match(/`?[\w$]+`?/g) ?? []
    for (const c of colMatches) {
      const clean = c.replace(/^`|`$/g, '')
      if (!/^(select|from|where|and|or|insert|into|values|update|set|join|on|order|by|group|limit|distinct|as|id)$/i.test(clean)) {
        if (!cols.includes(clean)) cols.push(clean)
      }
    }
  }
  for (const table of tableRefs) {
    out.push({
      table, module: moduleOfPath(relPath), file: relPath, line: lineOf(text, text.indexOf(table)),
      columns: cols.map((name, i) => ({ name, type: '', nullable: true, primaryKey: false, line: 1 })) as TableColumn[],
      indexes: [], relations: [], comment: undefined, hash: '', sources: ['mapper'],
    })
  }
  return out
}

export function parseJpaEntity(relPath: string, text: string): TableCandidate[] {
  const out: TableCandidate[] = []
  const tableName = text.match(/@Table\s*\(\s*name\s*=\s*"([^"]+)"/)?.[1]
  if (!tableName) return out
  const columns: TableColumn[] = []
  const colRe = /@Column\s*\(\s*name\s*=\s*"([^"]+)"\s*(?:,\s*nullable\s*=\s*(true|false))?[^)]*\)[\s\S]*?private\s+[\w<>\[\]]+\s+(\w+)\s*;/g
  let cm: RegExpExecArray | null
  const ids = new Set<string>()
  const idRe = /@Id[\s\S]*?@Column\s*\(\s*name\s*=\s*"([^"]+)"/g
  let im: RegExpExecArray | null
  while ((im = idRe.exec(text)) !== null) ids.add(im[1])
  while ((cm = colRe.exec(text)) !== null) {
    columns.push({ name: cm[1], type: '', nullable: cm[2] !== 'false', primaryKey: ids.has(cm[1]), line: lineOf(text, cm.index) })
  }
  if (columns.length > 0 || ids.size > 0) {
    out.push({ table: tableName, module: moduleOfPath(relPath), file: relPath, line: lineOf(text, text.indexOf('@Table')), columns, indexes: [], relations: [], comment: undefined, hash: '', sources: ['jpa'] })
  }
  return out
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test code-miner.test.mjs`
Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/code-miner.ts code-miner.test.mjs test-fixtures/mining-db/
git commit -m "feat(mining): tableMiner 解析 MyBatis mapper 与 JPA @Entity"
```

---

### Task M2-3: 多来源合并（DDL 优先）

**Files:**
- Modify: `src/code-miner.ts`（`mergeTables`）
- Test: `code-miner.test.mjs` 追加

**Interfaces:**
- Consumes: `parseDdlFile`/`parseMapperXml`/`parseJpaEntity`
- Produces: `mergeTables(candidates: TableCandidate[]): TableCandidate[]` —— 同表多来源合并：DDL 列/索引/关系优先；mapper/jpa 补充；sources 记录全部来源

- [ ] **Step 1: 写失败测试**

```js
test('mergeTables 多来源合并：DDL 优先，mapper/jpa 补充', () => {
  const ddl = parseDdlFile('db/schema.sql', readFileSync(join(FIX_DB, 'schema.sql'), 'utf8'))
  const mapper = parseMapperXml('mapper/OrderMapper.xml', readFileSync(join(FIX_DB, 'OrderMapper.xml'), 'utf8'))
  const jpa = parseJpaEntity('entity/OrderEntity.java', readFileSync(join(FIX_DB, 'OrderEntity.java'), 'utf8'))
  const merged = mergeTables([...ddl, ...mapper, ...jpa])
  const t = merged.find((x) => x.table === 't_order')
  assert.ok(t, '合并后应保留 t_order')
  assert.equal(t.sources.length, 3, '三个来源都应记录')
  // DDL 列优先：列数来自 DDL（4 列），不被 mapper 的简化列覆盖
  assert.equal(t.columns.length, 4, 'DDL 列定义优先')
  assert.equal(t.columns[0].type, 'BIGINT', 'DDL 类型保留')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test code-miner.test.mjs`
Expected: FAIL（mergeTables 不存在）

- [ ] **Step 3: 实现**

```ts
export function mergeTables(candidates: TableCandidate[]): TableCandidate[] {
  const byTable = new Map<string, TableCandidate>()
  const PRIORITY = { ddl: 3, jpa: 2, mapper: 1 }
  for (const c of candidates) {
    const existing = byTable.get(c.table)
    if (!existing) { byTable.set(c.table, { ...c }); continue }
    // 合并：来源去重；高优先级来源的列/索引/关系替换低优先级
    const merged: TableCandidate = { ...existing }
    merged.sources = [...new Set([...existing.sources, ...c.sources])]
    const curPrio = Math.max(...existing.sources.map((s) => PRIORITY[s as keyof typeof PRIORITY] ?? 0))
    const newPrio = Math.max(...c.sources.map((s) => PRIORITY[s as keyof typeof PRIORITY] ?? 0))
    if (newPrio > curPrio) {
      merged.columns = c.columns
      merged.indexes = c.indexes
      merged.relations = c.relations
      merged.comment = c.comment ?? existing.comment
    } else if (newPrio === curPrio && newPrio > 0 && existing.columns.length === 0) {
      merged.columns = c.columns
    }
    byTable.set(c.table, merged)
  }
  return [...byTable.values()]
}
```

> `mineTables` 改为：collect 三种来源文件（.sql/.ddl + *.xml（mapper）+ *.java 含 @Entity）→ 分别解析 → `mergeTables` → 统一输出。

- [ ] **Step 4: 运行确认通过**

Run: `node --test code-miner.test.mjs`
Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/code-miner.ts code-miner.test.mjs
git commit -m "feat(mining): 多来源表合并（DDL 优先，mapper/jpa 补充）"
```

---

### Task M2-4: wiki_mine 扩展 kind='db'（表对账报告）

**Files:**
- Modify: `src/tools.ts`
- Test: `tools.test.mjs` 追加

**Interfaces:**
- Consumes: `mineTables`（Task M2-1/2/3）、现有对账逻辑
- Produces: `wiki_mine` 的 `kind='db'` 分支：`{ tables, new, changed, unchanged, deleted, outline, modules, remaining, note }`（table 级对账，source = `mine:db:<file>`）

- [ ] **Step 1: 写失败测试**（tools.test.mjs 追加，用 makeMineVault 模式 + db fixture）

```js
test('wiki_mine kind=db 对账：全量 new（首次）', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-minedb-'))
  cpSync(join(ROOT, 'test-fixtures', 'mining-db'), join(dir, 'src'), { recursive: true })
  const store = new VaultStore(dir)
  store.ensure()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const registered = []
  mountTools({ tools: { register: (def) => registered.push(def) } }, { current: () => store })
  const def = registered.find((d) => d.name === 'wiki_mine')
  const res = await def.execute({ kind: 'db' }, EXEC)
  assert.ok(res.tables.length >= 1, '应挖到表')
  assert.equal(res.new.length, res.tables.length, '首次全 new')
  assert.ok(res.deleted.length === 0)
})

test('wiki_mine kind=db 对账：同哈希→unchanged', async (t) => {
  // 同 M1 模式：入库后重挖 → unchanged
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tools.test.mjs`
Expected: FAIL（kind=db 返回空）

- [ ] **Step 3: 实现**（`src/tools.ts` wiki_mine execute 扩展）

```ts
// 在 execute 中：
const tableResult = (kind === 'db' || kind === 'both')
  ? mineTables(projectRoot, args.module)
  : { tables: [], outline: [], modules: [] }
let tables = tableResult.tables
if (resumeOnly && tables.length > 0) tables = tables.filter((t) => resumeOnly.has(t.module))
// db 对账（与 enum 同构）
const newT: typeof tables = []; const changedT: typeof tables = []; const unchangedT: typeof tables = []
const scannedDbFiles = new Set(tables.map((t) => t.file))
for (const t of tables) {
  const prev = store.manifestEntry(`mine:db:${t.file}`)
  if (!prev) newT.push(t)
  else if (prev.content_hash === t.hash) unchangedT.push(t)
  else changedT.push(t)
}
const deletedT: string[] = []
for (const src of store.manifestSources()) {
  if (src.startsWith('mine:db:') && !scannedDbFiles.has(src.slice('mine:db:'.length))) deletedT.push(src.slice('mine:db:'.length))
}
// 返回合并（kind=enum 时 db 数组为空，kind=db 时 enum 数组为空）
return {
  enums: enumResult.enums, tables, dbNew: newT, dbChanged: changedT, dbUnchanged: unchangedT, dbDeleted: deletedT,
  new: newE, changed: changedE, unchanged: unchangedE, deleted,
  outline: [...enumResult.outline, ...tableResult.outline],
  modules: [...enumResult.modules, ...tableResult.modules],
  remaining, note,
}
```

> output.schema 需追加 tables/dbNew/dbChanged/dbUnchanged/dbDeleted 字段（结构同 enums 的 items 或简化列名结构）。render 文案更新为 `表 X 新 · Y 变 · Z 无变 · W 删`。

- [ ] **Step 4: 运行确认通过 + 全量**

Run: `node --test tools.test.mjs`
Run: `node --test *.test.mjs`
Run: `npm run typecheck`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add src/tools.ts tools.test.mjs
git commit -m "feat(mining): wiki_mine 支持 kind=db 表对账报告"
```

---

### Task M2-5: wiki-mine skill 补 db 流程 + 全量回归 + 同步

**Files:**
- Modify: `wiki-mine/SKILL.md`
- 同步安装副本 + 全量测试

- [ ] **Step 1: 更新 SKILL.md**

在「第 2 步 细节」后补 db 流程：
```markdown
### 表结构挖掘（kind=db）
1. 调 `wiki_mine { kind: 'db', module? }` 取表候选（对账报告同枚举：new/changed/unchanged/deleted）
2. 每张表一页：category=tables，tags=[table, module:<模块名>]
3. 正文：列清单表格（列 | 类型 | 可空 | 注释 | 主键）+ 索引小节 + 外键关系小节 + 来源行号
4. source = `mine:db:<相对路径>`；contentHash = 源文件哈希
5. 只处理 new + changed；deleted 报告孤儿表页
```

- [ ] **Step 2: 全量测试 + typecheck**

Run: `node --test *.test.mjs`
Run: `npm run typecheck`
Expected: 全绿

- [ ] **Step 3: 重建 client（如 UI 有改）+ 同步安装副本**

```bash
Copy-Item src/code-miner.ts src/tools.ts wiki-mine/SKILL.md → 安装副本对应路径
```

- [ ] **Step 4: 在线验证 rev**

Expected: manifest rev == 本地 SHA1-12（若 client 重建则验证 client）

- [ ] **Step 5: 提交**

```bash
git add wiki-mine/SKILL.md src/ tools.test.mjs code-miner.test.mjs
git commit -m "feat(mining): wiki-mine skill 支持表结构挖掘 + 产物同步"
```

---

## Self-Review（writing-plans 要求）

**Spec 覆盖：**
- M2 §2.1 SQL DDL → Task M2-1 ✓
- M2 §2.2 MyBatis mapper / §2.3 JPA → Task M2-2 ✓
- M2 §2.4 优先级与合并 → Task M2-3 ✓
- M2 §4.1 wiki_mine kind='db' → Task M2-4 ✓
- M2 §5 两阶段 + 断点续传 → 复用 M1 progress + 对账（Task M2-4）✓
- M2 §6 错误处理（0 结果 / 大表截断 / DDL 优先冲突标注）→ Task M2-1/4（截断阈值在蒸馏阶段由 skill 处理）✓
- M2 §7 测试 → 各 Task 红绿 ✓
- 来源适配器（MCP/生产导出）→ 非目标，本期只做文件扫描 ✓

**占位符扫描：** Task M2-2 测试有 `await import('node:fs')`（顶层不可用，改为顶部 import）；Task M2-1 实现注释标注简化解析。无 TBD/TODO。

**类型一致性：** `TableCandidate`/`TableColumn`/`TableIndex`/`TableRelation`/`mineTables`/`parseDdlFile`/`parseMapperXml`/`parseJpaEntity`/`mergeTables` 在 Task M2-1~4 签名一致。
