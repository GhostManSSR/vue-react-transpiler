import { parse as parseSfc } from '@vue/compiler-sfc'
import type {
    ConvertOptions,
    ConvertResult,
} from './types.js'
import {
    extractEmits,
    extractProps,
} from './converters/script.js'
import { generateReactCode } from './converters/react-ast.js'

function toPascalCase(value: string): string {
    return value
        .replace(/\.[^.]+$/, '')
        .split(/[^a-zA-Z0-9]+/g)
        .filter(Boolean)
        .map(
            (part) =>
                part.charAt(0).toUpperCase() +
                part.slice(1),
        )
        .join('') || 'ConvertedComponent'
}

export function convertVueToReact(
    vueSource: string,
    options: ConvertOptions = {},
): ConvertResult {
    const parsed = parseSfc(vueSource, {
        filename: 'Component.vue',
    })

    if (parsed.errors.length > 0) {
        const errors = parsed.errors
            .map((error) =>
                typeof error === 'string'
                    ? error
                    : error.message,
            )
            .join('\n')

        throw new Error(
            `Unable to parse Vue SFC:\n${errors}`,
        )
    }

    const scriptSetupSource =
        parsed.descriptor.scriptSetup?.content ?? ''

    const templateSource =
        parsed.descriptor.template?.content

    if (!templateSource) {
        throw new Error(
            'Vue SFC must contain a <template> block',
        )
    }

    const componentName =
        options.componentName ??
        toPascalCase(
            parsed.descriptor.filename ?? 'Component.vue',
        )

    const props = extractProps(scriptSetupSource)
    const emitInfo = extractEmits(scriptSetupSource)

    const code = generateReactCode(
        componentName,
        props,
        emitInfo,
        templateSource,
    )

    return {
        code,
        componentName,
        props,
        emits: emitInfo?.events ?? [],
    }
}

export type {
    ConvertOptions,
    ConvertResult,
    EmitInfo,
    PropInfo,
} from './types.js'