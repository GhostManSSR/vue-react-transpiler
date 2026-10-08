import { parse } from '@babel/parser'
import * as t from '@babel/types'
import type { PropInfo } from '../types.js'
import { generate } from '../utils/babel.js'

interface ComponentInfo {
    name: string
    propsTypeName: string | null
    parameter: t.Identifier | t.ObjectPattern | null
    bodyStatements: t.Statement[]
    render: t.JSXElement
}

function printNode(node: t.Node): string {
    return generate(node, {
        comments: false,
        retainLines: false,
        concise: false,
    }).code
}

function getTypeName(
    annotation: t.Node | null | undefined,
): string | null {
    if (
        !annotation ||
        !t.isTSTypeAnnotation(annotation) ||
        !t.isTSTypeReference(annotation.typeAnnotation)
    ) {
        return null
    }

    const { typeName } = annotation.typeAnnotation

    return t.isIdentifier(typeName) ? typeName.name : null
}

function getPropsTypeName(declaration: t.VariableDeclarator, parameter: t.Identifier | t.ObjectPattern | null): string | null {
    const parameterType = getTypeName(parameter?.typeAnnotation)

    if (parameterType) {
        return parameterType
    }

    if (
        t.isIdentifier(declaration.id) &&
        declaration.id.typeAnnotation &&
        t.isTSTypeAnnotation(declaration.id.typeAnnotation) &&
        t.isTSTypeReference(declaration.id.typeAnnotation.typeAnnotation)
    ) {
        const componentType = declaration.id.typeAnnotation.typeAnnotation

        if (t.isTSQualifiedName(componentType.typeName) && componentType.typeName.right.name === 'FC') {
            const typeArgument = componentType.typeParameters?.params[0]

            if (typeArgument && t.isTSTypeReference(typeArgument) && t.isIdentifier(typeArgument.typeName)) {
                return typeArgument.typeName.name
            }
        }
    }

    return null
}

function getComponent(program: t.Program): ComponentInfo {
    for (const statement of program.body) {
        if (!t.isExportNamedDeclaration(statement) || !t.isVariableDeclaration(statement.declaration)) {
            continue
        }

        for (const declaration of statement.declaration.declarations) {
            if (
                !t.isIdentifier(declaration.id) ||
                !declaration.init ||
                (!t.isArrowFunctionExpression(declaration.init) &&
                    !t.isFunctionExpression(declaration.init))
            ) {
                continue
            }

            const component = declaration.init
            const parameter = component.params[0]
            const propsParameter = parameter &&
                (t.isIdentifier(parameter) || t.isObjectPattern(parameter))
                    ? parameter
                    : null

            if (parameter && !propsParameter) {
                throw new Error(
                    'React component props must use an identifier or object destructuring',
                )
            }

            const bodyStatements: t.Statement[] = []
            let render: t.JSXElement | null = null

            if (t.isJSXElement(component.body)) {
                render = component.body
            } else if (t.isBlockStatement(component.body)) {
                for (const bodyStatement of component.body.body) {
                    if (
                        t.isReturnStatement(bodyStatement) &&
                        bodyStatement.argument &&
                        t.isJSXElement(bodyStatement.argument)
                    ) {
                        if (render) {
                            throw new Error(
                                'Only one JSX return per React component is supported',
                            )
                        }

                        render = bodyStatement.argument
                        continue
                    }

                    if (
                        t.isReturnStatement(bodyStatement) ||
                        !t.isVariableDeclaration(bodyStatement)
                    ) {
                        throw new Error(
                            'Only local variable declarations and one JSX return are supported in a React component body',
                        )
                    }

                    let containsHookCall = false
                    t.traverseFast(bodyStatement, (node) => {
                        if (
                            t.isCallExpression(node) &&
                            t.isIdentifier(node.callee) &&
                            /^use[A-Z]/.test(node.callee.name)
                        ) {
                            containsHookCall = true
                        }
                    })

                    if (containsHookCall) {
                        throw new Error(
                            'React hooks are not supported; move component state and effects to Vue APIs before converting',
                        )
                    }

                    bodyStatements.push(bodyStatement)
                }
            }

            if (!render) {
                throw new Error(
                    `React component "${declaration.id.name}" must return one JSX element`,
                )
            }

            return {
                name: declaration.id.name,
                propsTypeName: getPropsTypeName(declaration, propsParameter),
                parameter: propsParameter,
                bodyStatements,
                render,
            }
        }
    }

    throw new Error('Unable to find an exported React function component')
}

