import { readFileSync } from 'node:fs'
import {
    compileScript,
    compileTemplate,
    parse as parseSfc,
} from '@vue/compiler-sfc'
import { describe, expect, it } from 'vitest'
import {convertReactToVue, convertVueToReact} from '../src/index.js'

describe('convertVueToReact', () => {
    it('converts props, emit and template into React TSX', () => {
        const vueSource = `
        <script setup lang="ts">
        defineProps<{
          msg: string
          disabled: boolean
          type: 'button' | 'submit' | 'reset' | undefined
        }>()
        
        const emit = defineEmits<{
          (event: 'click'): void
        }>()
        </script>
        
        <template>
          <button
            :type="type"
            :disabled="disabled"
            @click="emit('click')"
          >
            {{ msg }}
          </button>
        </template>
        `

        const result = convertVueToReact(vueSource, {
            componentName: 'Button',
        })

        expect(result.componentName).toBe('Button')
        expect(result.emits).toEqual(['click'])
        expect(result.props.map((prop) => prop.name)).toEqual([
            'msg',
            'disabled',
            'type',
        ])

        expect(result.code).toContain(
            'export interface ButtonProps',
        )

        expect(result.code).toContain(
            'onClick?: () => void;',
        )

        expect(result.code).toContain(
            'type={type}',
        )

        expect(result.code).toContain(
            'disabled={disabled}',
        )

        expect(result.code).toContain(
            'onClick={() => onClick?.()}',
        )

        expect(result.code).toContain('{msg}')
    })

    it('throws if template does not exist', () => {
        expect(() =>
            convertVueToReact(`
                <script setup lang="ts">
                defineProps<{ msg: string }>()
                </script>
            `),
        ).toThrow(
            'Vue SFC must contain a <template> block',
        )
    })
})

describe('convertReactToVue', () => {
    it('converts the Button TSX example into a Vue single-file component', () => {
        const reactSource = readFileSync(
            new URL('../examples/Button.tsx', import.meta.url),
            'utf8',
        )

        const result = convertReactToVue(reactSource, {
            componentName: 'Button',
        })
        const parsed = parseSfc(result.code)
        const script = parsed.descriptor.scriptSetup
        const template = parsed.descriptor.template

        expect(script).toBeDefined()
        expect(template).toBeDefined()

        expect(result.componentName).toBe('Button')
        expect(result.props.map((prop) => prop.name)).toEqual([
            'msg',
            'disabled',
            'type',
            'onClick',
        ])
        expect(parsed.errors).toEqual([])
        expect(script?.content).toContain(
            'defineProps<ComponentProps>()',
        )
        expect(template?.content).toContain(
            '<button :type="type" :disabled="disabled" @click="() => onClick?.()">{{ msg }}</button>',
        )
        expect(() =>
            compileScript(parsed.descriptor, { id: 'button' }),
        ).not.toThrow()
        expect(
            compileTemplate({
                source: template?.content ?? '',
                filename: 'Button.vue',
                id: 'button',
            }).errors,
        ).toEqual([])
    })

    it('converts bound attributes and nested JSX elements', () => {
        const result = convertReactToVue(`
            interface Props {
                label: string;
            }
            export const Button = (props: Props) => (
                <button className="primary" disabled>
                    <span>{props.label}</span>
                </button>
            );
        `)

        expect(result.code).toContain('class="primary" disabled')
        expect(result.code).toContain('<span>{{ props.label }}</span>')
        expect(result.props.map((prop) => prop.name)).toEqual([
            'label',
        ])
    })

    it('reports components that do not return a single JSX element', () => {
        expect(() =>
            convertReactToVue(`
                export const Button = () => <><button /><span /></>;
            `),
        ).toThrow('must return one JSX element')
    })

    it('reports React hooks instead of emitting invalid Vue setup code', () => {
        expect(() =>
            convertReactToVue(`
                export const Counter = () => {
                    const [count, setCount] = useState(0);
                    return <button>{count}</button>;
                };
            `),
        ).toThrow('React hooks are not supported')
    })
})
