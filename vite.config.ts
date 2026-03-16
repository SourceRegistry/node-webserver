/// <reference types="vitest" />
// Configure Vitest (https://vitest.dev/config/)
import { builtinModules } from 'node:module';
import {defineConfig} from 'vite';
import dts from 'vite-plugin-dts';

const external = new Set([
    ...builtinModules,
    ...builtinModules.map((module) => `node:${module}`),
    'cookie',
    'ws'
]);

export default defineConfig({
    build: {
        lib: {
            entry: 'src/index.ts',
            formats: ['es', 'cjs'],
            fileName: (format) => `index.${format}.js`
        },
        rollupOptions: {
            output: {
                exports: 'named'
            },
            external: [...external],
        },
        sourcemap: true,
        target: 'node24'
    },
    plugins: [dts()]
});
