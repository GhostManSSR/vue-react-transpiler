import * as t from '@babel/types'

const unmountHooks = new Set(['onUnmounted', 'onBeforeUnmount'])
const mountHooks = new Set(['onMounted'])

export function convertLifecycle(
    hookName: string,
    callback: t.Node | null | undefined,
    componentName: string,
    lifecycleIndex: number,
): t.Statement[] {
    if (
        !callback ||
        t.isSpreadElement(callback) ||
        (!t.isArrowFunctionExpression(callback) &&
            !t.isFunctionExpression(callback))
    ) {
        throw new Error(`${componentName}: ${hookName} - expected a callback function`)
    }
    if (callback.async || callback.params.length > 0) {
        throw new Error(`${componentName}: ${hookName} - async callbacks and callback parameters are not supported`)
    }
    const callbackExpression = t.cloneNode(callback, true) as t.Expression
    if (hookName === 'onUpdated') {
        const ready = `__updatedReady${lifecycleIndex}`
        return [
            t.variableDeclaration('const', [
                t.variableDeclarator(
                    t.identifier(ready),
                    t.callExpression(
                        t.memberExpression(t.identifier('React'), t.identifier('useRef')),
                        [t.booleanLiteral(false)],
                    ),
                ),
            ]),
            t.expressionStatement(
                t.callExpression(
                    t.memberExpression(t.identifier('React'), t.identifier('useEffect')),
                    [
                        t.arrowFunctionExpression(
                            [],
                            t.blockStatement([
                                t.ifStatement(
                                    t.unaryExpression(
                                        '!',
                                        t.memberExpression(t.identifier(ready), t.identifier('current')),
                                    ),
                                    t.blockStatement([
                                        t.expressionStatement(
                                            t.assignmentExpression(
                                                '=',
                                                t.memberExpression(t.identifier(ready), t.identifier('current')),
                                                t.booleanLiteral(true),
                                            ),
                                        ),
                                        t.returnStatement(),
                                    ]),
                                ),
                                t.expressionStatement(
                                    t.callExpression(callbackExpression, []),
                                ),
                            ]),
                        ),
                    ],
                ),
            ),
        ]
    }
    const effect = unmountHooks.has(hookName)
        ? t.arrowFunctionExpression(
            [],
            t.arrowFunctionExpression(
                [],
                hookName === 'onUnmounted'
                    ? t.callExpression(
                        t.identifier('queueMicrotask'),
                        [t.arrowFunctionExpression(
                            [],
                            t.callExpression(callbackExpression, []),
                        )],
                    )
                    : t.callExpression(callbackExpression, []),
            ),
        )
        : t.arrowFunctionExpression(
            [],
            t.blockStatement([
                t.expressionStatement(t.callExpression(callbackExpression, [])),
            ]),
        )
    const dependencies = mountHooks.has(hookName) || unmountHooks.has(hookName)
        ? t.arrayExpression([])
        : null
    const args = dependencies ? [effect, dependencies] : [effect]
    return [
        t.expressionStatement(
            t.callExpression(
                t.memberExpression(t.identifier('React'), t.identifier('useEffect')),
                args,
            ),
        ),
    ]
}