function getProps(
    program: t.Program,
    propsTypeName: string | null,
): PropInfo[] {
    if (!propsTypeName) {
        return []
    }

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

    if (
        declaration &&
        t.isTSInterfaceDeclaration(declaration)
    ) {
        members = declaration.body.body
    } else if (
        declaration &&
        t.isTSTypeAliasDeclaration(declaration) &&
        t.isTSTypeLiteral(declaration.typeAnnotation)
    ) {
        members = declaration.typeAnnotation.members
    }

    if (!members) {
        return []
    }

    const props: PropInfo[] = []

    for (const member of members) {
        if (!t.isTSPropertySignature(member)) {
            continue
        }

        const name = t.isIdentifier(member.key)
            ? member.key.name
            : t.isStringLiteral(member.key)
                ? member.key.value
                : null

        if (!name || !member.typeAnnotation) {
            continue
        }

        props.push({
            name,
            optional: member.optional === true,
            type: member.typeAnnotation.typeAnnotation,
        })
    }

    return props
}

function getTagName(
    name:
        | t.JSXIdentifier
        | t.JSXMemberExpression
        | t.JSXNamespacedName,
): string {
    if (t.isJSXNamespacedName(name)) {
        throw new Error('Namespaced JSX elements are not supported')
    }

    return printNode(name)
}

function escapeAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
}

function escapeText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/\{\{/g, '&#123;&#123;')
}

function normalizeText(value: string): string {
    const lines = value.replace(/\r\n?/g, '\n').split('\n')
    const parts: string[] = []

    for (let index = 0; index < lines.length; index += 1) {
        let line = lines[index]?.replace(/\t/g, ' ') ?? ''

        if (index > 0) {
            line = line.trimStart()
        }

        if (index < lines.length - 1) {
            line = line.trimEnd()
        }

        if (line) {
            parts.push(line)
        }
    }

    return parts.join(' ')
}

function eventName(name: string): string | null {
    if (!/^on[A-Z]/.test(name)) {
        return null
    }

    const nativeName = name.slice(2)

    if (nativeName === 'DoubleClick') {
        return 'dblclick'
    }

    return nativeName.toLowerCase()
}

function transformAttribute(
    attribute: t.JSXAttribute | t.JSXSpreadAttribute,
): string {
    if (t.isJSXSpreadAttribute(attribute)) {
        return `v-bind="${escapeAttribute(printNode(attribute.argument))}"`
    }

    if (!t.isJSXIdentifier(attribute.name)) {
        throw new Error('Namespaced JSX attributes are not supported')
    }

    const originalName = attribute.name.name
    const listener = eventName(originalName)
    const name = listener
        ? `@${listener}`
        : originalName === 'className'
            ? 'class'
            : originalName === 'htmlFor'
                ? 'for'
                : originalName

    if (attribute.value === null) {
        return name
    }

    if (t.isStringLiteral(attribute.value)) {
        return `${name}="${escapeAttribute(attribute.value.value)}"`
    }

    if (!t.isJSXExpressionContainer(attribute.value)) {
        throw new Error(`Unsupported JSX attribute value for "${originalName}"`)
    }

    const expression = attribute.value.expression

    if (t.isJSXEmptyExpression(expression)) {
        return ''
    }

    const binding = listener ? name : `:${name}`

    return `${binding}="${escapeAttribute(printNode(expression))}"`
}

