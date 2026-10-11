import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { colorsForScheme } from '../theme/tokens'
import { CHAT_SELECTION_HIGHLIGHT_ALPHA, chatSelectionColors } from './chat-selection-colors'

// 2026-10-12, from the phone: a reply held to select showed teal handles and a teal-grey highlight
// (the platform's), where the Claude app on the same reply shows clay handles and a warm highlight.
// The Claude app's TextSelectionColors (`k4y`) are built in its theme (`bek.a`) from the colour
// scheme's primary: the handles in it, the highlight the same colour at 40%. Code UI's primary is
// its accent, per scheme.

describe('the colours of a selection in a chat reply', () => {
  it.each(['light', 'dark'] as const)('takes the handles from the accent and the highlight from the accent at 40% (%s)', (scheme) => {
    const colors = colorsForScheme(scheme)
    const selection = chatSelectionColors(colors)
    expect(selection.handle).toBe(colors.accent)
    const hex = colors.accent.slice(1)
    const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
    expect(selection.highlight).toBe(`rgba(${r}, ${g}, ${b}, 0.4)`)
    expect(CHAT_SELECTION_HIGHLIGHT_ALPHA).toBe(0.4)
  })

  it('follows the scheme: light and dark draw different handles', () => {
    expect(chatSelectionColors(colorsForScheme('light')).handle).not.toBe(chatSelectionColors(colorsForScheme('dark')).handle)
  })

  it('reads a short hex accent as its long form', () => {
    expect(chatSelectionColors({ accent: '#c64' })).toEqual({ handle: '#c64', highlight: 'rgba(204, 102, 68, 0.4)' })
  })

  it('leaves the highlight to the platform for an accent it cannot read, never an opaque one over the words', () => {
    expect(chatSelectionColors({ accent: 'rgb(201, 100, 66)' })).toEqual({ handle: 'rgb(201, 100, 66)', highlight: null })
    expect(chatSelectionColors({ accent: '#C9644280' }).highlight).toBeNull()
  })
})

// The menu is native (modules/orca-selection-copy). Its shape has no handle a JavaScript test can
// drive, so these read its source, code lines only, never the comments around them.
const MODULE_SOURCE = path.resolve(
  import.meta.dirname,
  '../../modules/orca-selection-copy/android/src/main/java/expo/modules/orcaselectioncopy'
)

function kotlinCode(file: string): string {
  return readFileSync(path.join(MODULE_SOURCE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('the menu a selection in a chat reply opens', () => {
  it('offers only Copy and Select all, as the Claude app’s pill does', () => {
    expect(kotlinCode('ChatSelectionMenu.kt')).toMatch(
      /val CHAT_SELECTION_MENU_ITEMS: Set<Int> = setOf\(android\.R\.id\.copy, android\.R\.id\.selectAll\)\n/
    )
  })

  it('is trimmed for every Text of the document, with or without code pills', () => {
    const root = kotlinCode('SelectionCopyRootView.kt')
    // Every TextView's menu is wrapped, the pill copy inside it only where there are pills.
    expect(root).toMatch(/if \(originalView is TextView && callback != null\) \{/)
    expect(root).toMatch(/ChatSelectionMenuCallback\(copying\)/)
    expect(root).not.toMatch(/originalView is TextView && callback != null && InlineViewPlaceholders/)
  })
})
