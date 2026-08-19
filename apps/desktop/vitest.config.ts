import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@dshd/ui': resolve(__dirname, '../../packages/ui/src/index.ts'),
      '@dshd/protocol': resolve(__dirname, '../../packages/protocol/src/index.ts'),
      '@dshd/harness-adapter': resolve(__dirname, '../../packages/harness-adapter/src/index.ts'),
      '@dshd/coding-agent': resolve(__dirname, '../../packages/coding-agent/src/index.ts'),
      '@electron': resolve(__dirname, 'electron')
    }
  },
  test: {
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    testTimeout: 10_000
  }
})
