import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../../plugins/android-terminal-fonts.js') as {
  FONT_FILES: readonly string[]
  terminalFontCopies: (
    projectRoot: string,
    platformProjectRoot: string
  ) => { from: string; to: string }[]
}

/** Measured on a Galaxy S23: with Typeface.MONOSPACE the native terminal drew
 *  31 px cells (0.84 em) instead of ~22 px, a 34-column grid, and 51-column
 *  output rewrapped at 34. Samsung's FlipFont packages substitute the alias
 *  in-process, so the grid needs a font the APK ships itself. */
describe('the terminal ships its own monospace font', () => {
  it('bundles all four Roboto Mono faces so bold and italic keep the same advance', () => {
    expect(plugin.FONT_FILES).toEqual([
      'RobotoMono-Regular.ttf',
      'RobotoMono-Bold.ttf',
      'RobotoMono-Italic.ttf',
      'RobotoMono-BoldItalic.ttf'
    ])
  })

  it('copies them under the asset path the patched view loads from', () => {
    const copies = plugin.terminalFontCopies('/proj', '/proj/android')

    expect(copies).toHaveLength(4)
    for (const { from, to } of copies) {
      expect(from.startsWith('/proj/assets/fonts/')).toBe(true)
      // GhosttyTerminalView reads context.assets "fonts/RobotoMono-*.ttf".
      expect(to.startsWith('/proj/android/app/src/main/assets/fonts/')).toBe(true)
      expect(to.endsWith(from.slice(from.lastIndexOf('/')))).toBe(true)
    }
  })
})
