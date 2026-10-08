import * as t from '@babel/types'

export function convertComputed(
    name: string,
    getter: t.Expression,
): t.VariableDeclaration {
    return t.variableDeclaration('const', [
        t.variableDeclarator(
            t.identifier(name),
            t.callExpression(
                t.memberExpression(t.identifier('React'), t.identifier('useMemo')),
                [getter],
            ),
        ),
    ])
}
