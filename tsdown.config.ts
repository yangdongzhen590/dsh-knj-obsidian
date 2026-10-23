/**
 * Browser client bundle for the dsh-knj-obsidian plugin, mirroring the
 * DeepSeek Harness client preset: a closure-factory artifact that calls
 * window.__ModuleLoader__.load({ id, factory }) and resolves externals
 * through the injected require (loader module table).
 */
import { defineConfig } from 'tsdown'

const id = 'dsh-knj-obsidian'

/**
 * Externals resolved from the loader module table at runtime.
 *
 * 只有 React 三件套:0.2 起插件的宿主能力(原生右侧栏的 slots / sidebarRightTabs /
 * sidebarRight)都是运行时从 ctx 注入的服务,不再需要从 loader 表 require 宿主包。
 * 历史上这里还留着 @deepseek-ai/dsh-client-ui-primitives、@deepseek-ai/dsh-client-runtime
 * 与 dsh-better-sidebar —— 前两者属我未使用的 client 包(dsh-client-runtime 在 0.2 已不存在),
 * 后者已在 2026-10-22 卸载,一并清掉;清掉后产物的 require 仍只有 react 三者(实测一致)。
 */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom']

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    // Externals resolved from the loader module table at runtime.
    neverBundle: [...CLIENT_EXTERNALS],
    // Everything else inlines — a require() the loader table cannot answer
    // would be a guaranteed runtime throw.
    alwaysBundle: (source: string) => (CLIENT_EXTERNALS.includes(source) ? undefined : true),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
