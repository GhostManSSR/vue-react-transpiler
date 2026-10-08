import * as t from '@babel/types'
import { unsupported } from './hooks/unsupported.js'

export interface ComponentInfo {
    name: string
    propsTypeName: string | null
    parameter: t.Identifier | t.ObjectPattern | null
    bodyStatements: t.Statement[]
    render: t.JSXElement
}

function getTypeName(annotation: t.Node | null | undefined): string | null {
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

function getPropsTypeName(
    declaration:
        | t.FunctionDeclaration
        | t.VariableDeclarator,
    parameter: t.Identifier | t.ObjectPattern | null,
): string | null {
    // export function UserProfile(props: UserProfileProps)
    // или
    // function UserProfile(props: UserProfileProps)
    const parameterType = getTypeName(parameter?.typeAnnotation)

    if (parameterType) {
        return parameterType
    }

    // Для FunctionDeclaration больше ничего искать не нужно.
    if (t.isFunctionDeclaration(declaration)) {
        return null
    }

    // export const UserProfile: React.FC<UserProfileProps> = ...
    if (
        t.isIdentifier(declaration.id) &&
        declaration.id.typeAnnotation &&
        t.isTSTypeAnnotation(declaration.id.typeAnnotation) &&
        t.isTSTypeReference(
            declaration.id.typeAnnotation.typeAnnotation,
        )
    ) {
        const componentType =
            declaration.id.typeAnnotation.typeAnnotation

        if (
            t.isTSQualifiedName(componentType.typeName) &&
            componentType.typeName.right.name === 'FC'
        ) {
            const typeArgument =
                componentType.typeParameters?.params[0]

            if (
                typeArgument &&
                t.isTSTypeReference(typeArgument) &&
                t.isIdentifier(typeArgument.typeName)
            ) {
                return typeArgument.typeName.name
            }
        }
    }

    return null
}

export function getComponent(program: t.Program): ComponentInfo {
    let componentDeclaration:
        | t.FunctionDeclaration
        | t.VariableDeclarator
        | null = null

    let componentName: string | null = null

    // ---------------------------------------------------------
    // 1. export function UserProfile(...) { ... }
    // ---------------------------------------------------------
    for (const statement of program.body) {
        if (!t.isExportNamedDeclaration(statement)) {
            continue
        }

        const declaration = statement.declaration

        if (t.isFunctionDeclaration(declaration) && declaration.id) {
            componentDeclaration = declaration
            componentName = declaration.id.name
            break
        }

        // -----------------------------------------------------
        // 2. export const UserProfile = () => ...
        // -----------------------------------------------------
        if (t.isVariableDeclaration(declaration)) {
            for (const variable of declaration.declarations) {
                if (
                    t.isIdentifier(variable.id) &&
                    variable.init &&
                    (
                        t.isArrowFunctionExpression(variable.init) ||
                        t.isFunctionExpression(variable.init)
                    )
                ) {
                    componentDeclaration = variable
                    componentName = variable.id.name
                    break
                }
            }
        }

        if (componentDeclaration) {
            break
        }
    }

    // ---------------------------------------------------------
    // 3. const UserProfile = () => ...
    //    export default UserProfile
    // ---------------------------------------------------------
    if (!componentDeclaration) {
        let defaultExportName: string | null = null

        for (const statement of program.body) {
            if (!t.isExportDefaultDeclaration(statement)) {
                continue
            }

            const declaration = statement.declaration

            if (t.isIdentifier(declaration)) {
                defaultExportName = declaration.name
                break
            }

            if (t.isFunctionDeclaration(declaration) && declaration.id) {
                componentDeclaration = declaration
                componentName = declaration.id.name
                break
            }

            if (
                t.isArrowFunctionExpression(declaration) ||
                t.isFunctionExpression(declaration)
            ) {
                componentDeclaration = {
                    type: 'VariableDeclarator',
                    id: t.identifier('Component'),
                    init: declaration,
                }
                componentName = 'Component'
                break
            }
        }

        if (!componentDeclaration && defaultExportName) {
            for (const statement of program.body) {
                if (!t.isVariableDeclaration(statement)) {
                    continue
                }

                for (const variable of statement.declarations) {
                    if (
                        t.isIdentifier(variable.id) &&
                        variable.id.name === defaultExportName &&
                        variable.init &&
                        (
                            t.isArrowFunctionExpression(variable.init) ||
                            t.isFunctionExpression(variable.init)
                        )
                    ) {
                        componentDeclaration = variable
                        componentName = variable.id.name
                        break
                    }
                }

                if (componentDeclaration) {
                    break
                }

                // const Component = function ...
            }
        }
    }

    if (!componentDeclaration || !componentName) {
        throw new Error(
            'Unable to find an exported React function component',
        )
    }

    // ---------------------------------------------------------
    // Получаем саму функцию компонента
    // ---------------------------------------------------------
    let component:
        | t.FunctionDeclaration
        | t.ArrowFunctionExpression
        | t.FunctionExpression

    if (t.isFunctionDeclaration(componentDeclaration)) {
        component = componentDeclaration
    } else {
        const init = componentDeclaration.init

        if (
            !init ||
            (
                !t.isArrowFunctionExpression(init) &&
                !t.isFunctionExpression(init)
            )
        ) {
            throw new Error(
                `${componentName}: expected a React function component`,
            )
        }

        component = init
    }

    // ---------------------------------------------------------
    // Props
    // ---------------------------------------------------------
    const parameter = component.params[0]

    const propsParameter =
        parameter &&
        (t.isIdentifier(parameter) || t.isObjectPattern(parameter))
            ? parameter
            : null

    if (parameter && !propsParameter) {
        unsupported(
            componentName,
            'component props',
            'Props must use an identifier or object destructuring',
        )
    }

    // ---------------------------------------------------------
    // Body + JSX
    // ---------------------------------------------------------
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
                    unsupported(
                        componentName,
                        'JSX return',
                        'Only one JSX return per React component is supported',
                    )
                }

                render = bodyStatement.argument
                continue
            }

            if (
                !t.isVariableDeclaration(bodyStatement) &&
                !t.isExpressionStatement(bodyStatement)
            ) {
                unsupported(
                    componentName,
                    'component body',
                    'Only local variable declarations, supported hooks, and one JSX return are supported',
                )
            }

            bodyStatements.push(bodyStatement)
        }
    }

    if (!render) {
        unsupported(
            componentName,
            'JSX return',
            'Component must return one JSX element',
        )
    }

    return {
        name: componentName,
        propsTypeName: getPropsTypeName(
            componentDeclaration,
            propsParameter,
        ),
        parameter: propsParameter,
        bodyStatements,
        render,
    }
}
