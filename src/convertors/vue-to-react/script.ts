import { parse } from '@babel/parser'
import * as t from '@babel/types'
import type { NodePath } from '@babel/traverse'
import { traverse } from '../../utils/babel.js'
import type { EmitInfo } from '../../types.js'
import {
    assertSynchronousComposableCallback,
    convertComputed,
    convertLifecycle,
    convertNextTick,
    convertReactive,
    convertRef,
    convertWatch,
    convertWatchEffect,
    type ComposableState,
} from './composables/index.js'
import {
    transformVueExpression,
    transformVueStatement,
} from './expressions.js'
import { eventNameToReactProp } from './template.js'

const lifecycleHooks = new Set([
    'onMounted',
    'onBeforeMount',
    'onUpdated',
    'onUnmounted',
    'onBeforeUnmount',
])
const supportedVueComposables = new Set([
    'ref',
    'reactive',
    'computed',
    'watch',
    'watchEffect',
    'nextTick',
    ...lifecycleHooks,
])

export interface VueScriptResult {
    moduleStatements: t.Statement[]
    componentStatements: t.Statement[]
    states: Map<string, ComposableState>
    diagnostics: Array<{
        componentName: string
        construct: string
        message: string
        severity: 'warning' | 'error'
    }>
}

function fail(componentName: string, construct: string, message: string): never {
    throw new Error(`${componentName}: ${construct} - ${message}`)
}

function getCalleeName(
    node: t.Node | null | undefined,
    importedNames: Map<string, string>,
    namespaceImports: Set<string>,
): string | null {
    if (!node || !t.isCallExpression(node)) return null
    if (t.isIdentifier(node.callee)) {
        return importedNames.get(node.callee.name) ??
            (supportedVueComposables.has(node.callee.name) ? node.callee.name : null)
    }
    if (
        t.isMemberExpression(node.callee) &&
        !node.callee.computed &&
        t.isIdentifier(node.callee.object) &&
        namespaceImports.has(node.callee.object.name) &&
        t.isIdentifier(node.callee.property)
    ) {
        return node.callee.property.name
    }
    return null
}

function getDeclaratorName(
    declaration: t.VariableDeclarator,
    componentName: string,
): string {
    if (!t.isIdentifier(declaration.id)) {
        fail(componentName, 'Vue composable', 'composables must be assigned to a single identifier')
    }
    return declaration.id.name
}

function getSetterName(name: string, states: Map<string, ComposableState>): string {
    const setter = `set${name.charAt(0).toUpperCase()}${name.slice(1)}`
    if ([...states.values()].some((state) => state.setter === setter)) {
        throw new Error(`State setter name collision: ${setter}`)
    }
    return setter
}

function collectVueImports(
    program: t.Program,
    importedNames: Map<string, string>,
    namespaceImports: Set<string>,
): void {
    for (const statement of program.body) {
        if (!t.isImportDeclaration(statement) || statement.source.value !== 'vue') continue
        for (const specifier of statement.specifiers) {
            if (t.isImportNamespaceSpecifier(specifier)) {
                namespaceImports.add(specifier.local.name)
                continue
            }
            if (t.isImportDefaultSpecifier(specifier)) {
                namespaceImports.add(specifier.local.name)
                continue
            }
            if (!t.isImportSpecifier(specifier) || !t.isIdentifier(specifier.imported)) continue
            const imported = specifier.imported.name
            if (supportedVueComposables.has(imported)) {
                importedNames.set(specifier.local.name, imported)
            }
        }
    }
}

function validateNamespaceCalls(
    program: t.Program,
    namespaceImports: Set<string>,
    componentName: string,
): void {
    traverse(t.file(program), {
        MemberExpression(path: NodePath<t.MemberExpression>) {
            const { object, property, computed } = path.node
            if (
                !t.isIdentifier(object) ||
                !namespaceImports.has(object.name)
            ) return
            const member = !computed && t.isIdentifier(property)
                ? property.name
                : null
            if (!member || !supportedVueComposables.has(member)) {
                fail(
                    componentName,
                    'Vue namespace access',
                    'only the listed Vue composables can be translated',
                )
            }
        },
    })
}

