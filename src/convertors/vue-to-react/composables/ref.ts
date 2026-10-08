import * as t from '@babel/types'

export function convertRef(
    name: string,
    setter: string,
    initializer: t.Expression,
): t.VariableDeclaration {
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
