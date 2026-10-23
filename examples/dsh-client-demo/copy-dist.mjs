// copy-dist.mjs — 把 client/dist 同步到插件包内的 client-dist/（打包白名单只含后者）
// 用 Node 而不是 PowerShell Copy-Item：避免执行策略/编码差异，跨平台一致。
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, 'client', 'dist')
const dest = resolve(here, 'client-dist')

if (!existsSync(src)) {
  console.error('client/dist 不存在：先在 client/ 里跑 npm install && npm run build')
  process.exit(1)
}
rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true })
console.log(`已同步 ${src} -> ${dest}`)
