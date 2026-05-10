import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// https://github.com/vdesjs/vite-plugin-monaco-editor/issues/21#issuecomment-1827562674
import monacoEditorPluginModule from 'vite-plugin-monaco-editor'
const isObjectWithDefaultFunction = (
  module: unknown
): module is { default: typeof monacoEditorPluginModule } =>
  module != null &&
  typeof module === 'object' &&
  'default' in module &&
  typeof module.default === 'function'
const monacoEditorPlugin = isObjectWithDefaultFunction(monacoEditorPluginModule)
  ? monacoEditorPluginModule.default
  : monacoEditorPluginModule

// Win7 build: bundle all deps (Vite converts ESM→CJS), only externalize native modules
const isLegacyBuild = process.env.LEGACY_BUILD === 'true'
const legacyExternal = ['sysproxy-rs', 'electron', 'utf-8-validate', 'bufferutil']
const isProduction =
  process.env.NODE_ENV === 'production' || process.env.npm_lifecycle_event?.startsWith('build')

function rendererManualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined

  const normalizedId = id.replace(/\\/g, '/')

  if (
    /node_modules\/(monaco-editor|monaco-yaml|react-monaco-editor|meta-json-schema|types-pac)\//.test(
      normalizedId
    )
  ) {
    return 'editor'
  }

  if (/node_modules\/(chart\.js|react-chartjs-2)\//.test(normalizedId)) {
    return 'charts'
  }

  if (
    /node_modules\/(react-markdown|remark-|rehype-|unified|micromark|mdast-|hast-|property-information|space-separated-tokens|comma-separated-tokens|vfile|devlop)\//.test(
      normalizedId
    )
  ) {
    return 'markdown'
  }

  if (
    /node_modules\/(react|react-dom|react-router-dom|scheduler|swr|i18next|react-i18next|next-themes)\//.test(
      normalizedId
    )
  ) {
    return 'react-vendor'
  }

  if (
    /node_modules\/(@heroui|@react-aria|@react-stately|@react-types|framer-motion)\//.test(
      normalizedId
    )
  ) {
    return 'ui'
  }

  if (/node_modules\/react-icons\//.test(normalizedId)) {
    return 'icons'
  }

  return 'vendor'
}

export default defineConfig({
  main: {
    plugins: isLegacyBuild ? [] : [externalizeDepsPlugin()],
    build: isLegacyBuild
      ? { rollupOptions: { external: legacyExternal, output: { format: 'cjs' } } }
      : {
          target: 'node20',
          minify: isProduction,
          sourcemap: false
        }
  },
  preload: {
    plugins: isLegacyBuild ? [] : [externalizeDepsPlugin()],
    build: {
      target: 'node20',
      minify: isProduction,
      sourcemap: false,
      rollupOptions: {
        external: isLegacyBuild ? legacyExternal : undefined,
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    build: {
      target: 'esnext',
      cssTarget: 'chrome120',
      minify: 'esbuild',
      sourcemap: false,
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          floating: resolve('src/renderer/floating.html')
        },
        output: {
          manualChunks: rendererManualChunks
        }
      }
    },
    esbuild: {
      legalComments: 'none',
      drop: isProduction ? ['debugger'] : []
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [
      react(),
      tailwindcss(),
      monacoEditorPlugin({
        languageWorkers: ['editorWorkerService', 'typescript', 'css'],
        customDistPath: (_, out) => `${out}/monacoeditorwork`,
        customWorkers: [
          {
            label: 'yaml',
            entry: 'monaco-yaml/yaml.worker'
          }
        ]
      })
    ]
  }
})
