import React, { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import MonacoEditor from 'react-monaco-editor'
import { configureMonacoYaml } from 'monaco-yaml'
import metaSchema from 'meta-json-schema/schemas/meta-json-schema.json'
import pac from 'types-pac/pac.d.ts?raw'
import { useTheme } from 'next-themes'
import { nanoid } from 'nanoid'
import type { BaseEditorProps } from './base-editor'

let initialized = false
const metaSchemaProperties = (metaSchema as { properties?: Record<string, unknown> }).properties ?? {}
const monacoInitialization = (): void => {
  if (initialized) return

  // configure yaml worker
  configureMonacoYaml(monaco, {
    validate: true,
    enableSchemaRequest: true,
    schemas: [
      {
        uri: 'http://example.com/meta-json-schema.json',
        fileMatch: ['**/*.clash.yaml'],
        // @ts-ignore // type JSONSchema7
        schema: {
          ...metaSchema,
          properties: {
            ...metaSchemaProperties,
            'clash-lite': {
              type: 'object',
              description: 'Clash Lite custom configuration',
              properties: {
                'sing-box': {
                  oneOf: [{ type: 'string' }, { type: 'object' }],
                  description: 'sing-box JSON configuration'
                }
              },
              additionalProperties: true
            }
          },
          patternProperties: {
            '\\+rules': {
              type: 'array',
              $ref: '#/definitions/rules',
              description: '“+”开头表示将内容插入到原数组前面'
            },
            'rules\\+': {
              type: 'array',
              $ref: '#/definitions/rules',
              description: '“+”结尾表示将内容追加到原数组后面'
            },
            '\\+proxies': {
              type: 'array',
              $ref: '#/definitions/proxies',
              description: '“+”开头表示将内容插入到原数组前面'
            },
            'proxies\\+': {
              type: 'array',
              $ref: '#/definitions/proxies',
              description: '“+”结尾表示将内容追加到原数组后面'
            },
            '\\+proxy-groups': {
              type: 'array',
              $ref: '#/definitions/proxy-groups',
              description: '“+”开头表示将内容插入到原数组前面'
            },
            'proxy-groups\\+': {
              type: 'array',
              $ref: '#/definitions/proxy-groups',
              description: '“+”结尾表示将内容追加到原数组后面'
            },
            '^\\+': {
              type: 'array',
              description: '“+”开头表示将内容插入到原数组前面'
            },
            '\\+$': {
              type: 'array',
              description: '“+”结尾表示将内容追加到原数组后面'
            },
            '!$': {
              type: 'object',
              description: '“!”结尾表示强制覆盖该项而不进行递归合并'
            }
          }
        }
      }
    ]
  })
  // configure PAC definition
  monaco.languages.typescript.javascriptDefaults.addExtraLib(pac, 'pac.d.ts')
  initialized = true
}

const BaseEditorImpl: React.FC<BaseEditorProps> = (props) => {
  const { theme, systemTheme } = useTheme()
  const trueTheme = theme === 'system' ? systemTheme : theme
  const { value, readOnly = false, language, onChange } = props

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>(undefined)

  const editorWillMount = (): void => {
    monacoInitialization()
  }

  const editorDidMount = (editor: monaco.editor.IStandaloneCodeEditor): void => {
    editorRef.current = editor

    const uri = monaco.Uri.parse(`${nanoid()}.${language === 'yaml' ? 'clash' : ''}.${language}`)
    const model = monaco.editor.createModel(value, language, uri)
    editorRef.current?.setModel(model)
  }

  useEffect(() => {
    window.onresize = (): void => {
      setTimeout(() => {
        editorRef.current?.layout()
      }, 0)
    }
    return (): void => {
      window.onresize = null
      editorRef.current?.dispose()
      editorRef.current = undefined
    }
  }, [])

  return (
    <MonacoEditor
      language={language}
      value={value}
      height="100%"
      theme={trueTheme?.includes('light') ? 'vs' : 'vs-dark'}
      options={{
        tabSize: ['yaml', 'javascript', 'json'].includes(language) ? 2 : 4,
        minimap: {
          enabled: document.documentElement.clientWidth >= 1500
        },
        mouseWheelZoom: true,
        readOnly: readOnly,
        renderValidationDecorations: 'on',
        quickSuggestions: {
          strings: true,
          comments: true,
          other: true
        },
        fontFamily: `Fira Code, JetBrains Mono, Roboto Mono, "Source Code Pro", Consolas, Menlo, Monaco, monospace, "Courier New", "Apple Color Emoji", "Noto Color Emoji"`,
        fontLigatures: true,
        smoothScrolling: true
      }}
      editorWillMount={editorWillMount}
      editorDidMount={editorDidMount}
      editorWillUnmount={(): void => {}}
      onChange={onChange}
    />
  )
}

export default BaseEditorImpl
