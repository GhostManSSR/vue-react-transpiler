import * as t from '@babel/types'
import { unsupported } from './unsupported.js'

export interface StateBinding {
    name: string
    setter: string
}

export function getHookName(node: t.Node | null | undefined): string | null {
    if (!node || !t.isCallExpression(node)) return null
    if (t.isIdentifier(node.callee)) return node.callee.name
    if (
        t.isMemberExpression(node.callee) &&
        !node.callee.computed &&
        t.isIdentifier(node.callee.object, { name: 'React' }) &&
        t.isIdentifier(node.callee.property)
    ) {
        return node.callee.property.name
    }
    return null
}

export function isHookCall(
    node: t.Node | null | undefined,
    hookName: string,
): node is t.CallExpression {
    return getHookName(node) === hookName
}

export function getStateBinding(
    declaration: t.VariableDeclarator,
    componentName: string,
): StateBinding | null {
    if (!isHookCall(declaration.init, 'useState')) return null
    const pattern = declaration.id
    const [value, setter] = t.isArrayPattern(pattern)
        ? pattern.elements
        : []
    if (
        !t.isArrayPattern(pattern) ||
        pattern.elements.length !== 2 ||
        !t.isIdentifier(value) ||
        !t.isIdentifier(setter) ||
        declaration.init.arguments.length !== 1 ||
        t.isSpreadElement(declaration.init.arguments[0])
    ) {
        unsupported(
            componentName,
            'useState',
            'Expected `const [value, setValue] = useState(initialValue)` with one initializer',
        )
    }
    return { name: value.name, setter: setter.name }
}
