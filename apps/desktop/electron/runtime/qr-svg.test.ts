import { describe, expect, it } from 'vitest'
import { qrSvg } from './qr-svg'

describe('qrSvg', () => {
  it('renders an svg for a pairing url', () => {
    const svg = qrSvg('https://dsh.dpharness.xyz/__pair?t=abc123')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('rect')
    expect(svg).not.toContain('companion')
  })
})
