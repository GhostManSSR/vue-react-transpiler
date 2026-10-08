import type * as t from '@babel/types'

export interface PropInfo {
    name: string
    optional: boolean
    type: t.TSType
}

export interface EmitInfo {
    variableName: string
    events: string[]
}

export interface ConvertOptions {
    componentName?: string
}

export interface ConvertResult {
    code: string
    componentName: string
    props: PropInfo[]
    emits: string[]
}