// code-miner.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mineEnums, parseJavaFile } from './lib/code-miner.js'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const FIX = join(ROOT, 'test-fixtures', 'mining')

test('enumMiner 解析带码值枚举', () => {
  const { enums } = mineEnums(FIX)
  const st = enums.find((e) => e.name === 'OrderStatus')
  assert.ok(st, '应挖到 OrderStatus')
  assert.equal(st.module, 'order')
  assert.equal(st.values.length, 4)
  assert.equal(st.values[0].name, 'CREATED')
  assert.equal(st.values[0].code, '01')
  assert.equal(st.values[0].label, '已创建')
  assert.ok(st.hash, '候选应携带源文件哈希')
})

test('enumMiner 解析常量类（相邻注释为 label）', () => {
  const { enums } = mineEnums(FIX)
  const pc = enums.find((e) => e.name === 'PaymentConstants')
  assert.ok(pc, '应挖到 PaymentConstants')
  assert.equal(pc.kind, 'constants')
  assert.equal(pc.module, 'pay')
  assert.equal(pc.values.length, 2)
  assert.equal(pc.values[0].name, 'CHANNEL_WECHAT')
  assert.equal(pc.values[0].code, 'WX')
  assert.equal(pc.values[0].label, '支付渠道：微信')
})

test('enumMiner 无值枚举名称即值', () => {
  const { enums } = mineEnums(FIX)
  const sf = enums.find((e) => e.name === 'SimpleFlag')
  assert.ok(sf, '应挖到 SimpleFlag')
  assert.equal(sf.values.length, 3)
  assert.equal(sf.values[0].name, 'A')
  assert.equal(sf.values[0].code, undefined)
})

test('outline 输出模块清单与预估', () => {
  const { outline } = mineEnums(FIX)
  const order = outline.find((m) => m.module === 'order')
  assert.ok(order, 'outline 应含 order 模块')
  assert.equal(order.enumEstimate, 1)
})

test('排除 .svn 目录', () => {
  const { enums } = mineEnums(join(FIX, 'svn-scenario'))
  assert.ok(!enums.some((e) => e.file.includes('.svn')), '不应扫描 .svn 目录')
})

test('moduleFilter 只返回指定模块', () => {
  const { enums, modules } = mineEnums(FIX, 'pay')
  assert.ok(modules.length === 1 && modules[0] === 'pay', '只应含 pay 模块')
  assert.ok(enums.every((e) => e.module === 'pay'), '候选全部属于 pay')
})

test('parseJavaFile 行号定位', () => {
  const text = readFileSync(join(FIX, 'OrderEnum.java'), 'utf8').replace(/\r\n/g, '\n')
  const parsed = parseJavaFile('OrderEnum.java', text)
  const st = parsed.find((e) => e.name === 'OrderStatus')
  assert.ok(st, '应解析到 OrderStatus')
  assert.equal(st.line, 6, 'enum 声明行')
  assert.equal(st.values[0].line, 7, '第一个值行')
})

// ==================== M2 表结构挖掘 ====================
import { mineTables, parseDdlFile, parseMapperXml, parseJpaEntity, mergeTables } from './lib/code-miner.js'
const FIX_DB = join(ROOT, 'test-fixtures', 'mining-db')

test('M2 tableMiner 解析 CREATE TABLE（列/主键/唯一键/表注释）', () => {
  const { tables } = mineTables(FIX_DB)
  const o = tables.find((t) => t.table === 't_order')
  assert.ok(o, '应挖到 t_order')
  assert.equal(o.columns.length, 4)
  assert.equal(o.columns[0].name, 'id')
  assert.equal(o.columns[0].primaryKey, true)
  assert.equal(o.columns[0].type, 'BIGINT')
  assert.equal(o.columns[1].comment, '订单号')
  assert.equal(o.columns[3].nullable, true)
  assert.equal(o.comment, '订单表')
  assert.ok(o.indexes.some((i) => i.name === 'uk_order_no' && i.unique))
})

test('M2 tableMiner 解析 CREATE INDEX 与外键', () => {
  const { tables } = mineTables(FIX_DB)
  const o = tables.find((t) => t.table === 't_order')
  assert.ok(o.indexes.some((i) => i.name === 'idx_status' && !i.unique), '独立 CREATE INDEX 应并入')
  const item = tables.find((t) => t.table === 't_order_item')
  assert.ok(item, '应挖到 t_order_item')
  assert.ok(item.relations.some((r) => r.from === 'order_id' && r.toTable === 't_order' && r.toColumn === 'id'))
})

test('M2 tableMiner 候选携带哈希与来源', () => {
  const { tables } = mineTables(FIX_DB)
  for (const t of tables) {
    assert.ok(t.hash, '候选应携带哈希')
    assert.ok(t.sources.includes('ddl'), '来源应含 ddl')
  }
})

test('M2 parseMapperXml 解析列清单与表引用', () => {
  const text = readFileSync(join(FIX_DB, 'OrderMapper.xml'), 'utf8')
  const parsed = parseMapperXml('mapper/OrderMapper.xml', text)
  assert.ok(parsed.length >= 1, '应从 mapper 挖到表')
  const t = parsed.find((x) => x.table === 't_order')
  assert.ok(t, '应识别 t_order')
  assert.ok(t.sources.includes('mapper'), '来源应含 mapper')
  assert.ok(t.columns.length >= 4, '应含 Base_Column_List 的列')
})

test('M2 parseJpaEntity 解析 @Table/@Column/@Id', () => {
  const text = readFileSync(join(FIX_DB, 'OrderEntity.java'), 'utf8')
  const parsed = parseJpaEntity('entity/OrderEntity.java', text)
  assert.equal(parsed.length, 1, '应从 Entity 挖到 1 表')
  const t = parsed[0]
  assert.equal(t.table, 't_order')
  assert.ok(t.sources.includes('jpa'), '来源应含 jpa')
  assert.equal(t.columns.length, 3)
  assert.equal(t.columns[0].primaryKey, true, 'id 应为主键')
  assert.equal(t.columns[1].nullable, false, 'nullable=false 应映射')
})

test('M2 mergeTables 多来源合并：DDL 优先', () => {
  const ddl = parseDdlFile('db/schema.sql', readFileSync(join(FIX_DB, 'schema.sql'), 'utf8'))
  const mapper = parseMapperXml('mapper/OrderMapper.xml', readFileSync(join(FIX_DB, 'OrderMapper.xml'), 'utf8'))
  const jpa = parseJpaEntity('entity/OrderEntity.java', readFileSync(join(FIX_DB, 'OrderEntity.java'), 'utf8'))
  const merged = mergeTables([...ddl, ...mapper, ...jpa])
  const t = merged.find((x) => x.table === 't_order')
  assert.ok(t, '合并后应保留 t_order')
  assert.equal(t.sources.length, 3, '三个来源都应记录')
  assert.equal(t.columns.length, 4, 'DDL 列定义优先')
  assert.equal(t.columns[0].type, 'BIGINT', 'DDL 类型保留')
})