function isMacroCall(
    node: t.Node | null | undefined,
    macroName: 'defineProps' | 'defineEmits',
): boolean {
    return t.isCallExpression(node) &&
        t.isIdentifier(node.callee, { name: macroName })
}

function transformScriptCalls(
    statement: t.Statement,
    componentName: string,
    importedNames: Map<string, string>,
    namespaceImports: Set<string>,
    emitInfo: EmitInfo | null,
    diagnostics: VueScriptResult['diagnostics'],
): t.Statement {
    const clone = t.cloneNode(statement, true)
    const file = t.file(t.program([clone]))
    traverse(file, {
        CallExpression(path: NodePath<t.CallExpression>) {
            const name = getCalleeName(path.node, importedNames, namespaceImports)
            if (name === 'nextTick') {
                diagnostics.push({
                    componentName,
                    construct: 'nextTick',
                    message: 'Mapped to a Promise microtask; code relying on Vue DOM flush timing needs manual review.',
                    severity: 'warning',
                })
                path.replaceWith(convertNextTick(path.node))
                path.skip()
                return
            }
            if (
                emitInfo &&
                t.isIdentifier(path.node.callee, { name: emitInfo.variableName })
            ) {
                const eventArgument = path.node.arguments[0]
                if (
                    path.node.arguments.length !== 1 ||
                    !eventArgument ||
                    !t.isStringLiteral(eventArgument)
                ) {
                    fail(
                        emitInfo.variableName,
                        'emit',
                        'only event names without payload arguments are supported',
                    )
                }
                if (!emitInfo.events.includes(eventArgument.value)) {
                    fail(
                        emitInfo.variableName,
                        eventArgument.value,
                        'event is not declared in defineEmits',
                    )
                }
                path.replaceWith(
                    t.optionalCallExpression(
                        t.identifier(eventNameToReactProp(eventArgument.value)),
                        [],
                        true,
                    ),
                )
                path.skip()
            }
        },
    })
    return file.program.body[0] as t.Statement
}

function transformComposableDeclaration(
    name: string,
    declarationName: string,
    call: t.CallExpression,
    context: {
        componentName: string
        states: Map<string, ComposableState>
        diagnostics: VueScriptResult['diagnostics']
    },
): t.Statement {
    const { componentName, states } = context
    const initialValue = call.arguments[0]
    if (initialValue && t.isSpreadElement(initialValue)) {
        fail(componentName, name, 'spread arguments are not supported')
    }

    if (name === 'ref' || name === 'reactive') {
        if (
            call.arguments.length > 1 ||
            (initialValue && !t.isExpression(initialValue))
        ) {
            fail(componentName, name, 'expected at most one expression initializer')
        }
        if (name === 'reactive' && !initialValue) {
            fail(componentName, name, 'an object initializer is required')
        }
        if (
            name === 'reactive' &&
            initialValue &&
            !t.isObjectExpression(initialValue)
        ) {
            fail(componentName, name, 'only object literal initializers are supported')
        }
        const setter = states.get(declarationName)?.setter ??
            getSetterName(declarationName, states)
        states.set(declarationName, {
            name: declarationName,
            setter,
            kind: name,
        })
        return name === 'ref'
            ? convertRef(
                declarationName,
                setter,
                initialValue && t.isExpression(initialValue)
                    ? initialValue
                    : t.identifier('undefined'),
            )
            : convertReactive(declarationName, setter, initialValue as t.Expression)
    }

    if (name === 'computed') {
        context.diagnostics.push({
            componentName,
            construct: name,
            message: 'Recalculated on each React render to avoid stale dependencies; memoization and object identity can differ.',
            severity: 'warning',
        })
        if (
            call.arguments.length !== 1 ||
            !initialValue ||
            !t.isExpression(initialValue)
        ) {
            fail(componentName, 'computed', 'expected a getter function')
        }
        if (
            !t.isArrowFunctionExpression(initialValue) &&
            !t.isFunctionExpression(initialValue)
        ) {
            fail(componentName, 'computed', 'expected a getter function')
        }
        if (initialValue.params.length > 0 || initialValue.async) {
            fail(componentName, 'computed', 'getter must be synchronous and have no parameters')
        }
        let getter = t.cloneNode(initialValue, true)
        if (t.isArrowFunctionExpression(getter) || t.isFunctionExpression(getter)) {
            if (t.isBlockStatement(getter.body)) {
                getter.body.body = getter.body.body.map((statement) =>
                    transformVueStatement(statement, states, componentName),
                )
            } else if (t.isExpression(getter.body)) {
                getter.body = transformVueExpression(
                    getter.body,
                    states,
                    componentName,
                )
            } else {
                fail(componentName, 'computed', 'getter body is not supported')
            }
        }
        states.set(declarationName, {
            name: declarationName,
            setter: '',
            kind: 'computed',
        })
        return convertComputed(declarationName, getter)
    }

    return fail(componentName, name, 'unsupported composable')
}

