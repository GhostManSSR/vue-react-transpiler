import * as t from '@babel/types'
import type { NodePath } from '@babel/traverse'
import { traverse } from '../../../utils/babel.js'
import type { ComposableState } from './types.js'
import {
    collectDependencies,
    transformVueExpression,
} from '../expressions.js'

interface WatchOptions {
    immediate: boolean
    deep: boolean
    flush: 'pre' | 'post' | 'sync' | null
}

function parseWatchOptions(
    options:
        | t.Expression
        | t.SpreadElement
        | t.ArgumentPlaceholder
        | undefined,
    componentName: string,
): WatchOptions {
    const result: WatchOptions = {
        immediate: false,
        deep: false,
        flush: null,
    }

    if (!options) {
        return result
    }

    if (t.isSpreadElement(options) || !t.isObjectExpression(options)) {
        throw new Error(
            `${componentName}: watch options - expected an object literal`,
        )
    }

    for (const property of options.properties) {
        if (t.isSpreadElement(property)) {
            throw new Error(
                `${componentName}: watch options - spread properties are not supported`,
            )
        }

        if (!t.isObjectProperty(property)) {
            continue
        }

        if (!t.isIdentifier(property.key)) {
            continue
        }

        const name = property.key.name

        if (name === 'immediate') {
            if (!t.isBooleanLiteral(property.value)) {
                throw new Error(
                    `${componentName}: watch options - immediate must be a boolean literal`,
                )
            }

            result.immediate = property.value.value
            continue
        }

        if (name === 'deep') {
            if (!t.isBooleanLiteral(property.value)) {
                throw new Error(
                    `${componentName}: watch options - deep must be a boolean literal`,
                )
            }

            result.deep = property.value.value
            continue
        }

        if (name === 'flush') {
            if (!t.isStringLiteral(property.value)) {
                throw new Error(
                    `${componentName}: watch options - flush must be a string literal`,
                )
            }

            const value = property.value.value

            if (
                value !== 'pre' &&
                value !== 'post' &&
                value !== 'sync'
            ) {
                throw new Error(
                    `${componentName}: watch options - unsupported flush value "${value}"`,
                )
            }

            result.flush = value
            continue
        }

        // Остальные Vue watch options намеренно игнорируем.
        // Например:
        // once: true
        //
        // Если захочешь поддержать их отдельно, сюда можно
        // добавить соответствующую трансформацию.
    }

    return result
}

function getSourceDependencies(
    source: t.Expression,
    states: Map<string, ComposableState>,
): Set<string> {
    const dependencies = new Set<string>()

    for (const name of collectDependencies(source, states)) {
        dependencies.add(name)
    }

    const file = t.file(
        t.program([
            t.expressionStatement(t.cloneNode(source, true)),
        ]),
    )
    traverse(file, {
        ReferencedIdentifier(
            path: NodePath<t.Identifier | t.JSXIdentifier>,
        ) {
            if (!t.isIdentifier(path.node)) return
            const name = path.node.name
            if (states.has(name) || !path.scope.hasBinding(name)) {
                dependencies.add(name)
            }
        },
    })

    return dependencies
}

function makeRef(name: string): t.Expression {
    return t.memberExpression(
        t.identifier(name),
        t.identifier('current'),
    )
}

function makeEffectCallback(
    callback: t.ArrowFunctionExpression | t.FunctionExpression,
    states: Map<string, ComposableState>,
    componentName: string,
    readyName: string,
    immediate: boolean,
): t.ArrowFunctionExpression {
    const transformedCallback = transformVueExpression(
        callback,
        states,
        componentName,
    )

    if (
        !t.isArrowFunctionExpression(transformedCallback) &&
        !t.isFunctionExpression(transformedCallback)
    ) {
        throw new Error(
            `${componentName}: watch callback - failed to transform callback`,
        )
    }

    const callbackBody = t.isBlockStatement(
        transformedCallback.body,
    )
        ? transformedCallback.body.body
        : [
            t.returnStatement(
                transformedCallback.body as t.Expression,
            ),
        ]

    const statements: t.Statement[] = []

    if (!immediate) {
        statements.push(
            t.ifStatement(
                t.unaryExpression(
                    '!',
                    t.memberExpression(
                        t.identifier(readyName),
                        t.identifier('current'),
                    ),
                ),
                t.blockStatement([
                    t.expressionStatement(
                        t.assignmentExpression(
                            '=',
                            t.memberExpression(
                                t.identifier(readyName),
                                t.identifier('current'),
                            ),
                            t.booleanLiteral(true),
                        ),
                    ),
                    t.returnStatement(),
                ]),
            ),
        )
    } else {
        statements.push(
            t.expressionStatement(
                t.assignmentExpression(
                    '=',
                    t.memberExpression(
                        t.identifier(readyName),
                        t.identifier('current'),
                    ),
                    t.booleanLiteral(true),
                ),
            ),
        )
    }

    statements.push(...callbackBody)

    return t.arrowFunctionExpression(
        [],
        t.blockStatement(statements),
    )
}

