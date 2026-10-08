import type { PropInfo } from '../../types.js'

export interface ReactToVueDiagnostic {
    componentName: string
    construct: string
    message: string
    severity: 'warning' | 'error'
}

export interface ReactToVueOptions {
    componentName?: string
}

export interface ReactToVueResult {
    code: string
    componentName: string
    props: PropInfo[]
    emits: string[]
    diagnostics: ReactToVueDiagnostic[]
}
