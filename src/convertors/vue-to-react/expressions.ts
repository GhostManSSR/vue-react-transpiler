import * as t from '@babel/types'
import type { NodePath } from '@babel/traverse'
import { traverse } from '../../utils/babel.js'
import type { ComposableState } from './composables/types.js'

function fail(componentName: string, construct: string, message: string): never {
    throw new Error(`${componentName}: ${construct} - ${message}`)
}

function applyReactiveTransforms(
    file: t.File,
    states: Map<string, ComposableState>,
    componentName: string,
): void {
    traverse(file, {
        AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
            const { left, operator, right } = path.node
            if (t.isIdentifier(left)) {
                const binding = states.get(left.name)
                if (!binding) return
                if (binding.kind === 'computed') {
                    fail(componentName, binding.name, 'computed values are read-only')
                }
                if (operator === '=') {
                    path.replaceWith(
                        t.callExpression(
                            t.identifier(binding.setter),
                            [transformVueExpression(right, states, componentName)],
                        ),
                    )
                } else if (binding.kind === 'ref') {
                    if (!['+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '|=', '^=', '&='].includes(operator)) {
                        fail(componentName, binding.name, 'this compound assignment is not supported')
                    }
                    const binaryOperator = operator.slice(0, -1) as t.BinaryExpression['operator']
                    path.replaceWith(
                        t.callExpression(
                            t.identifier(binding.setter),
                            [
                                t.arrowFunctionExpression(
                                    [t.identifier('current')],
                                    t.binaryExpression(
                                        binaryOperator,
                                        t.identifier('current'),
                                        transformVueExpression(right, states, componentName),
                                    ),
                                ),
                            ],
                        ),
                    )
                } else {
                    fail(componentName, binding.name, 'compound assignment is not supported')
                }
                path.skip()
                return
            }
            if (t.isMemberExpression(left) && !t.isIdentifier(left.object)) {
                let root: t.Expression = left.object
                while (t.isMemberExpression(root)) root = root.object as t.Expression
                if (t.isIdentifier(root) && states.has(root.name)) {
                    fail(
                        componentName,
                        root.name,
                        'nested reactive mutations are not supported',
                    )
                }
            }
            if (!t.isMemberExpression(left) || !t.isIdentifier(left.object)) return

            const binding = states.get(left.object.name)
            if (!binding) return
            if (binding.kind === 'computed') {
                fail(componentName, binding.name, 'computed values are read-only')
            }

            if (
                binding.kind === 'ref' &&
                !left.computed &&
                t.isIdentifier(left.property, { name: 'value' })
            ) {
                if (operator === '=') {
                    path.replaceWith(
                        t.callExpression(
                            t.identifier(binding.setter),
                            [transformVueExpression(right, states, componentName)],
                        ),
                    )
                } else {
                    if (!['+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '|=', '^=', '&='].includes(operator)) {
                        fail(componentName, binding.name, 'this compound assignment is not supported')
                    }
                    const binaryOperator = operator.slice(0, -1) as t.BinaryExpression['operator']
                    path.replaceWith(
                        t.callExpression(t.identifier(binding.setter), [
                            t.arrowFunctionExpression(
                                [t.identifier('current')],
                                t.binaryExpression(
                                    binaryOperator,
                                    t.identifier('current'),
                                    transformVueExpression(right, states, componentName),
                                ),
                            ),
                        ]),
                    )
                }
                path.skip()
                return
            }

            if (binding.kind === 'reactive') {
                if (left.computed || !t.isIdentifier(left.property) || operator !== '=') {
                    fail(
                        componentName,
                        binding.name,
                        'only direct property replacement on reactive objects is supported',
                    )
                }
                path.replaceWith(
                    t.callExpression(t.identifier(binding.setter), [
                        t.arrowFunctionExpression(
                            [t.identifier('previous')],
                            t.objectExpression([
                                t.spreadElement(t.identifier('previous')),
                                t.objectProperty(
                                    t.identifier(left.property.name),
                                    transformVueExpression(right, states, componentName),
                                ),
                            ]),
                        ),
                    ]),
                )
                path.skip()
            }
        },
        UpdateExpression(path: NodePath<t.UpdateExpression>) {
            const argument = path.node.argument
            if (t.isIdentifier(argument)) {
                const binding = states.get(argument.name)
                if (!binding) return
                if (binding.kind === 'computed') {
                    fail(componentName, binding.name, 'computed values are read-only')
                }
                if (binding.kind !== 'ref') {
                    fail(componentName, binding.name, 'reactive objects cannot be incremented')
                }
                path.replaceWith(
                    t.callExpression(
                        t.identifier(binding.setter),
                        [
                            t.arrowFunctionExpression(
                                [t.identifier('current')],
                                t.binaryExpression(
                                    '+',
                                    t.identifier('current'),
                                    t.numericLiteral(path.node.operator === '++' ? 1 : -1),
                                ),
                            ),
                        ],
                    ),
                )
                path.skip()
                return
            }
            if (t.isMemberExpression(argument) && !t.isIdentifier(argument.object)) {
                let root: t.Expression = argument.object
                while (t.isMemberExpression(root)) root = root.object as t.Expression
                if (t.isIdentifier(root) && states.has(root.name)) {
                    fail(
                        componentName,
                        root.name,
                        'nested reactive mutations are not supported',
                    )
                }
            }
            if (!t.isMemberExpression(argument) || !t.isIdentifier(argument.object)) return
            const binding = states.get(argument.object.name)
            if (!binding) return
            if (
                binding.kind !== 'ref' ||
                argument.computed ||
                !t.isIdentifier(argument.property, { name: 'value' })
            ) {
                fail(componentName, binding.name, 'this reactive update form is not supported')
            }
            const delta = path.node.operator === '++' ? 1 : -1
            path.replaceWith(
                t.callExpression(t.identifier(binding.setter), [
                    t.arrowFunctionExpression(
                        [t.identifier('current')],
                        t.binaryExpression('+', t.identifier('current'), t.numericLiteral(delta)),
                    ),
                ]),
            )
            path.skip()
        },
        MemberExpression(path: NodePath<t.MemberExpression>) {
            const { object, property, computed } = path.node
            if (
                t.isIdentifier(object) &&
                ['ref', 'computed'].includes(states.get(object.name)?.kind ?? '') &&
                !computed &&
                t.isIdentifier(property, { name: 'value' })
            ) {
                path.replaceWith(t.identifier(object.name))
                path.skip()
            }
        },
    })
}

export function transformVueExpression(
    node: t.Expression,
    states: Map<string, ComposableState>,
    componentName: string,
): t.Expression {
    const file = t.file(t.program([t.expressionStatement(t.cloneNode(node, true))]))
    applyReactiveTransforms(file, states, componentName)
    return (file.program.body[0] as t.ExpressionStatement).expression
}

export function transformVueStatement(
    node: t.Statement,
    states: Map<string, ComposableState>,
    componentName: string,
): t.Statement {
    const file = t.file(t.program([t.cloneNode(node, true)]))
    applyReactiveTransforms(file, states, componentName)
    return file.program.body[0] as t.Statement
}

export function collectDependencies(
    node: t.Node,
    states: Map<string, ComposableState>,
): string[] {
    const dependencies = new Set<string>()
    const file = t.file(
        t.program([
            t.isStatement(node)
                ? t.cloneNode(node, true)
                : t.expressionStatement(t.cloneNode(node, true) as t.Expression),
        ]),
    )

    traverse(file, {
        MemberExpression(path: NodePath<t.MemberExpression>) {
            const { object, property, computed } = path.node
            if (
                t.isIdentifier(object) &&
                states.has(object.name) &&
                (states.get(object.name)?.kind !== 'ref' ||
                    (!computed && t.isIdentifier(property, { name: 'value' })))
            ) {
                dependencies.add(object.name)
            }
        },
        ReferencedIdentifier(path: NodePath<t.Identifier | t.JSXIdentifier>) {
            if (!t.isIdentifier(path.node)) return
            const state = states.get(path.node.name)
            if (state && state.kind !== 'ref') {
                dependencies.add(path.node.name)
            }
        },
    })

    return [...dependencies]
}
