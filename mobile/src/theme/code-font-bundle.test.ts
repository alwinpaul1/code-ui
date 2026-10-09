import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-10-09: the chat transcript's code blocks and inline code are set in
// JetBrains Mono, as the Claude app's are, and the face is licensed under the
// SIL Open Font License, which travels with the font. It was loaded out of
// node_modules, its licence nowhere in the repo. A structural fact with no
// behaviour to observe in a test runner, so it is read from disk: the file and
// its licence side by side, and the font module loading that file.

const dir = fileURLToPath(new URL('../../assets/fonts/jetbrains-mono/', import.meta.url))
const fontsModule = fileURLToPath(new URL('./fonts.ts', import.meta.url))

/** The module's code, its comments taken out, so a path named in prose does
 *  not pass for one that is loaded. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the bundled code face', () => {
  it('ships JetBrains Mono with its OFL licence beside it', () => {
    expect(existsSync(`${dir}JetBrainsMono-Regular.ttf`)).toBe(true)
    const licence = readFileSync(`${dir}OFL.txt`, 'utf8')
    expect(licence).toContain('JetBrains Mono Project Authors')
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })

  it('loads the code face from that file, under the family name the styles use', () => {
    const code = codeOf(fontsModule)
    expect(code).toContain("require('../../assets/fonts/jetbrains-mono/JetBrainsMono-Regular.ttf')")
    expect(code).not.toContain('@expo-google-fonts/jetbrains-mono')
    // The family the styles name (tokens.ts fontFamily.mono) is the key it loads under.
    expect(code).toMatch(/useFonts\(\{[^}]*\bJetBrainsMono_400Regular\b[^}]*\}\)/)
  })
})
