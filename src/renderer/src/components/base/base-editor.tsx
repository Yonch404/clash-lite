import React, { lazy, Suspense } from 'react'

export type BaseEditorLanguage = 'yaml' | 'javascript' | 'css' | 'json' | 'text'

export interface BaseEditorProps {
  value: string
  readOnly?: boolean
  language: BaseEditorLanguage
  onChange?: (value: string) => void
}

const LazyBaseEditor = lazy(() => import('./base-editor-impl'))

export const BaseEditor: React.FC<BaseEditorProps> = (props) => {
  return (
    <Suspense fallback={<div className="h-full w-full animate-pulse rounded-small bg-content2" />}>
      <LazyBaseEditor {...props} />
    </Suspense>
  )
}
