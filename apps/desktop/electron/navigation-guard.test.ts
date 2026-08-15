import { describe, expect, it } from 'vitest'
import { isAllowedNavigation } from './navigation-guard'

const RENDERER_DIR = 'file:///app/out/renderer/'

describe('navigation guard', () => {
  it('allows the validated loopback origin', () => {
    expect(isAllowedNavigation('http://127.0.0.1:59853/', undefined, RENDERER_DIR)).toBe(true)
    expect(isAllowedNavigation('http://127.0.0.1:3080/', undefined, RENDERER_DIR)).toBe(true)
    expect(isAllowedNavigation('http://localhost:3080/', undefined, RENDERER_DIR)).toBe(true)
  })

  it('allows the dev server and the bundled renderer file', () => {
    expect(isAllowedNavigation('http://localhost:5173/#/', 'http://localhost:5173')).toBe(true)
    expect(isAllowedNavigation(RENDERER_DIR, undefined, RENDERER_DIR)).toBe(true)
    // sub-resources of the renderer bundle
    expect(isAllowedNavigation('file:///app/out/renderer/assets/index-x.js', undefined, RENDERER_DIR)).toBe(true)
  })

  it('blocks remote, non-loopback, and arbitrary file origins', () => {
    expect(isAllowedNavigation('https://example.com/', undefined, RENDERER_DIR)).toBe(false)
    expect(isAllowedNavigation('http://192.168.1.10:3080/', undefined, RENDERER_DIR)).toBe(false)
    expect(isAllowedNavigation('https://127.0.0.1:8443/', undefined, RENDERER_DIR)).toBe(false)
    expect(isAllowedNavigation('file:///etc/passwd', undefined, RENDERER_DIR)).toBe(false)
    expect(isAllowedNavigation('javascript:alert(1)', undefined, RENDERER_DIR)).toBe(false)
    expect(isAllowedNavigation('data:text/html,<b>x</b>', undefined, RENDERER_DIR)).toBe(false)
  })

  it('blocks loopback lookalikes with credentials or appended domains', () => {
    expect(isAllowedNavigation('http://evil.com@127.0.0.1:59853/', undefined, RENDERER_DIR)).toBe(false)
    expect(isAllowedNavigation('http://127.0.0.1:59853.evil.com/', undefined, RENDERER_DIR)).toBe(false)
  })
})
