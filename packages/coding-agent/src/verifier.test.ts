import { describe, expect, it } from 'vitest'
import { detectLockfile, detectVerifyCommands, resolveNpmVerifyCommands, resolveVerifyCommands, Verifier } from './verifier'

describe('detectVerifyCommands', () => {
  it('maps common package.json scripts to verify kinds', () => {
    expect(
      detectVerifyCommands({
        scripts: {
          test: 'vitest',
          lint: 'eslint .',
          typecheck: 'tsc --noEmit',
          build: 'vite build',
          dev: 'vite',
        },
      }),
    ).toEqual(['test', 'lint', 'typecheck', 'build'])
  })

  it('returns an empty list when no known scripts exist', () => {
    expect(detectVerifyCommands({})).toEqual([])
    expect(detectVerifyCommands({ scripts: { start: 'node .' } })).toEqual([])
  })
})

describe('resolveNpmVerifyCommands', () => {
  it('emits npm run commands only for known scripts', () => {
    expect(
      resolveNpmVerifyCommands({
        test: 'vitest',
        lint: 'eslint .',
        start: 'node .',
      }),
    ).toEqual({ test: 'npm run test', lint: 'npm run lint' })
  })

  it('returns an empty object when nothing is verifiable', () => {
    expect(resolveNpmVerifyCommands(undefined)).toEqual({})
    expect(resolveNpmVerifyCommands({ start: 'node .' })).toEqual({})
  })
})

describe('resolveVerifyCommands + detectLockfile', () => {
  it('prefers pnpm when a pnpm-lock.yaml exists', () => {
    expect(
      resolveVerifyCommands(
        { test: 'vitest', build: 'vite build' },
        detectLockfile(['pnpm-lock.yaml', undefined]),
      ),
    ).toEqual({ test: 'pnpm run test', build: 'pnpm run build' })
  })

  it('prefers yarn when only yarn.lock exists', () => {
    expect(resolveVerifyCommands({ test: 'vitest' }, detectLockfile([undefined, 'yarn.lock']))).toEqual({
      test: 'yarn run test',
    })
  })

  it('falls back to npm without a lockfile', () => {
    expect(detectLockfile([undefined, undefined])).toBe('npm')
    expect(resolveVerifyCommands({ test: 'vitest' }, 'npm')).toEqual({ test: 'npm run test' })
  })
})

describe('Verifier', () => {
  it('runs only provided commands and truncates output to 8000 chars', async () => {
    const verifier = new Verifier(async (cmd) => ({
      ok: cmd.includes('test'),
      output: 'x'.repeat(9000),
    }))
    const results = await verifier.runAll({ test: 'npm test', build: 'npm run build' })
    expect(results.map((item) => item.kind)).toEqual(['test', 'build'])
    expect(results[0]?.ok).toBe(true)
    expect(results[1]?.ok).toBe(false)
    expect(results[0]?.output.length).toBe(8000)
  })

  it('refuses more than two automatic fix attempts', () => {
    const verifier = new Verifier(async () => ({ ok: true, output: '' }))
    expect(verifier.tryAutoFix()).toBe(true)
    expect(verifier.tryAutoFix()).toBe(true)
    expect(verifier.tryAutoFix()).toBe(false)
    expect(verifier.autoFixAttempts).toBe(2)
  })
})
