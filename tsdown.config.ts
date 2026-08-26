/**
 * Browser client bundle for the dsh-knj-obsidian plugin, mirroring the
 * DeepSeek Harness client preset: a closure-factory artifact that calls
 * window.__ModuleLoader__.load({ id, factory }) and resolves externals
 * through the injected require (loader module table).
 */
import { defineConfig } from 'tsdown'

const id = 'dsh-knj-obsidian'

/** Externals resolved from the loader module table at runtime. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime',
  'dsh-better-sidebar',
]

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
