import { parseExpression as parseBabelExpression } from '@babel/parser'
import * as t from '@babel/types'
import {
    ElementTypes,
    NodeTypes,
    baseParse,
    type ElementNode,
    type RootNode,
    type SimpleExpressionNode,
    type TemplateChildNode,
} from '@vue/compiler-dom'
import type { ComposableState } from './composables/types.js'
import { transformVueExpression } from './expressions.js'

type JSXChildNode =
    | t.JSXText
    | t.JSXExpressionContainer
    | t.JSXSpreadChild
    | t.JSXElement
    | t.JSXFragment

export function eventNameToReactProp(
    eventName: string,
): string {
    const normalized = eventName
        .split(/[-:]/g)
        .filter(Boolean)
        .map(
            (part) =>
                part.charAt(0).toUpperCase() +
                part.slice(1),
        )
        .join('')

    return `on${normalized}`
}

function parseExpression(
    expression: string,
): t.Expression {
    return parseBabelExpression(expression, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
    }) as t.Expression
}

function getExpressionContent(
    expression: SimpleExpressionNode | undefined,
): string | null {
    return expression?.content ?? null
}

function isEmitCall(
    expression: t.Expression,
    emitVariableName: string | null,
): expression is t.CallExpression {
    if (!emitVariableName) {
        return false
    }

    return (
        t.isCallExpression(expression) &&
        t.isIdentifier(expression.callee) &&
        expression.callee.name === emitVariableName &&
        expression.arguments.length > 0 &&
        t.isStringLiteral(expression.arguments[0])
    )
}

function createEmitHandler(
    eventName: string,
): t.ArrowFunctionExpression {
    const callbackPropName = eventNameToReactProp(eventName)

    return t.arrowFunctionExpression(
        [],
        t.optionalCallExpression(
            t.identifier(callbackPropName),
            [],
            true,
        ),
    )
}

function transformElement(
    node: ElementNode,
    emitVariableName: string | null,
    states: Map<string, ComposableState>,
): t.JSXElement {
    const attributes: Array<
        t.JSXAttribute | t.JSXSpreadAttribute
    > = []

    for (const prop of node.props) {
        if (prop.type === NodeTypes.ATTRIBUTE) {
            attributes.push(
                t.jsxAttribute(
                    t.jsxIdentifier(prop.name),
                    prop.value
                        ? t.stringLiteral(prop.value.content)
                        : null,
                ),
            )

            continue
        }

        if (
            prop.type === NodeTypes.DIRECTIVE &&
            prop.name === 'bind' &&
            prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION
        ) {
            const expressionContent = getExpressionContent(
                prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION
                    ? prop.exp
                    : undefined,
            )

            const value = expressionContent
                ? transformVueExpression(
                    parseExpression(expressionContent),
                    states,
                    'VueTemplate',
                )
                : t.booleanLiteral(true)

            attributes.push(
                t.jsxAttribute(
                    t.jsxIdentifier(prop.arg.content),
                    t.jsxExpressionContainer(value),
                ),
            )

            continue
        }

        if (
            prop.type === NodeTypes.DIRECTIVE &&
            prop.name === 'on' &&
            prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION
        ) {
            const expressionContent = getExpressionContent(
                prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION
                    ? prop.exp
                    : undefined,
            )

            if (!expressionContent) {
                throw new Error(
                    `Event "@${prop.arg.content}" has no expression`,
                )
            }

            const vueEventName = prop.arg.content
            const reactEventName =
                eventNameToReactProp(vueEventName)

            const expression = transformVueExpression(
                parseExpression(expressionContent),
                states,
                'VueTemplate',
            )

            const value = isEmitCall(expression, emitVariableName)
                ? createEmitHandler(
                    (expression.arguments[0] as t.StringLiteral).value,
                )
                : t.isArrowFunctionExpression(expression) ||
                    t.isFunctionExpression(expression) ||
                    t.isIdentifier(expression) ||
                    t.isMemberExpression(expression)
                    ? expression
                    : t.arrowFunctionExpression([], expression)

            attributes.push(
                t.jsxAttribute(
                    t.jsxIdentifier(reactEventName),
                    t.jsxExpressionContainer(value),
                ),
            )

            continue
        }

        const directiveName =
            prop.type === NodeTypes.DIRECTIVE
                ? prop.name
                : 'unknown'

        throw new Error(
            `Unsupported Vue directive: ${directiveName}`,
        )
    }

    const children = node.children
        .map((child) =>
            transformTemplateChild(child, emitVariableName, states),
        )
        .filter(
            (child): child is JSXChildNode =>
                child !== null,
        )

    const selfClosing = children.length === 0

    return t.jsxElement(
        t.jsxOpeningElement(
            t.jsxIdentifier(node.tag),
            attributes,
            selfClosing,
        ),
        selfClosing
            ? null
            : t.jsxClosingElement(
                t.jsxIdentifier(node.tag),
            ),
        children,
        selfClosing,
    )
}

function transformTemplateChild(
    node: TemplateChildNode,
    emitVariableName: string | null,
    states: Map<string, ComposableState>,
): JSXChildNode | null {
    if (node.type === NodeTypes.TEXT) {
        const text = node.content.replace(/\s+/g, ' ')

        return text.trim()
            ? t.jsxText(text)
            : null
    }

    if (node.type === NodeTypes.INTERPOLATION) {
        if (
            node.content.type !==
            NodeTypes.SIMPLE_EXPRESSION
        ) {
            throw new Error(
                'Only simple interpolation expressions are supported',
            )
        }

        return t.jsxExpressionContainer(
            transformVueExpression(
                parseExpression(node.content.content),
                states,
                'VueTemplate',
            ),
        )
    }

    if (
        node.type === NodeTypes.ELEMENT &&
        node.tagType === ElementTypes.ELEMENT
    ) {
        return transformElement(node, emitVariableName, states)
    }

    throw new Error(
        `Unsupported template node type: ${node.type}`,
    )
}

export function parseAndTransformTemplate(
    templateSource: string,
    emitVariableName: string | null,
    states: Map<string, ComposableState> = new Map(),
): t.JSXElement {
    const templateAst: RootNode = baseParse(templateSource)

    const children = templateAst.children
        .map((child) =>
            transformTemplateChild(child, emitVariableName, states),
        )
        .filter(
            (child): child is JSXChildNode =>
                child !== null,
        )

    if (
        children.length !== 1 ||
        !t.isJSXElement(children[0])
    ) {
        throw new Error(
            'Only one root HTML element is supported in this version',
        )
    }

    return children[0]
}