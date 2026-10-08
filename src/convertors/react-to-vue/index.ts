import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { traverse } from '../../utils/babel.js'
import { getComponent, type ComponentInfo } from './component.js'
import { getProps } from './props.js'
import {
    printNode,
    transformExpression,
    transformNode,
    type ExpressionMode,
} from './expressions.js'
import { transformElement } from './template.js'
import {
    ReactToVueConversionError,
    unsupported,
    getHookName,
    getStateBinding,
    isHookCall,
    transformHookCall,
    type StateBinding,
} from './hooks/index.js'
import type {
    ReactToVueDiagnostic,
    ReactToVueOptions,
    ReactToVueResult,
} from './types.js'

function isReactImport(statement: t.ImportDeclaration): boolean {
    return statement.source.value === 'react'
}

interface PreparedScript {
    code: string
    states: Map<string, StateBinding>
    diagnostics: ReactToVueDiagnostic[]
}

function prepareScript(
    program: t.Program,
    component: ComponentInfo,
): PreparedScript {
    const states = new Map<string, StateBinding>()
    const vueImports = new Set<string>()
    const diagnostics: ReactToVueDiagnostic[] = []
    const stateDeclarations: Array<{
        statement: t.VariableDeclaration
        declarator: t.VariableDeclarator
        binding: StateBinding
    }> = []

    for (const statement of program.body) {
        if (
            !t.isImportDeclaration(statement) ||
            statement.source.value !== 'react'
        ) {
            continue
        }

        for (const specifier of statement.specifiers) {
            if (
                t.isImportSpecifier(specifier) &&
                t.isIdentifier(specifier.imported) &&
                ['useState', 'useEffect'].includes(
                    specifier.imported.name,
                ) &&
                specifier.local.name !== specifier.imported.name
            ) {
                unsupported(
                    component.name,
                    specifier.imported.name,
                    'Aliased React hooks are not supported; import the hook under its original name',
                )
            }

            if (
                t.isImportNamespaceSpecifier(specifier) &&
                specifier.local.name !== 'React'
            ) {
                unsupported(
                    component.name,
                    'React namespace import',
                    'Namespace-based hooks require the namespace to be named React',
                )
            }
        }
    }

    for (const statement of component.bodyStatements) {
        if (!t.isVariableDeclaration(statement)) {
            continue
        }

        for (const declarator of statement.declarations) {
            let hasNestedStateHook = false
            t.traverseFast(declarator, (node) => {
                if (isHookCall(node, 'useState') && node !== declarator.init) {
                    hasNestedStateHook = true
                }
            })

            if (hasNestedStateHook) {
                unsupported(
                    component.name,
                    'useState',
                    'useState must be called as the direct initializer of a two-item state declaration',
                )
            }

            const binding = getStateBinding(declarator, component.name)

            if (binding) {
                if (states.has(binding.name) || [...states.values()].some(
                    (state) => state.setter === binding.setter,
                )) {
                    unsupported(
                        component.name,
                        'useState',
                        'State and setter identifiers must be unique',
                    )
                }

                states.set(binding.name, binding)
                stateDeclarations.push({
                    statement,
                    declarator,
                    binding,
                })
            }
        }
    }

    const lines: string[] = []
    let effectIndex = 0

    for (const statement of component.bodyStatements) {
        const effect = transformHookCall(
            statement,
            states,
            component.name,
            effectIndex,
        )

        if (effect) {
            lines.push(...effect.lines)
            effect.imports.forEach((name) => vueImports.add(name))
            diagnostics.push(...effect.diagnostics)
            effectIndex += 1
            continue
        }

        if (t.isVariableDeclaration(statement)) {
            for (const declarator of statement.declarations) {
                const stateDeclaration = stateDeclarations.find(
                    (candidate) => candidate.declarator === declarator,
                )

                if (stateDeclaration) {
                    const call = declarator.init

                    if (!isHookCall(call, 'useState')) {
                        continue
                    }

                    const initialValue = call.arguments[0]

                    if (!initialValue || !t.isExpression(initialValue)) {
                        unsupported(
                            component.name,
                            'useState',
                            'State initializer must be a single expression',
                        )
                    }

                    const initializer =
                        t.isArrowFunctionExpression(initialValue) ||
                        t.isFunctionExpression(initialValue)
                            ? t.isBlockStatement(initialValue.body)
                                ? initialValue.body.body.find(
                                    (node) =>
                                        t.isReturnStatement(node) &&
                                        node.argument,
                                )?.type === 'ReturnStatement'
                                    ? (
                                        initialValue.body.body.find(
                                            (node) =>
                                                t.isReturnStatement(node),
                                        ) as t.ReturnStatement
                                    ).argument as t.Expression
                                    : null
                                : initialValue.body
                            : initialValue

                    if (!initializer) {
                        unsupported(
                            component.name,
                            'lazy useState initializer',
                            'Lazy initializers must return an expression directly',
                        )
                    }

                    const stateTypeArguments =
                        call.typeParameters ?? call.typeArguments
                    const stateTypeParameter = stateTypeArguments
                        ? `<${stateTypeArguments.params
                            .map((parameter) => printNode(parameter))
                            .join(', ')}>`
                        : ''

                    lines.push(
                        `const ${stateDeclaration.binding.name} = ref${stateTypeParameter}(${printNode(
                            transformExpression(
                                initializer,
                                states,
                                'script',
                                component.name,
                            ),
                        )});`,
                    )
                    vueImports.add('ref')
                    continue
                }

                let unsupportedHook: string | null = null
                t.traverseFast(declarator, (node) => {
                    const hookName = getHookName(node)

                    if (
                        hookName &&
                        /^use[A-Z]/.test(hookName) &&
                        hookName !== 'useState'
                    ) {
                        unsupportedHook = hookName
                    }
                })

                if (unsupportedHook) {
                    unsupported(
                        component.name,
                        unsupportedHook,
                        'No Vue equivalent is available in this converter yet',
                    )
                }
            }

            const remaining = statement.declarations.filter(
                (declarator) =>
                    !stateDeclarations.some(
                        (candidate) => candidate.declarator === declarator,
                    ),
            )

            if (remaining.length > 0) {
                const transformed = t.variableDeclaration(
                    statement.kind,
                    remaining.flatMap((declarator) => {
                        const transformed = transformNode(
                            t.variableDeclaration(
                                statement.kind,
                                [declarator],
                            ),
                            states,
                            'script',
                            component.name,
                        )

                        return t.isVariableDeclaration(transformed)
                            ? transformed.declarations
                            : []
                    }),
                )
                lines.push(printNode(transformed))
            }

            continue
        }

        if (t.isExpressionStatement(statement)) {
            let unsupportedHook: string | null = null
            t.traverseFast(statement, (node) => {
                const hookName = getHookName(node)

                if (hookName && /^use[A-Z]/.test(hookName)) {
                    unsupportedHook = hookName
                }
            })

            if (unsupportedHook) {
                unsupported(
                    component.name,
                    unsupportedHook,
                    'No Vue equivalent is available in this converter yet',
                )
            }
        }

        lines.push(
            printNode(
                transformNode(
                    statement,
                    states,
                    'script',
                    component.name,
                ),
            ),
        )
    }

    const declarations = program.body
        .filter((statement) => {
            if (
                t.isExportNamedDeclaration(statement) &&
                t.isFunctionDeclaration(statement.declaration) &&
                statement.declaration.id?.name === component.name
            ) {
                return false
            }

            if (
                t.isExportNamedDeclaration(statement) &&
                t.isVariableDeclaration(statement.declaration) &&
                statement.declaration.declarations.some(
                    (declaration) =>
                        t.isIdentifier(declaration.id) &&
                        declaration.id.name === component.name,
                )
            ) {
                return false
            }

            return true
        })
        .flatMap((statement) => {
            if (
                t.isImportDeclaration(statement) &&
                isReactImport(statement)
            ) {
                const specifiers = statement.specifiers.filter(
                    (specifier) =>
                        !t.isImportDefaultSpecifier(specifier) &&
                        !t.isImportNamespaceSpecifier(specifier) &&
                        !(
                            t.isImportSpecifier(specifier) &&
                            t.isIdentifier(specifier.imported) &&
                            ['useState', 'useEffect'].includes(
                                specifier.imported.name,
                            )
                        ),
                )

                if (specifiers.length === 0) {
                    return []
                }

                const importDeclaration = t.importDeclaration(
                    specifiers,
                    statement.source,
                )
                importDeclaration.importKind = statement.importKind
                return [printNode(importDeclaration)]
            }

            if (
                t.isExportNamedDeclaration(statement) &&
                statement.declaration
            ) {
                return [printNode(statement.declaration)]
            }

            return [printNode(statement)]
        })

    const parameterName = component.parameter
    let propsDeclaration: string | null = null

    if (parameterName && t.isObjectPattern(parameterName)) {
        const typeParameter = component.propsTypeName
            ? `<${component.propsTypeName}>`
            : ''

        propsDeclaration =
            `const ${printNode(parameterName)} = defineProps${typeParameter}();`
    } else if (parameterName && t.isIdentifier(parameterName)) {
        const typeParameter = component.propsTypeName
            ? `<${component.propsTypeName}>`
            : ''

        propsDeclaration =
            `const ${parameterName.name} = defineProps${typeParameter}();`
    } else if (component.propsTypeName) {
        propsDeclaration =
            `const props = defineProps<${component.propsTypeName}>();`
    }

    const content = [
        vueImports.size > 0
            ? `import { ${[...vueImports].join(', ')} } from 'vue';`
            : null,
        ...declarations,
        propsDeclaration,
        ...lines,
    ].filter(Boolean)

    return {
        code: `<script setup lang="ts">\n${content.join('\n\n')}\n</script>`,
        states,
        diagnostics,
    }
}

export function convertReactToVue(
    reactSource: string,
    options: ReactToVueOptions = {},
): ReactToVueResult {
    const ast = parse(reactSource, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
    })
    const component = getComponent(ast.program)
    const props = getProps(ast.program, component.propsTypeName)
    const name = options.componentName ?? component.name
    let script: PreparedScript
    let template: string

    try {
        script = prepareScript(ast.program, component)
        template = transformElement(
            component.render,
            script.states,
            component.name,
        )
    } catch (error) {
        if (error instanceof ReactToVueConversionError) {
            throw error
        }

        throw new ReactToVueConversionError([
            {
                componentName: component.name,
                construct: 'React component',
                message:
                    error instanceof Error ? error.message : String(error),
                severity: 'error',
            },
        ])
    }

    return {
        code: `${script.code}\n\n<template>\n  ${template}\n</template>`,
        componentName: name,
        props,
        emits: [],
        diagnostics: script.diagnostics,
    }
}

export type {
    ReactToVueDiagnostic,
    ReactToVueOptions,
    ReactToVueResult,
} from './types.js'
export { ReactToVueConversionError } from './hooks/unsupported.js'
