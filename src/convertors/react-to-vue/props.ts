import * as t from '@babel/types'
import type { PropInfo } from '../../types.js'

export function getProps(
    program: t.Program,
    propsTypeName: string | null,
): PropInfo[] {
    if (!propsTypeName) return []

    const declaration = program.body
        .map((statement) =>
            t.isExportNamedDeclaration(statement)
                ? statement.declaration
                : statement,
        )
        .find((statement) => {
            if (t.isTSInterfaceDeclaration(statement)) {
                return statement.id.name === propsTypeName
            }
            return (
                t.isTSTypeAliasDeclaration(statement) &&
                statement.id.name === propsTypeName
            )
        })

    let members: readonly t.TSTypeElement[] | undefined
    if (declaration && t.isTSInterfaceDeclaration(declaration)) {
        members = declaration.body.body
    } else if (
        declaration &&
        t.isTSTypeAliasDeclaration(declaration) &&
        t.isTSTypeLiteral(declaration.typeAnnotation)
    ) {
        members = declaration.typeAnnotation.members
    }
    if (!members) return []

    const props: PropInfo[] = []
    for (const member of members) {
        if (!t.isTSPropertySignature(member)) continue
        const name = t.isIdentifier(member.key)
            ? member.key.name
            : t.isStringLiteral(member.key)
                ? member.key.value
                : null
        if (!name || !member.typeAnnotation) continue
        props.push({
            name,
            optional: member.optional === true,
            type: member.typeAnnotation.typeAnnotation,
        })
    }
    return props
}
