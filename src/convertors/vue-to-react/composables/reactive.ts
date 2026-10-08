import * as t from '@babel/types'

export function convertReactive(
    name: string,
    setter: string,
    initializer: t.Expression,
): t.VariableDeclaration {
    if (!t.isObjectExpression(initializer)) {
        throw new Error('reactive - only object literal initializers are supported')
    }
    return t.variableDeclaration('const', [
        t.variableDeclarator(
            t.arrayPattern([t.identifier(name), t.identifier(setter)]),
            t.callExpression(
                t.memberExpression(t.identifier('React'), t.identifier('useState')),
                [t.arrowFunctionExpression([], initializer)],
            ),
        ),
    ])
}
