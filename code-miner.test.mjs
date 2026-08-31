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
