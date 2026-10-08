import type * as t from '@babel/types'

export interface ComposableState {
    name: string
    setter: string
    kind: 'ref' | 'reactive' | 'computed'
}

export interface ComposableContext {
    componentName: string
    states: Map<string, ComposableState>
}

export interface ComposableTransform {
    statements: t.Statement[]
    imports: string[]
}