function transformCallStatement(
    statement: t.ExpressionStatement,
    name: string,
    call: t.CallExpression,
    states: Map<string, ComposableState>,
    componentName: string,
    watchIndex: number,
    lifecycleIndex: number,
    diagnostics: VueScriptResult['diagnostics'],
): t.Statement[] {
    if (name === 'watch') {
        return convertWatch(
            call,
            states,
            componentName,
            watchIndex,
        )
    }
    if (name === 'watchEffect') {
        if (call.arguments.length !== 1) {
            fail(componentName, name, 'expected exactly one callback argument')
        }
        diagnostics.push({
            componentName,
            construct: name,
            message: 'Translated to a post-render effect without a dependency list; unrelated renders can rerun it.',
            severity: 'warning',
        })
        assertSynchronousComposableCallback(call.arguments[0], componentName, name)
        return [
            transformVueStatement(
                convertWatchEffect(call.arguments[0], states, componentName),
                states,
                componentName,
            ),
        ]
    }
    if (lifecycleHooks.has(name)) {
        if (call.arguments.length !== 1) {
            fail(componentName, name, 'expected exactly one callback argument')
        }
        if (name === 'onBeforeMount') {
            fail(componentName, name, 'React has no equivalent that runs before the first DOM commit')
        }
        assertSynchronousComposableCallback(call.arguments[0], componentName, name)
        if (name === 'onMounted' || name === 'onUpdated') {
            diagnostics.push({
                componentName,
                construct: name,
                message: 'Mapped to a React effect; lifecycle timing differs from Vue.',
                severity: 'warning',
            })
        }
        if (name === 'onUnmounted') {
            diagnostics.push({
                componentName,
                construct: name,
                message: 'Scheduled after React effect cleanup with a microtask; unmount timing can differ.',
                severity: 'warning',
            })
        }
        return convertLifecycle(
            name,
            call.arguments[0],
            componentName,
            lifecycleIndex,
        ).map((statement) =>
            transformVueStatement(
                statement,
                states,
                componentName,
            ),
        )
    }
    return [transformVueStatement(statement, states, componentName)]
}

