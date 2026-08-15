import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  // repo-level compatibility smoke tests (real dsh)
  {
    test: {
      name: 'smoke',
      include: ['tests/**/*.test.ts'],
      testTimeout: 120_000
    }
  },
  // each workspace package runs its own config
  'packages/*',
  'apps/desktop'
])
