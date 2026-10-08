import * as t from '@babel/types'
import type { NodePath } from '@babel/traverse'
import { traverse } from '../../utils/babel.js'
import { unsupported } from './hooks/unsupported.js'
import { getHookName, type StateBinding } from './hooks/use-state.js'
import { generate } from '../../utils/babel.js'

export type ExpressionMode = 'script' | 'template'

export function printNode(node: t.Node): string {
    return generate(node, {
        comments: false,
        retainLines: false,
        concise: false,
    }).code
}

export function stateReference(
    name: string,
    mode: ExpressionMode,
): t.Expression {
    return mode === 'script'
        ? t.memberExpression(t.identifier(name), t.identifier('value'))
        : t.identifier(name)
}

export function transformNode(
    node: t.Node,
    states: Map<string, StateBinding>,
    mode: ExpressionMode,
    componentName: string,
): t.Node {
    const clone = t.cloneNode(node, true)
    const file = t.file(
        t.program([
            t.isStatement(clone)
                ? clone
                : t.expressionStatement(clone as t.Expression),
        ]),
    )

    traverse(file, {
        CallExpression(path: NodePath<t.CallExpression>) {
            const hookName = getHookName(path.node)
            if (
                hookName &&
                /^use[A-Z]/.test(hookName) &&
                !['useState', 'useEffect'].includes(hookName)
            ) {
                unsupported(
                    componentName,
                    hookName,
                    'No Vue equivalent is available in this converter yet',
                )
            }
            const { callee, arguments: args } = path.node
            if (
                !t.isIdentifier(callee) ||
                ![...states.values()].some((state) => state.setter === callee.name)
            ) return

            const binding = [...states.values()].find(
                (state) => state.setter === callee.name,
            )
            if (!binding || args.length !== 1 || t.isSpreadElement(args[0])) {
                unsupported(
                    componentName,
                    callee.name,
                    'State setters with anything other than one argument cannot be converted',
                )
            }

            const argument = transformExpression(
                args[0] as t.Expression,
                states,
                mode,
                componentName,
            )
            const right =
                t.isArrowFunctionExpression(argument) ||
                t.isFunctionExpression(argument)
                    ? t.callExpression(argument, [stateReference(binding.name, mode)])
                    : argument
            path.replaceWith(
                t.assignmentExpression(
                    '=',
                    stateReference(binding.name, mode) as t.LVal,
                    right,
                ),
            )
            path.skip()
        },
        AssignmentExpression(path) {
            if (t.isIdentifier(path.node.left) && states.has(path.node.left.name)) {
                path.node.left = stateReference(path.node.left.name, mode) as t.LVal
                path.get('left').skip()
            }
        },
        UpdateExpression(path) {
            if (
                t.isIdentifier(path.node.argument) &&
                states.has(path.node.argument.name)
            ) {
                path.node.argument = stateReference(path.node.argument.name, mode)
                path.get('argument').skip()
            }
        },
        ReferencedIdentifier(path) {
            const name = path.node.name
            const binding = states.get(name)
            if (binding) {
                path.replaceWith(stateReference(name, mode))
                path.skip()
                return
            }
            if ([...states.values()].some((state) => state.setter === name)) {
                unsupported(
                    componentName,
                    name,
                    'Passing a React state setter as a callback is not supported; wrap it in an event handler',
                )
            }
        },
    })
    return t.isFile(clone) ? clone : file.program.body[0] as t.Node
}

export function transformExpression(
    expression: t.Expression,
    states: Map<string, StateBinding>,
    mode: ExpressionMode,
    componentName: string,
): t.Expression {
    const transformed = transformNode(expression, states, mode, componentName)
    return t.isExpressionStatement(transformed)
        ? transformed.expression
        : transformed as t.Expression
}
