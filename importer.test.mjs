// importer.test.mjs — md 路径导入（先红后绿）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultStore } from './lib/vault-store.js'
import { importPath } from './lib/importer.js'

function makeSrcDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-obsidian-src-'))
}
function makeVault() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-obsidian-imp-'))
  const store = new VaultStore(dir)
  store.ensure()
  return { dir, store }
}
const PAGE = (over = {}) => ({ tags: [], source: 't', confidence: 'extracted', created: '2026-08-26T00:00:00.000Z', updated: '2026-08-26T00:00:00.000Z', id: 'x', title: 'X', category: 'references', body: 'b', ...over })

test('单文件无 frontmatter：自动补全（id=文件名净化、title=首个标题、category=参数、source=import:路径）', () => {
  const src = makeSrcDir()
  const { dir, store } = makeVault()
  try {
    writeFileSync(join(src, 'my-note.md'), '# 我的笔记\n\n正文第一段。\n', 'utf8')
    const r = importPath(store, join(src, 'my-note.md'), 'references')
    assert.equal(r.imported, 1)
    const p = store.readPage('my-note', 'references')
    assert.ok(p, '应入 references')
    assert.equal(p.title, '我的笔记')
    assert.equal(p.body, '正文第一段。')
    assert.ok(p.source.startsWith('import:'), 'source 标记 import:')
  } finally { rmSync(src, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }) }
})

test('目录递归：收集嵌套 md，排除 node_modules/.git/target；源文件只读不变', () => {
  const src = makeSrcDir()
  const { dir, store } = makeVault()
  try {
    writeFileSync(join(src, 'a.md'), 'A 正文', 'utf8')
    mkdirSync(join(src, 'sub'))
    writeFileSync(join(src, 'sub', 'b.md'), 'B 正文', 'utf8')
    mkdirSync(join(src, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(src, 'node_modules', 'pkg', 'skip.md'), '不应导入', 'utf8')
    const before = readFileSync(join(src, 'a.md'), 'utf8')
    const r = importPath(store, src, 'references')
    assert.equal(r.imported, 2, JSON.stringify(r.files))
    assert.ok(!r.files.some((f) => f.id?.includes('skip')), '排除 node_modules')
    assert.equal(readFileSync(join(src, 'a.md'), 'utf8'), before, '源文件不变')
    assert.ok(store.readPage('a', 'references') && store.readPage('b', 'references'))
  } finally { rmSync(src, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }) }
})

test('已有合法 frontmatter：按声明的 id/category 原样入库', () => {
  const src = makeSrcDir()
  const { dir, store } = makeVault()
  try {
    const fm = ['---', 'id: existing-page', 'title: 已有页', 'category: concepts', 'tags: [keep]', 'source: orig', 'confidence: extracted', 'created: 2026-01-01', 'updated: 2026-01-01', '---', '', '原有正文', ''].join('\n')
    writeFileSync(join(src, 'whatever-name.md'), fm, 'utf8')
    const r = importPath(store, src, 'references')
    assert.equal(r.imported, 1)
    const p = store.readPage('existing-page', 'concepts')
    assert.ok(p, '按声明 category 入库')
    assert.equal(p.source, 'orig', '保留原 source')
    assert.equal(p.tags[0], 'keep')
  } finally { rmSync(src, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }) }
})

test('id 冲突：已有同名页时新文件加 -2 后缀，不覆盖', () => {
  const src = makeSrcDir()
  const { dir, store } = makeVault()
  try {
    store.writePage(PAGE({ id: 'a', title: '库内原页', body: '原内容' }))
    writeFileSync(join(src, 'a.md'), '新内容', 'utf8')
    const r = importPath(store, src, 'references')
    assert.equal(r.imported, 1)
    const orig = store.readPage('a', 'references')
    assert.equal(orig.body, '原内容', '原页不被覆盖')
    const dup = store.readPage('a-2', 'references')
    assert.ok(dup, '新页用 a-2')
    assert.equal(dup.body, '新内容')
    assert.ok(r.files.find((f) => f.id === 'a-2' && f.renamed), '结果注明改名')
  } finally { rmSync(src, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }) }
})

test('幂等：未修改重导 → skipped，磁盘不变；修改后重导 → updated', () => {
  const src = makeSrcDir()
  const { dir, store } = makeVault()
  try {
    writeFileSync(join(src, 'same.md'), '初始内容', 'utf8')
    importPath(store, src, 'references')
    const diskBefore = readFileSync(join(dir, '.wiki', 'references', 'same.md'), 'utf8')
    const r2 = importPath(store, src, 'references')
    assert.equal(r2.skipped, 1, '重导跳过')
    assert.equal(r2.imported, 0)
    assert.equal(readFileSync(join(dir, '.wiki', 'references', 'same.md'), 'utf8'), diskBefore, '磁盘未变')

    writeFileSync(join(src, 'same.md'), '改过的内容', 'utf8')
    const r3 = importPath(store, src, 'references')
    assert.equal(r3.updated, 1, '内容变化按更新处理')
    assert.equal(store.readPage('same', 'references').body, '改过的内容')
  } finally { rmSync(src, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }) }
})

test('超限拒绝：单文件 >1MB 或总数 >500 → 整体失败，无部分写入', () => {
  const src = makeSrcDir()
  const { dir, store } = makeVault()
  try {
    writeFileSync(join(src, 'big.md'), 'x'.repeat(1024 * 1024 + 10), 'utf8')
    assert.throws(() => importPath(store, src, 'references'), /超过|1MB|limit/i, '超 1MB 报错')
    writeFileSync(join(src, 'big.md'), 'x'.repeat(100), 'utf8')
    // 造 501 个小文件
    for (let i = 0; i < 501; i++) writeFileSync(join(src, `f${i}.md`), `内容${i}`, 'utf8')
    assert.throws(() => importPath(store, src, 'references'), /500|超过|limit/i, '超数量报错')
    // 无部分写入：库里没有任何 f*.md
    assert.ok(!store.readPage('f0', 'references') && !store.readPage('big', 'references'), '无部分写入')
  } finally { rmSync(src, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }) }
})

test('非法路径：不存在的路径 → 报错不崩', () => {
  const { dir, store } = makeVault()
  try {
    assert.throws(() => importPath(store, join(dir, 'no-such-path'), 'references'), /不存在|not found|ENOENT/i)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
