import { parse } from '@babel/parser'
import * as t from '@babel/types'
import type {
    EmitInfo,
    PropInfo,
} from '../../types.js'
import type { NodePath } from '@babel/traverse'

import { traverse } from '../../utils/babel.js'

function parseScriptAst(source: string) {
    return parse(source, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
    })
}

function getFirstTypeArgument(
    callExpression: t.CallExpression,
): t.TSType | null {
    const node = callExpression as t.CallExpression & {
        typeParameters?: t.TSTypeParameterInstantiation | null
        typeArguments?: t.TSTypeParameterInstantiation | null
    }

    const typeParameters =
        node.typeParameters ?? node.typeArguments

    if (!typeParameters) {
        return null
    }

    const firstParameter = typeParameters.params[0]

    return firstParameter && t.isTSType(firstParameter)
        ? firstParameter
        : null
}

function getSignatureParameters(
    signature: t.TSCallSignatureDeclaration,
): Array<
    t.Identifier |
    t.ObjectPattern |
    t.ArrayPattern |
    t.RestElement
> {
    const node = signature as t.TSCallSignatureDeclaration & {
        parameters?: Array<
            t.Identifier |
            t.ObjectPattern |
            t.ArrayPattern |
            t.RestElement
        >
        params?: Array<
            t.Identifier |
            t.ObjectPattern |
            t.ArrayPattern |
            t.RestElement
        >
    }

    return node.parameters ?? node.params ?? []
}

export function extractProps(
    scriptSource: string,
): PropInfo[] {
    const ast = parseScriptAst(scriptSource)
    const props: PropInfo[] = []
    const declarations = new Map<string, t.TSType>()

    for (const statement of ast.program.body) {
        const declaration = t.isExportNamedDeclaration(statement)
            ? statement.declaration
            : statement
        if (
            t.isTSInterfaceDeclaration(declaration)
        ) {
            declarations.set(
                declaration.id.name,
                t.tsTypeLiteral(declaration.body.body),
            )
        } else if (
            t.isTSTypeAliasDeclaration(declaration)
        ) {
            declarations.set(declaration.id.name, declaration.typeAnnotation)
        }
    }

    traverse(ast, {
        CallExpression(
            path: NodePath<t.CallExpression>,
        ) {
            const { node } = path

            if (
                !t.isIdentifier(node.callee, {
                    name: 'defineProps',
                })
            ) {
                return
            }

            let propsType = getFirstTypeArgument(node)

            if (
                propsType &&
                t.isTSTypeReference(propsType) &&
                t.isIdentifier(propsType.typeName)
            ) {
                propsType = declarations.get(propsType.typeName.name) ?? null
            }

            if (
                !propsType ||
                !t.isTSTypeLiteral(propsType)
            ) {
                return
            }

            for (const member of propsType.members) {
                if (
                    !t.isTSPropertySignature(member) ||
                    (!t.isIdentifier(member.key) &&
                        !t.isStringLiteral(member.key)) ||
                    !member.typeAnnotation ||
                    !t.isTSTypeAnnotation(
                        member.typeAnnotation,
                    )
                ) {
                    continue
                }

                props.push({
                    name: t.isIdentifier(member.key)
                        ? member.key.name
                        : member.key.value,
                    optional: member.optional === true,
                    type: member.typeAnnotation.typeAnnotation,
                })
            }
        },
    })

    return props
}

function extractEventNames(
    emitsType: t.TSType,
): string[] {
    if (!t.isTSTypeLiteral(emitsType)) {
        return []
    }

    const eventNames = new Set<string>()

    for (const member of emitsType.members) {
        if (!t.isTSCallSignatureDeclaration(member)) {
            continue
        }

        const firstParameter =
            getSignatureParameters(member)[0]

        if (
            !firstParameter ||
            !t.isIdentifier(firstParameter) ||
            !firstParameter.typeAnnotation ||
            !t.isTSTypeAnnotation(
                firstParameter.typeAnnotation,
            )
        ) {
            continue
        }

        const eventType =
            firstParameter.typeAnnotation.typeAnnotation

        if (
            t.isTSLiteralType(eventType) &&
            t.isStringLiteral(eventType.literal)
        ) {
            eventNames.add(eventType.literal.value)
            continue
        }

        if (t.isTSUnionType(eventType)) {
            for (const unionMember of eventType.types) {
                if (
                    t.isTSLiteralType(unionMember) &&
                    t.isStringLiteral(
                        unionMember.literal,
                    )
                ) {
                    eventNames.add(
                        unionMember.literal.value,
                    )
                }
            }
        }
    }

    return [...eventNames]
}

export function extractEmits(
    scriptSource: string,
): EmitInfo | null {
    const ast = parseScriptAst(scriptSource)
    let result: EmitInfo | null = null

    traverse(ast, {
        VariableDeclarator(
            path: NodePath<t.VariableDeclarator>,
        ) {
            const { node } = path

            if (
                !t.isIdentifier(node.id) ||
                !node.init ||
                !t.isCallExpression(node.init) ||
                !t.isIdentifier(node.init.callee, {
                    name: 'defineEmits',
                })
            ) {
                return
            }

            const emitsType = getFirstTypeArgument(
                node.init,
            )

            if (!emitsType) {
                return
            }

            result = {
                variableName: node.id.name,
                events: extractEventNames(emitsType),
            }
        },
    })

    return result
}
