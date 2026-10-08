import * as t from '@babel/types'
import { printNode, transformExpression, transformNode } from '../expressions.js'
import type { ReactToVueDiagnostic } from '../types.js'
import { unsupported } from './unsupported.js'
import { isHookCall, type StateBinding } from './use-state.js'

export function isUseEffectCall(
    node: t.Node | null | undefined,
): node is t.CallExpression {
    return isHookCall(node, 'useEffect')
}

export function transformHookCall(
    statement: t.Statement,
    states: Map<string, StateBinding>,
    componentName: string,
    effectIndex: number,
): {
    lines: string[]
    imports: string[]
    diagnostics: ReactToVueDiagnostic[]
} | null {
    if (
        !t.isExpressionStatement(statement) ||
        !isUseEffectCall(statement.expression)
    ) return null

    const call = statement.expression
    const callback = call.arguments[0]
    if (
        !callback ||
        t.isSpreadElement(callback) ||
        (!t.isArrowFunctionExpression(callback) &&
            !t.isFunctionExpression(callback))
    ) {
        unsupported(componentName, 'useEffect', 'Expected an effect callback function')
    }
    if (callback.async) {
        unsupported(
            componentName,
            'async useEffect',
            'React effects cannot be async functions; define and invoke an async function inside the effect instead',
        )
    }
    if (call.arguments.length > 2) {
        unsupported(
            componentName,
            'useEffect',
            'Effects with more than a callback and dependency list are not supported',
        )
    }

    const dependencies = call.arguments[1]
    if (
        dependencies &&
        (!t.isArrayExpression(dependencies) ||
            dependencies.elements.some(
                (element) => element === null || t.isSpreadElement(element),
            ))
    ) {
        unsupported(
            componentName,
            'useEffect dependencies',
            'Dependency lists must be static arrays without holes or spread elements',
        )
    }

    const callbackBody = t.isBlockStatement(callback.body)
        ? [...callback.body.body]
        : [t.expressionStatement(callback.body as t.Expression)]
    let cleanup: t.Expression | null = null
    const returnStatements = callbackBody.filter(
        (node): node is t.ReturnStatement => t.isReturnStatement(node),
    )
    const lastStatement = callbackBody.at(-1)
    if (
        returnStatements.length > 0 &&
        (returnStatements.length !== 1 || returnStatements[0] !== lastStatement)
    ) {
        unsupported(
            componentName,
            'useEffect cleanup',
            'Cleanup must be returned once, as the final statement in the effect',
        )
    }
    if (lastStatement && t.isReturnStatement(lastStatement)) {
        const cleanupNode = lastStatement.argument
        if (
            !cleanupNode ||
            (!t.isArrowFunctionExpression(cleanupNode) &&
                !t.isFunctionExpression(cleanupNode))
        ) {
            unsupported(
                componentName,
                'useEffect cleanup',
                'Effect returns must be cleanup functions',
            )
        }
        if (cleanupNode.async) {
            unsupported(
                componentName,
                'async useEffect cleanup',
                'Asynchronous cleanup functions are not supported',
            )
        }
        cleanup = cleanupNode
        callbackBody.pop()
    }

    const body = callbackBody
        .map((node) =>
            printNode(transformNode(node, states, 'script', componentName)),
        )
        .join('\n')
    const cleanupCode = cleanup
        ? `\nreturn ${printNode(
            transformExpression(cleanup, states, 'script', componentName),
        )};`
        : ''
    const runnerName = `__runEffect${effectIndex}`
    const lines = [
        `const ${runnerName} = () => {${body ? `\n${body}\n` : ''}${cleanupCode}\n};`,
    ]

    if (!dependencies) {
        lines.push(
            `watchEffect((onCleanup) => { const cleanup = ${runnerName}(); if (cleanup) onCleanup(cleanup); });`,
        )
        return {
            lines,
            imports: ['watchEffect'],
            diagnostics: [{
                componentName,
                construct: 'useEffect without dependencies',
                message:
                    'Converted to watchEffect; Vue tracks reactive reads, so reruns and scheduling may differ from React renders.',
                severity: 'warning',
            }],
        }
    }
    if (dependencies.elements.length === 0) {
        const cleanupName = `__cleanupEffect${effectIndex}`
        lines.push(
            `let ${cleanupName}: (() => void) | undefined;`,
            `onMounted(() => { ${cleanupName} = ${runnerName}(); });`,
            `onUnmounted(() => { ${cleanupName}?.(); });`,
        )
        return {
            lines,
            imports: ['onMounted', 'onUnmounted'],
            diagnostics: [],
        }
    }
    const dependencyValues = dependencies.elements.map((element) => {
        if (!element || t.isSpreadElement(element)) {
            unsupported(
                componentName,
                'useEffect dependencies',
                'Dependency lists cannot contain empty or spread elements',
            )
        }
        return printNode(
            transformExpression(
                element as t.Expression,
                states,
                'script',
                componentName,
            ),
        )
    })
    lines.push(
        `let __cleanupEffect${effectIndex}: (() => void) | undefined;`,
        `onMounted(() => { __cleanupEffect${effectIndex} = ${runnerName}(); });`,
        `watch(() => [${dependencyValues.join(', ')}], () => { __cleanupEffect${effectIndex}?.(); __cleanupEffect${effectIndex} = ${runnerName}(); }, { flush: 'post' });`,
        `onUnmounted(() => { __cleanupEffect${effectIndex}?.(); });`,
    )
    return {
        lines,
        imports: ['watch', 'onMounted', 'onUnmounted'],
        diagnostics: [{
            componentName,
            construct: 'useEffect with dependencies',
            message:
                'Converted to a post-flush Vue watch; React and Vue effect timing is not identical.',
            severity: 'warning',
        }],
    }
}
