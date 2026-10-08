import * as t from '@babel/types'
import type { ComposableState } from './types.js'
import { transformVueExpression } from '../expressions.js'

export function convertWatchEffect(
    callback: t.Node | null | undefined,
    states: Map<string, ComposableState>,
    componentName: string,
): t.ExpressionStatement {
    if (
        !callback ||
        t.isSpreadElement(callback) ||
        (!t.isArrowFunctionExpression(callback) &&
            !t.isFunctionExpression(callback))
    ) {
        throw new Error(`${componentName}: watchEffect - expected a callback function`)
    }
    if (callback.async || callback.params.length > 0) {
        throw new Error(`${componentName}: watchEffect - async callbacks and onCleanup parameters are not supported`)
    }
    const transformed = transformVueExpression(
        callback as t.Expression,
        states,
        componentName,
    )
    return t.expressionStatement(
        t.callExpression(
            t.memberExpression(t.identifier('React'), t.identifier('useEffect')),
            [
                t.arrowFunctionExpression(
                    [],
                    t.blockStatement([
                        t.expressionStatement(
                            t.callExpression(transformed, []),
                        ),
                    ]),
                ),
            ],
        ),
    )
}
