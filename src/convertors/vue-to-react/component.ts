import * as t from '@babel/types'
import type { EmitInfo, PropInfo } from '../../types.js'
import {
    eventNameToReactProp,
    parseAndTransformTemplate,
} from './template.js'
import type { ComposableState } from './composables/types.js'

import { generate } from '../../utils/babel.js'

function createPropsInterface(
    componentName: string,
    props: PropInfo[],
    emitInfo: EmitInfo | null,
): t.TSInterfaceDeclaration {
    const propMembers = props.map((prop) => {
        const member = t.tsPropertySignature(
            t.identifier(prop.name),
            t.tsTypeAnnotation(prop.type),
        )

        member.optional = prop.optional

        return member
    })

    const emitMembers = (emitInfo?.events ?? []).map((eventName) => {
        const callbackType = t.tsFunctionType(
            null,
            [],
            t.tsTypeAnnotation(t.tsVoidKeyword()),
        )

        const member = t.tsPropertySignature(
            t.identifier(eventNameToReactProp(eventName)),
            t.tsTypeAnnotation(callbackType),
        )

        member.optional = true

        return member
    })

    return t.tsInterfaceDeclaration(
        t.identifier(`${componentName}Props`),
        null,
        [],
        t.tsInterfaceBody([
            ...propMembers,
            ...emitMembers,
        ]),
    )
}

function createComponent(
    componentName: string,
    props: PropInfo[],
    emitInfo: EmitInfo | null,
    template: t.JSXElement,
    scriptStatements: t.Statement[],
): t.VariableDeclaration {
    const names = [
        ...props.map((prop) => prop.name),
        ...(emitInfo?.events ?? []).map(eventNameToReactProp),
    ]

    const destructuredProperties = names.map((name) =>
        t.objectProperty(
            t.identifier(name),
            t.identifier(name),
            false,
            true,
        ),
    )

    const propsParameter = t.identifier('props')

    propsParameter.typeAnnotation = t.tsTypeAnnotation(
        t.tsTypeReference(
            t.identifier(`${componentName}Props`),
        ),
    )

    const destructureProps = t.variableDeclaration('const', [
        t.variableDeclarator(
            t.objectPattern(destructuredProperties),
            propsParameter,
        ),
    ])

    const componentFunction = t.arrowFunctionExpression(
        [propsParameter],
        t.blockStatement([
            destructureProps,
            ...scriptStatements,
            t.returnStatement(template),
        ]),
    )

    const componentIdentifier = t.identifier(componentName)

    componentIdentifier.typeAnnotation = t.tsTypeAnnotation(
        t.tsTypeReference(
            t.tsQualifiedName(
                t.identifier('React'),
                t.identifier('FC'),
            ),
            t.tsTypeParameterInstantiation([
                t.tsTypeReference(
                    t.identifier(`${componentName}Props`),
                ),
            ]),
        ),
    )

    return t.variableDeclaration('const', [
        t.variableDeclarator(
            componentIdentifier,
            componentFunction,
        ),
    ])
}

export function generateReactCode(
    componentName: string,
    props: PropInfo[],
    emitInfo: EmitInfo | null,
    templateSource: string,
    options: {
        states?: Map<string, ComposableState>
        moduleStatements?: t.Statement[]
        componentStatements?: t.Statement[]
    } = {},
): string {
    const jsxElement = parseAndTransformTemplate(
        templateSource,
        emitInfo?.variableName ?? null,
        options.states,
    )

    const program = t.program([
        t.importDeclaration(
            [
                t.importDefaultSpecifier(
                    t.identifier('React'),
                ),
            ],
            t.stringLiteral('react'),
        ),

        ...(options.moduleStatements ?? []).filter((statement) => {
            const declaration = t.isExportNamedDeclaration(statement)
                ? statement.declaration
                : statement
            return !(
                (t.isTSInterfaceDeclaration(declaration) ||
                    t.isTSTypeAliasDeclaration(declaration)) &&
                declaration.id.name === `${componentName}Props`
            )
        }),

        t.exportNamedDeclaration(
            createPropsInterface(
                componentName,
                props,
                emitInfo,
            ),
        ),

        t.exportNamedDeclaration(
            createComponent(
                componentName,
                props,
                emitInfo,
                jsxElement,
                options.componentStatements ?? [],
            ),
        ),
    ])

    const ast = t.file(program)

    return generate(ast, {
        comments: false,
        retainLines: false,
        concise: false,
        jsescOption: {
            minimal: true,
        },
    }).code
}
