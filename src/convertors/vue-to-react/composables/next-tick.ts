import * as t from '@babel/types'

export function convertNextTick(
    call: t.CallExpression,
): t.Expression {
    if (call.arguments.length > 1) {
        throw new Error('nextTick accepts at most one callback')
    }
    const callback = call.arguments[0]
    const resolved = t.callExpression(
        t.memberExpression(t.identifier('Promise'), t.identifier('resolve')),
        [],
    )
    if (!callback) return resolved
    if (!t.isExpression(callback)) {
        throw new Error('nextTick callback must be an expression')
    }
    return t.callExpression(
        t.memberExpression(resolved, t.identifier('then')),
        [callback],
    )
}
