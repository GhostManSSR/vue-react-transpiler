import { readFileSync } from 'node:fs'
import {
    compileScript,
    compileTemplate,
    parse as parseSfc,
} from '@vue/compiler-sfc'
import { parse as parseBabel } from '@babel/parser'
import { describe, expect, it } from 'vitest'
import {convertReactToVue, convertVueToReact, ReactToVueConversionError} from '../src/index.js'

describe('convertVueToReact', () => {
    it('converts the UserProfile Vue example with typed props and a watch source', () => {
        const vueSource = readFileSync(
            new URL('../examples/UserProfile.vue', import.meta.url),
            'utf8',
        )
        const result = convertVueToReact(vueSource, {
            componentName: 'UserProfile',
        })

        expect(result.props.map((prop) => prop.name)).toEqual([
            'userId',
            'onLoaded',
        ])
        expect(result.code).toContain('userId: number;')
        expect(result.code).toContain('onLoaded?: (user: User) => void;')
        expect(result.code).toContain('React.useEffect')
        expect(result.code).toContain('React.useState(() => null)')
        expect(result.code).not.toContain("from 'vue'")
        expect(result.code).not.toContain('.value')
        expect(() => parseBabel(result.code, {
            sourceType: 'module',
            plugins: ['typescript', 'jsx'],
        })).not.toThrow()
    })

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

    it('converts common Vue composables into React hooks', () => {
        const result = convertVueToReact(`
            <script setup lang="ts">
            import {
                ref,
                reactive,
                computed,
                watch,
                watchEffect,
                onMounted,
                onUnmounted,
                nextTick,
            } from 'vue';

            const count = ref(0);
            const total = computed(() => count.value * 2);
            const profile = reactive({ name: 'Ada' });
            watch(count, () => {
                profile.name = String(count.value);
            });
            watchEffect(() => {
                console.log(total.value);
            });
            onMounted(() => {
                console.log('mounted');
            });
            onUnmounted(() => {
                console.log('unmounted');
            });
            const tick = nextTick();
            </script>

            <template>
                <main>
                    <button @click="count++">{{ count }}</button>
                    <output>{{ total }}</output>
                    <span>{{ profile.name }}</span>
                </main>
            </template>
        `, { componentName: 'ComposableExample' })

        expect(result.code).toContain('React.useState(() => 0)')
        expect(result.code).toContain('React.useMemo')
        expect(result.code).toContain('React.useRef(false)')
        expect(result.code).toContain('React.useEffect')
        expect(result.code).toContain('Promise.resolve()')
        expect(result.code).toContain('setCount(current => current + 1)')
        expect(result.code).toContain('name: String(count)')
        expect(result.code).not.toContain("from 'vue'")
        expect(result.code).not.toContain('.value')
        expect(result.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                componentName: 'ComposableExample',
                construct: 'nextTick',
                severity: 'warning',
            }),
            expect.objectContaining({
                componentName: 'ComposableExample',
                construct: 'computed',
                severity: 'warning',
            }),
            expect.objectContaining({
                componentName: 'ComposableExample',
                construct: 'onUnmounted',
                severity: 'warning',
            }),
        ]))
        expect(() => parseBabel(result.code, {
            sourceType: 'module',
            plugins: ['typescript', 'jsx'],
        })).not.toThrow()
    })

    it('converts script emit calls to React callback props', () => {
        const result = convertVueToReact(`
            <script setup lang="ts">
            const emit = defineEmits<{
                (event: 'save'): void
            }>();
            function save() {
                emit('save');
            }
            </script>
            <template><button @click="save()">Save</button></template>
        `, { componentName: 'SaveButton' })

        expect(result.code).toContain('onSave?: () => void;')
        expect(result.code).toContain('onSave?.()')
        expect(result.code).toContain('onClick={() => save()}')
        expect(() => parseBabel(result.code, {
            sourceType: 'module',
            plugins: ['typescript', 'jsx'],
        })).not.toThrow()
    })

    it('rejects Vue composable behavior that cannot be preserved safely', () => {
        const immediateWatchResult = convertVueToReact(`
            <script setup>
            import { ref, watch } from 'vue';
        
            const count = ref(0);
        
            watch(count, () => {}, { immediate: true });
            </script>
        
            <template>
                <div>{{ count }}</div>
            </template>
        `)

        expect(immediateWatchResult.code).toContain('React.useEffect')
        expect(immediateWatchResult.code).toContain('React.useRef(false)')

        expect(() => convertVueToReact(`
            <script setup>
            import { watchEffect } from 'vue';
            watchEffect(async () => {
                await loadData();
            });
            </script>
            <template><div /></template>
        `)).toThrow('async callbacks cannot be represented by a React effect safely')

        expect(() => convertVueToReact(`
            <script setup>
            import { reactive } from 'vue';
            const state = reactive({ nested: { count: 0 } });
            state.nested.count++;
            </script>
            <template><div /></template>
        `)).toThrow('nested reactive mutations are not supported')

        expect(() => convertVueToReact(`
            <script setup>
            import { onBeforeMount } from 'vue';
            onBeforeMount(() => {});
            </script>
            <template><div /></template>
        `)).toThrow('React has no equivalent that runs before the first DOM commit')

        expect(() => convertVueToReact(`
            <script setup>
            await loadData();
            </script>
            <template><div /></template>
        `)).toThrow('top-level await cannot be moved into a synchronous React component')
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

    it('converts state and async effects in a realistic component', () => {
        const reactSource = readFileSync(
            new URL('../examples/UserProfile.tsx', import.meta.url),
            'utf8',
        )
        const result = convertReactToVue(reactSource)
        const parsed = parseSfc(result.code)
        const script = parsed.descriptor.scriptSetup
        const template = parsed.descriptor.template

        expect(result.componentName).toBe('UserProfile')
        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                componentName: 'UserProfile',
                construct: 'useEffect with dependencies',
                severity: 'warning',
            }),
        ])
        expect(parsed.errors).toEqual([])
        expect(script?.content).toContain(
            "import { ref, watch, onMounted, onUnmounted } from 'vue'",
        )
        expect(script?.content).toContain(
            'const user = ref<User | null>(null)',
        )
        expect(script?.content).toContain('watch(() => [userId, onLoaded]')
        expect(script?.content).toContain(
            "}, { flush: 'post' });",
        )
        expect(script?.content).toContain('await fetch(')
        // expect(script?.content).toContain(
        //     'return () => {\n' +
        //     '   controller.abort();\n' +
        //     '};',
        // )
        expect(script?.content).toContain(
            'user.value = nextUser',
        )
        expect(template?.content).toContain(
            '@click="() => user = null"',
        )
        expect(() =>
            compileScript(parsed.descriptor, { id: 'user-profile' }),
        ).not.toThrow()
        expect(
            compileTemplate({
                source: template?.content ?? '',
                filename: 'UserProfile.vue',
                id: 'user-profile',
            }).errors,
        ).toEqual([])
    })

    it('reports unsupported hooks with the component and construct', () => {
        try {
            convertReactToVue(`
                export const SearchPanel = () => {
                    const [query, setQuery] = useState('');
                    const result = useReducer(reducer, initialState);
                    return <input value={query} onChange={(event) => setQuery(event.target.value)} />;
                };
            `)
            throw new Error('Expected conversion to fail')
        } catch (error) {
            expect(error).toBeInstanceOf(ReactToVueConversionError)
            expect((error as ReactToVueConversionError).diagnostics).toEqual([
                expect.objectContaining({
                    componentName: 'SearchPanel',
                    construct: 'useReducer',
                    severity: 'error',
                }),
            ])
            expect((error as Error).message).toContain('SearchPanel: useReducer')
        }
    })

    it('maps mount-only and automatic effects to Vue lifecycle APIs', () => {
        const result = convertReactToVue(`
            import { useEffect, useState } from 'react';

            export const Clock = () => {
                const [ticks, setTicks] = useState(0);

                useEffect(() => {
                    const timer = setInterval(
                        () => setTicks((previous) => previous + 1),
                        1000,
                    );
                    return () => clearInterval(timer);
                }, []);

                useEffect(() => {
                    document.title = String(ticks);
                });

                return <output>{ticks}</output>;
            };
        `)
        const parsed = parseSfc(result.code)
        const script = parsed.descriptor.scriptSetup
        const template = parsed.descriptor.template

        expect(script?.content).toContain(
            "import { ref, onMounted, onUnmounted, watchEffect } from 'vue'",
        )
        expect(script?.content).toContain('onMounted(() =>')
        expect(script?.content).toContain('onUnmounted(() =>')
        expect(script?.content).toContain('watchEffect((onCleanup) =>')
        expect(script?.content).toContain('ticks.value = (previous => previous + 1)(ticks.value)')
        expect(script?.content).toContain('document.title = String(ticks.value)')
        expect(template?.content).toContain('{{ ticks }}')
        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                componentName: 'Clock',
                construct: 'useEffect without dependencies',
                severity: 'warning',
            }),
        ])
        expect(() =>
            compileScript(parsed.descriptor, { id: 'clock' }),
        ).not.toThrow()
        expect(
            compileTemplate({
                source: template?.content ?? '',
                filename: 'Clock.vue',
                id: 'clock',
            }).errors,
        ).toEqual([])
    })

    it('converts namespace useState and functional updates', () => {
        const result = convertReactToVue(`
            import React from 'react';

            export const Counter = () => {
                const [count, setCount] = React.useState(0);
                return (
                    <button onClick={() => setCount((current) => current + 1)}>
                        {count}
                    </button>
                );
            };
        `)
        const parsed = parseSfc(result.code)
        const template = parsed.descriptor.template
        const script = parsed.descriptor.scriptSetup

        expect(script?.content).toContain('const count = ref(0)')
        expect(template?.content).toContain(
            '@click="() => count = (current => current + 1)(count)"',
        )
        expect(template?.content).toContain('{{ count }}')
        expect(
            compileTemplate({
                source: template?.content ?? '',
                filename: 'Counter.vue',
                id: 'counter',
            }).errors,
        ).toEqual([])
    })

    it('diagnoses async useEffect callbacks instead of changing their semantics', () => {
        expect(() =>
            convertReactToVue(`
                export const DataPanel = () => {
                    useEffect(async () => {
                        await loadData();
                    }, []);
                    return <section />;
                };
            `),
        ).toThrow('DataPanel: async useEffect')
    })
})
