import * as babelTraverse from '@babel/traverse'
import * as babelGenerator from '@babel/generator'

const traverseModule = babelTraverse.default as
    typeof babelTraverse.default & {
        default?: typeof babelTraverse.default
    }
const generatorModule = babelGenerator.default as
    typeof babelGenerator.default & {
        default?: typeof babelGenerator.default
    }

const traverse = traverseModule.default ?? traverseModule
const generate = generatorModule.default ?? generatorModule

export {
    traverse,
    generate,
}