export function convertVueScript(
    source: string,
    componentName: string,
    emitInfo: EmitInfo | null = null,
): VueScriptResult {
    const ast = parse(source, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
    })
    traverse(ast, {
        AwaitExpression(path: NodePath<t.AwaitExpression>) {
            if (!path.getFunctionParent()) {
                fail(
                    componentName,
                    'async setup',
                    'top-level await cannot be moved into a synchronous React component',
                )
            }
        },
    })
    const importedNames = new Map<string, string>()
    const namespaceImports = new Set<string>()
    collectVueImports(ast.program, importedNames, namespaceImports)
    validateNamespaceCalls(ast.program, namespaceImports, componentName)
    const diagnostics: VueScriptResult['diagnostics'] = []

    const states = new Map<string, ComposableState>()
    for (const statement of ast.program.body) {
        if (!t.isVariableDeclaration(statement)) continue
        for (const declaration of statement.declarations) {
            const name = getCalleeName(declaration.init, importedNames, namespaceImports)
            if (name && ['ref', 'reactive', 'computed'].includes(name)) {
                const variableName = getDeclaratorName(declaration, componentName)
                states.set(variableName, {
                    name: variableName,
                    setter: '',
                    kind: name as ComposableState['kind'],
                })
            }
        }
    }
    for (const [name, state] of states) {
        if (state.kind === 'ref' || state.kind === 'reactive') {
            states.set(name, { ...state, setter: getSetterName(name, states) })
        }
    }

    const moduleStatements: t.Statement[] = []
    const componentStatements: t.Statement[] = []
    let watchIndex = 0
    let lifecycleIndex = 0
    for (const statement of ast.program.body) {
        if (t.isImportDeclaration(statement) && statement.source.value === 'vue') {
            const remaining = statement.specifiers.filter((specifier) => {
                if (t.isImportDefaultSpecifier(specifier) ||
                    t.isImportNamespaceSpecifier(specifier)) {
                    return false
                }
                if (!t.isImportSpecifier(specifier) || !t.isIdentifier(specifier.imported)) {
                    return true
                }
                return !supportedVueComposables.has(specifier.imported.name)
            })
            if (remaining.length > 0) {
                const unknown = remaining.find((specifier) =>
                    t.isImportSpecifier(specifier) &&
                    t.isIdentifier(specifier.imported) &&
                    specifier.importKind !== 'type',
                )
                if (unknown) {
                    fail(
                        componentName,
                        'Vue import',
                        'Vue runtime imports outside the supported composables cannot be emitted in React',
                    )
                }
                moduleStatements.push(t.importDeclaration(remaining, statement.source))
            }
            continue
        }
        if (t.isImportDeclaration(statement)) {
            moduleStatements.push(statement)
            continue
        }

        const statements = t.isVariableDeclaration(statement)
            ? statement.declarations.flatMap((declaration): t.Statement[] => {
                if (isMacroCall(declaration.init, 'defineProps') ||
                    isMacroCall(declaration.init, 'defineEmits')) {
                    return []
                }
                const composableName = getCalleeName(
                    declaration.init,
                    importedNames,
                    namespaceImports,
                )
                if (
                    composableName &&
                    ['ref', 'reactive', 'computed'].includes(composableName)
                ) {
                    const generated = transformComposableDeclaration(
                        composableName,
                        getDeclaratorName(declaration, componentName),
                        declaration.init as t.CallExpression,
                        { componentName, states, diagnostics },
                    )
                    return [generated]
                }
                const single = t.variableDeclaration(statement.kind, [t.cloneNode(declaration, true)])
                const tickTransformed = transformScriptCalls(
                    single,
                    componentName,
                    importedNames,
                    namespaceImports,
                    emitInfo,
                    diagnostics,
                )
                return [transformVueStatement(tickTransformed, states, componentName)]
            })
            : [statement]

        for (const item of statements) {
            if (t.isExpressionStatement(item) && t.isCallExpression(item.expression)) {
                const composableName = getCalleeName(
                    item.expression,
                    importedNames,
                    namespaceImports,
                )
                if (
                    composableName &&
                    ['watch', 'watchEffect', ...lifecycleHooks].includes(composableName)
                ) {
                    const translatedStatements = transformCallStatement(
                            item,
                            composableName,
                            item.expression,
                            states,
                            componentName,
                            watchIndex,
                            lifecycleIndex,
                            diagnostics,
                        )
                    componentStatements.push(
                        ...translatedStatements.map((translated) =>
                            transformScriptCalls(
                                translated,
                                componentName,
                                importedNames,
                                namespaceImports,
                                emitInfo,
                                diagnostics,
                            ),
                        ),
                    )
                    if (composableName === 'watch') watchIndex += 1
                    if (lifecycleHooks.has(composableName)) lifecycleIndex += 1
                    continue
                }
            }
            const nextTickTransformed = transformScriptCalls(
                item,
                componentName,
                importedNames,
                namespaceImports,
                emitInfo,
                diagnostics,
            )
            const reactiveTransformed =
                t.isImportDeclaration(nextTickTransformed)
                    ? nextTickTransformed
                    : transformVueStatement(
                        nextTickTransformed,
                        states,
                        componentName,
                    )

            if (
                t.isExportNamedDeclaration(reactiveTransformed) ||
                t.isExportDefaultDeclaration(reactiveTransformed)
            ) {
                moduleStatements.push(reactiveTransformed)
            } else {
                componentStatements.push(reactiveTransformed)
            }
        }
    }

    return { moduleStatements, componentStatements, states, diagnostics }
}
