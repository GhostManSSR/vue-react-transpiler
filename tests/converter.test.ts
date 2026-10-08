import { describe, expect, it } from 'vitest'
import { convertVueToReact } from '../src/index.js'

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