function transformChild(child: t.JSXElement['children'][number]): string {
    if (t.isJSXText(child)) {
        return escapeText(normalizeText(child.value))
    }

    if (t.isJSXExpressionContainer(child)) {
        if (t.isJSXEmptyExpression(child.expression)) {
            return ''
        }

        return `{{ ${printNode(child.expression)} }}`
    }

    if (t.isJSXElement(child)) {
        return transformElement(child)
    }

    throw new Error('JSX fragments and spread children are not supported')
}

function transformElement(element: t.JSXElement): string {
    const tag = getTagName(element.openingElement.name)
    const attributes = element.openingElement.attributes
        .map(transformAttribute)
        .filter(Boolean)
    const opening = `<${tag}${attributes.length ? ` ${attributes.join(' ')}` : ''}`
    const children = element.children.map(transformChild).join('')

    if (element.openingElement.selfClosing && !children) {
        return `${opening} />`
    }

    return `${opening}>${children}</${tag}>`
}

function isReactImport(statement: t.ImportDeclaration): boolean {
    return statement.source.value === 'react'
}

function createScript(
    program: t.Program,
    component: ComponentInfo,
): string {
    const declarations = program.body
        .filter((statement) => {
            if (
                t.isExportNamedDeclaration(statement) &&
                t.isVariableDeclaration(statement.declaration) &&
                statement.declaration.declarations.some(
                    (declaration) =>
                        t.isIdentifier(declaration.id) &&
                        declaration.id.name === component.name,
                )
            ) {
                return false
            }

            return true
        })
        .flatMap((statement) => {
            if (t.isImportDeclaration(statement) && isReactImport(statement)) {
                const specifiers = statement.specifiers.filter(
                    (specifier) =>
                        !t.isImportDefaultSpecifier(specifier) &&
                        !t.isImportNamespaceSpecifier(specifier),
                )

                if (specifiers.length === 0) {
                    return []
                }

                const importDeclaration = t.importDeclaration(
                    specifiers,
                    statement.source,
                )
                importDeclaration.importKind = statement.importKind
                return [printNode(importDeclaration)]
            }

            if (t.isExportNamedDeclaration(statement) && statement.declaration) {
                return [printNode(statement.declaration)]
            }

            return [printNode(statement)]
        })

    const parameterName = component.parameter
    let propsDeclaration: string | null = null

    if (parameterName && t.isObjectPattern(parameterName)) {
        const typeParameter = component.propsTypeName ? `<${component.propsTypeName}>` : ''

        propsDeclaration = `const ${printNode(parameterName)} = defineProps${typeParameter}();`
    } else if (parameterName && t.isIdentifier(parameterName)) {
        const typeParameter = component.propsTypeName ? `<${component.propsTypeName}>` : ''

        propsDeclaration = `const ${parameterName.name} = defineProps${typeParameter}();`
    } else if (component.propsTypeName) {
        propsDeclaration = `const props = defineProps<${component.propsTypeName}>();`
    }

    const setupStatements = component.bodyStatements.map(printNode)
    const content = [
        ...declarations,
        propsDeclaration,
        ...setupStatements,
    ].filter(Boolean)

    return `<script setup lang="ts">\n${content.join('\n\n')}\n</script>`
}

export interface ReactToVueOptions {
    componentName?: string
}

export interface ReactToVueResult {
    code: string
    componentName: string
    props: PropInfo[]
    emits: string[]
}

export function convertReactToVue(
    reactSource: string,
    options: ReactToVueOptions = {},
): ReactToVueResult {
    const ast = parse(reactSource, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
    })
    const component = getComponent(ast.program)
    const props = getProps(ast.program, component.propsTypeName)
    const name = options.componentName ?? component.name
    const template = transformElement(component.render)

    return {
        code: `${createScript(ast.program, component)}\n\n<template>\n  ${template}\n</template>`,
        componentName: name,
        props,
        emits: [],
    }
}
