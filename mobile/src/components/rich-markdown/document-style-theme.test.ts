import { describe, expect, it } from 'vitest'
import { darkColors, lightColors } from '../../theme/tokens'
import { richMarkdownEditorStyle, richMarkdownEditorThemeVariables } from './document-style'

const LIGHT = { colors: lightColors, scheme: 'light' as const }
const DARK = { colors: darkColors, scheme: 'dark' as const }

// 2026-09-24: the rich Markdown editor, its document and its toolbar read the
// static dark palette, so a phone set to Light got a dark editor inside a
// light app (recorded as a known gap by the v1.4.210 port). Light and dark are
// both required states.
describe('the rich Markdown editor document in the theme in use', () => {
  it('is drawn in the light theme when the app is light', () => {
    const style = richMarkdownEditorStyle(LIGHT)
    expect(style).toContain('color-scheme: light;')
    expect(style).toContain(`--background: ${lightColors.bg};`)
    expect(style).toContain(`--foreground: ${lightColors.text};`)
    expect(style).not.toContain(darkColors.bg)
  })

  it('is drawn in the dark theme when the app is dark', () => {
    const style = richMarkdownEditorStyle(DARK)
    expect(style).toContain('color-scheme: dark;')
    expect(style).toContain(`--background: ${darkColors.bg};`)
    expect(style).not.toContain(lightColors.bg)
  })

  it('writes every theme variable the live switch sets, and nothing the switch misses', () => {
    const style = richMarkdownEditorStyle(LIGHT)
    for (const [name, value] of richMarkdownEditorThemeVariables(LIGHT)) {
      expect(style).toContain(`${name}: ${value};`)
    }
    const root = /:root \{([\s\S]*?)\}/.exec(style)?.[1] ?? ''
    const themed = root.match(/#[0-9A-Fa-f]{3,8}|rgba?\(/g) ?? []
    expect(themed.length).toBe(
      richMarkdownEditorThemeVariables(LIGHT).filter(([, value]) => /^#|^rgba?\(/.test(value)).length
    )
  })
})
