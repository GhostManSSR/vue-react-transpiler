import * as t from '@babel/types'
import { printNode } from './expressions.js'
import { transformExpression } from './expressions.js'
import type { StateBinding } from './hooks/use-state.js'

export function getTagName(
    name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName,
): string {
    if (t.isJSXNamespacedName(name)) {
        throw new Error('Namespaced JSX elements are not supported')
    }
    return printNode(name)
}

export function escapeAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
}

export function escapeText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/\{\{/g, '&#123;&#123;')
}

export function normalizeText(value: string): string {
    const lines = value.replace(/\r\n?/g, '\n').split('\n')
    const parts: string[] = []
    for (let index = 0; index < lines.length; index += 1) {
        let line = lines[index]?.replace(/\t/g, ' ') ?? ''
        if (index > 0) line = line.trimStart()
        if (index < lines.length - 1) line = line.trimEnd()
        if (line) parts.push(line)
    }
    return parts.join(' ')
}

export function eventName(name: string): string | null {
    if (!/^on[A-Z]/.test(name)) return null
    const nativeName = name.slice(2)
    if (nativeName === 'DoubleClick') return 'dblclick'
    return nativeName.toLowerCase()
}

function transformAttribute(
    attribute: t.JSXAttribute | t.JSXSpreadAttribute,
    states: Map<string, StateBinding>,
    componentName: string,
): string {
    if (t.isJSXSpreadAttribute(attribute)) {
        const expression = transformExpression(
            attribute.argument,
            states,
            'template',
            componentName,
        )
        return `v-bind="${escapeAttribute(printNode(expression))}"`
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
    if (attribute.value === null) return name
    if (t.isStringLiteral(attribute.value)) {
        return `${name}="${escapeAttribute(attribute.value.value)}"`
    }
    if (!t.isJSXExpressionContainer(attribute.value)) {
        throw new Error(`Unsupported JSX attribute value for "${originalName}"`)
    }
    const expression = attribute.value.expression
    if (t.isJSXEmptyExpression(expression)) return ''
    const binding = listener ? name : `:${name}`
    const transformed = transformExpression(
        expression,
        states,
        'template',
        componentName,
    )
    return `${binding}="${escapeAttribute(printNode(transformed))}"`
}

function transformChild(
    child: t.JSXElement['children'][number],
    states: Map<string, StateBinding>,
    componentName: string,
): string {
    if (t.isJSXText(child)) {
        return escapeText(normalizeText(child.value))
    }
    if (t.isJSXExpressionContainer(child)) {
        if (t.isJSXEmptyExpression(child.expression)) return ''
        const expression = transformExpression(
            child.expression,
            states,
            'template',
            componentName,
        )
        return `{{ ${printNode(expression)} }}`
    }
    if (t.isJSXElement(child)) {
        return transformElement(child, states, componentName)
    }
    throw new Error('JSX fragments and spread children are not supported')
}

export function transformElement(
    element: t.JSXElement,
    states: Map<string, StateBinding>,
    componentName: string,
): string {
    const tag = getTagName(element.openingElement.name)
    const attributes = element.openingElement.attributes
        .map((attribute) => transformAttribute(attribute, states, componentName))
        .filter(Boolean)
    const opening = `<${tag}${attributes.length ? ` ${attributes.join(' ')}` : ''}`
    const children = element.children
        .map((child) => transformChild(child, states, componentName))
        .join('')
    if (element.openingElement.selfClosing && !children) return `${opening} />`
    return `${opening}>${children}</${tag}>`
}
