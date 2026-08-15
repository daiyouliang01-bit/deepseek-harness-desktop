/** Task 3.1 — design tokens (dark/light, spacing, type scale). */

export interface Tokens {
  colors: {
    bg: string
    surface: string
    surfaceAlt: string
    border: string
    text: string
    textMuted: string
    accent: string
    accentText: string
    danger: string
    success: string
    warn: string
  }
  radius: { sm: number; md: number; lg: number }
  space: { xs: number; sm: number; md: number; lg: number; xl: number }
  font: { sizeSm: number; sizeMd: number; sizeLg: number; sizeXl: number; mono: string }
}

export const darkTokens: Tokens = {
  colors: {
    bg: '#1e1e2e',
    surface: '#2a2a3c',
    surfaceAlt: '#323248',
    border: 'rgba(255,255,255,0.08)',
    text: '#e4e4ef',
    textMuted: '#9a9ab0',
    accent: '#7aa2f7',
    accentText: '#10101a',
    danger: '#f7768e',
    success: '#9ece6a',
    warn: '#e0af68'
  },
  radius: { sm: 6, md: 10, lg: 14 },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  font: { sizeSm: 12, sizeMd: 14, sizeLg: 18, sizeXl: 22, mono: "'SF Mono', Menlo, monospace" }
}

export const lightTokens: Tokens = {
  colors: {
    bg: '#f5f5fa',
    surface: '#ffffff',
    surfaceAlt: '#f0f0f6',
    border: 'rgba(0,0,0,0.1)',
    text: '#1a1a2e',
    textMuted: '#6a6a80',
    accent: '#3b6fd4',
    accentText: '#ffffff',
    danger: '#d64545',
    success: '#3f8f3f',
    warn: '#b57b1f'
  },
  radius: { sm: 6, md: 10, lg: 14 },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  font: { sizeSm: 12, sizeMd: 14, sizeLg: 18, sizeXl: 22, mono: "'SF Mono', Menlo, monospace" }
}

export function resolveTokens(theme: 'dark' | 'light'): Tokens {
  return theme === 'dark' ? darkTokens : lightTokens
}
