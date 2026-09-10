import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const screen = readFileSync(new URL('../../app/terminal-settings.tsx', import.meta.url), 'utf8')
const shortcuts = readFileSync(
  new URL('../components/TerminalShortcutSettings.tsx', import.meta.url),
  'utf8'
)

describe('Terminal settings copy', () => {
  it('keeps the groups and drops the jargon under them', () => {
    expect(screen).toContain('WHEN YOU LEAVE THE APP')
    expect(screen).toContain('TEXT SIZE')
    expect(screen).toContain('KEYBOARD INPUT')
    expect(shortcuts).toContain('SHORTCUT BAR')
    expect(screen).not.toContain('interactive CLI tools')
    expect(screen).not.toContain('pinch to zoom in the terminal')
    expect(screen).not.toContain('phone-style autocomplete')
    expect(shortcuts).not.toContain('hold the grip')
  })
})
