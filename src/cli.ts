import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
    convertReactToVue,
    convertVueToReact,
} from './index.js'

function printUsage(): void {
    console.log(`
        Usage:
          vue-to-react-ast <input.vue|input.tsx> [output] [--name ComponentName]
        
        Examples:
          vue-to-react-ast ./examples/Button.vue
          vue-to-react-ast ./Button.vue ./Button.tsx
          vue-to-react-ast ./Button.vue ./Button.tsx --name AppButton
          vue-to-react-ast ./Button.tsx
          vue-to-react-ast ./Button.tsx ./Button.vue
        `.trim())
}

function getOptionValue(
    args: string[],
    optionName: string,
): string | undefined {
    const index = args.indexOf(optionName)

    if (index === -1) {
        return undefined
    }

    return args[index + 1]
}

async function main(): Promise<void> {
    const args = process.argv.slice(2)

    if (
        args.length === 0 ||
        args.includes('--help') ||
        args.includes('-h')
    ) {
        printUsage()
        process.exit(args.length === 0 ? 1 : 0)
    }

    const input = args[0]

    if (!input) {
        printUsage()
        process.exit(1)
    }

    const positionalOutput = args.find(
        (arg, index) =>
            index > 0 &&
            !arg.startsWith('-') &&
            args[index - 1] !== '--name',
    )

    const isReactInput = /\.(?:tsx|jsx)$/i.test(input)
    const output =
        positionalOutput ??
        input.replace(
            isReactInput ? /\.(?:tsx|jsx)$/i : /\.vue$/i,
            isReactInput ? '.vue' : '.tsx',
        )

    const componentName = getOptionValue(args, '--name')

    const inputPath = resolve(input)
    const outputPath = resolve(output)
    const source = await readFile(inputPath, 'utf8')

    const result = isReactInput
        ? convertReactToVue(source, { componentName })
        : convertVueToReact(source, { componentName })

    await writeFile(outputPath, `${result.code}\n`, 'utf8')

    console.log(
        [
            `Converted: ${basename(inputPath)}`,
            `Output: ${outputPath}`,
            `Component: ${result.componentName}`,
            `Props: ${result.props.map((prop) => prop.name).join(', ') || 'none'}`,
            `Emits: ${result.emits.join(', ') || 'none'}`,
        ].join('\n'),
    )
}

main().catch((error: unknown) => {
    const message =
        error instanceof Error
            ? error.stack ?? error.message
            : String(error)

    console.error(message)
    process.exit(1)
})