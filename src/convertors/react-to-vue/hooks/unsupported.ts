import type { ReactToVueDiagnostic } from '../types.js'

export class ReactToVueConversionError extends Error {
    constructor(
        public readonly diagnostics: ReactToVueDiagnostic[],
    ) {
        super(
            diagnostics
                .map(
                    ({ componentName, construct, message }) =>
                        `${componentName}: ${construct} — ${message}`,
                )
                .join('\n'),
        )
        this.name = 'ReactToVueConversionError'
    }
}

export function unsupported(
    componentName: string,
    construct: string,
    message: string,
): never {
    throw new ReactToVueConversionError([
        {
            componentName,
            construct,
            message,
            severity: 'error',
        },
    ])
}
