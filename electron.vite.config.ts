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

const isProduction =
  process.env.NODE_ENV === 'production' || process.env.npm_lifecycle_event?.startsWith('build')

const terserOptions = {
  compress: {
    drop_console: true,
    drop_debugger: true
  },
  format: {
    comments: false
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      target: 'node24',
      minify: isProduction ? 'terser' : false,
      terserOptions,
      sourcemap: false
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      target: 'node24',
      minify: isProduction ? 'terser' : false,
      terserOptions,
      sourcemap: false,
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    build: {
      target: 'chrome148',
      cssTarget: 'chrome148',
      minify: isProduction ? 'terser' : false,
      terserOptions,
      sourcemap: false,
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html')
        }
      }
    },
    esbuild: {
      legalComments: 'none'
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