export function convertWatch(
    call: t.CallExpression,
    states: Map<string, ComposableState>,
    componentName: string,
    watchIndex: number,
): t.Statement[] {
    const [source, callback, options] = call.arguments

    if (call.arguments.length > 3) {
        throw new Error(
            `${componentName}: watch - unexpected extra arguments`,
        )
    }

    if (
        !source ||
        !callback ||
        t.isSpreadElement(source) ||
        t.isSpreadElement(callback)
    ) {
        throw new Error(
            `${componentName}: watch - expected a source and callback`,
        )
    }

    if (
        !t.isArrowFunctionExpression(callback) &&
        !t.isFunctionExpression(callback)
    ) {
        throw new Error(
            `${componentName}: watch - callback must be a function`,
        )
    }

    const watchOptions = parseWatchOptions(
        options,
        componentName,
    )

    /*
     * Vue:
     *
     * watch(
     *   source,
     *   callback,
     *   options
     * )
     *
     * React:
     *
     * useEffect(callback, dependencies)
     *
     * `flush` не имеет прямого аналога в React.
     * useEffect является наиболее близким вариантом
     * для post/pre scheduling.
     */

    const sources = t.isArrayExpression(source)
        ? source.elements
        : [source]

    if (
        sources.some(
            (item) => !item || t.isSpreadElement(item),
        )
    ) {
        throw new Error(
            `${componentName}: watch source - sparse and spread sources are not supported`,
        )
    }

    const dependencies = new Set<string>()

    for (const item of sources) {
        if (
            !item ||
            t.isSpreadElement(item) ||
            t.isArgumentPlaceholder(item)
        ) {
            throw new Error(
                `${componentName}: watch source - sparse, spread, and placeholder sources are not supported`,
            )
        }

        for (const name of getSourceDependencies(item, states)) {
            dependencies.add(name)
        }
    }

    if (dependencies.size === 0) {
        throw new Error(
            `${componentName}: watch source - expected a reactive source`,
        )
    }

    const ready = `__watchReady${watchIndex}`

    /*
     * useRef хранит состояние между render'ами.
     *
     * Для обычного Vue watch:
     *
     * watch(source, callback)
     *
     * callback НЕ вызывается на первом render.
     *
     * Поэтому пропускаем первый useEffect.
     *
     * Для:
     *
     * watch(source, callback, { immediate: true })
     *
     * первый вызов разрешаем.
     */

    const readyDeclaration = t.variableDeclaration(
        'const',
        [
            t.variableDeclarator(
                t.identifier(ready),
                t.callExpression(
                    t.memberExpression(
                        t.identifier('React'),
                        t.identifier('useRef'),
                    ),
                    [t.booleanLiteral(false)],
                ),
            ),
        ],
    )

    const effectCallback = makeEffectCallback(
        callback,
        states,
        componentName,
        ready,
        watchOptions.immediate,
    )

    /*
     * deep: true
     *
     * У React нет прямого аналога Vue deep watcher.
     *
     * Поэтому dependency array остаётся основанным
     * на найденных reactive dependencies.
     *
     * Это корректно для immutable React state,
     * но не полностью эквивалентно Vue deep watch.
     */

    const effect = t.expressionStatement(
        t.callExpression(
            t.memberExpression(
                t.identifier('React'),
                t.identifier('useEffect'),
            ),
            [
                effectCallback,
                t.arrayExpression(
                    [...dependencies].map((name) =>
                        t.identifier(name),
                    ),
                ),
            ],
        ),
    )

    return [
        readyDeclaration,
        effect,
    ]
}