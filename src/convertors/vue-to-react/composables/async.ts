import * as t from '@babel/types'

export function assertSynchronousComposableCallback(
    callback: t.Node | null | undefined,
    componentName: string,
    composableName: string,
): void {
    if (
        callback &&
        (t.isArrowFunctionExpression(callback) ||
            t.isFunctionExpression(callback)) &&
        callback.async
    ) {
        throw new Error(
            `${componentName}: ${composableName} - async callbacks cannot be represented by a React effect safely`,
        )
    }
}
