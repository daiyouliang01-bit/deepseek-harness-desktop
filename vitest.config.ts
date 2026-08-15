import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@dshd/protocol': resolve(__dirname, 'packages/protocol/src/index.ts'),
      '@dshd/session-store': resolve(__dirname, 'packages/session-store/src/index.ts'),
      '@dshd/permissions': resolve(__dirname, 'packages/permissions/src/index.ts'),
      '@dshd/ui': resolve(__dirname, 'packages/ui/src/index.ts')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000
  }
})
