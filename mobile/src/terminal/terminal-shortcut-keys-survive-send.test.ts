import { describe, expect, it } from 'vitest'
import { buildTerminalShortcutKey } from './terminal-accessory-keys'
import { TERMINAL_SHORTCUT_SPECIAL_KEY_DEFINITIONS } from './terminal-key-definitions'
import { buildTerminalSendParams } from './terminal-send-request'

const MODIFIER_SETS = [[], ['ctrl'], ['alt'], ['shift'], ['ctrl', 'shift']] as const

describe('what reaches the PTY for a shortcut key', () => {
  it('sends every special key and modifier combination through unchanged', () => {
    // 0.5.67 stripped CSI sequences ending H, f, J, K or r from every send, to
    // stop a terminal's own cursor restore coming back as input. Home is
    // `CSI H`, and Ctrl+Home is `CSI 1 ; 5 H` — so binding Home produced a key
    // that silently did nothing, while End (`CSI F`) still worked. The strip is
    // gone; this pins that no send path may quietly rewrite a keystroke again.
    let checked = 0
    for (const definition of TERMINAL_SHORTCUT_SPECIAL_KEY_DEFINITIONS) {
      for (const modifiers of MODIFIER_SETS) {
        const bytes = buildTerminalShortcutKey({
          key: definition.id,
          modifiers: [...modifiers]
        })?.bytes
        if (!bytes) {
          continue
        }
        checked += 1
        expect(
          buildTerminalSendParams({
            terminal: 'term-1',
            text: bytes,
            enter: false,
            deviceToken: null
          }).text
        ).toBe(bytes)
      }
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('keeps Home and Ctrl+Home, the two the strip actually ate', () => {
    const home = buildTerminalShortcutKey({ key: 'home', modifiers: [] })?.bytes
    const ctrlHome = buildTerminalShortcutKey({ key: 'home', modifiers: ['ctrl'] })?.bytes
    expect(home).toBe(`${String.fromCharCode(0x1b)}[H`)
    expect(ctrlHome).toBe(`${String.fromCharCode(0x1b)}[1;5H`)
    for (const bytes of [home, ctrlHome]) {
      expect(
        buildTerminalSendParams({ terminal: 't', text: bytes!, enter: false, deviceToken: null })
          .text
      ).toBe(bytes)
    }
  })
})
