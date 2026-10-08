import { defineConfig } from 'tsup'

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        cli: 'src/cli-entry.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    target: 'node18',
    platform: 'node',
    external: [
        '@vue/compiler-sfc',
        '@vue/compiler-dom',
        '@babel/parser',
        '@babel/traverse',
        '@babel/generator',
        '@babel/types',
    ],
    banner: ({ format }) => {
        if (format === 'esm') {
            return {
                js: '#!/usr/bin/env node',
            }
        }

        return undefined
    },
})