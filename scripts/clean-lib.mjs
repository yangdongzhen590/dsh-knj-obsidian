#!/usr/bin/env node
/**
 * 清空 tsc 产物目录 lib/ 后再编译。
 *
 * tsc 只覆盖同名输出、不删除已移除模块的旧 .js —— 2026.11.15 的发布包里
 * 就残留过已回滚的 lib/subvault.js。因此 build 的第一步必须整体清空 lib/。
 * client/ 是 tsdown 的独立产物（build:client），不在此清理。
 *
 * 用法：node scripts/clean-lib.mjs [repoRoot]
 *   repoRoot 缺省为本脚本所在仓库根；测试可传临时目录验证清理边界。
 */
import { rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(process.argv[2] ?? join(here, '..'))
rmSync(join(root, 'lib'), { recursive: true, force: true })
