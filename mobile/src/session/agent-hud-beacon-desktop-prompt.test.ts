import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_HUD_PROMPT_HOOK_SCRIPT } from './agent-hud-launch-args'
import { parseAgentHudBeaconPayload, type DesktopPrompt } from './agent-hud-beacon'
import { readDesktopPrompt } from './agent-hud-beacon-desktop-prompt'
import { decodeAgentHudChannelText } from './agent-hud-channel'
import { withoutLandedDesktopPrompts } from './use-desktop-prompt-echoes'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

/** The desk copy the phone reads when the real prompt hook runs on `prompt`:
 *  the hook under /bin/sh, its frame written to a file, decoded by the
 *  phone's own channel reader and beacon parser. */
function deskCopy(prompt: string): DesktopPrompt {
  const tty = join(mkdtempSync(join(tmpdir(), 'cuihud-cut-')), 'tty')
  execFileSync('/bin/sh', ['-c', CLAUDE_HUD_PROMPT_HOOK_SCRIPT], {
    input: JSON.stringify({ prompt }),
    env: { ...process.env, CUIHUD_TTY: tty }
  })
  const payload = decodeAgentHudChannelText(readFileSync(tty, 'latin1')).join('\n')
  const copy = parseAgentHudBeaconPayload(payload)?.desktopPrompt
  expect(copy).toBeTruthy()
  return copy!
}

function row(text: string): NativeChatMessage {
  return { id: 'u1', role: 'user', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' }
}

// Review of 2026-09-30: the hook cuts a long prompt's JSON body at 2000 BYTES.
// A multibyte character across byte 2000 left half of it on the beacon, which
// the phone decoded to U+FFFD at the end of the copy; a cut inside a JSON
// escape left half the escape. Either way the copy was no longer a prefix of
// its own transcript row, so it never retired and the desk message stayed
// drawn under that row for the rest of the session. About one long German
// prompt in twenty cuts inside an umlaut.
describe('a long desk prompt the hook had to cut', () => {
  it.each([
    ['an accented letter', 'a' + 'é'.repeat(1500)],
    ['an emoji', 'a' + '\u{1F600}'.repeat(600)],
    ['a newline escape', 'z'.repeat(1999) + '\nand the rest'],
    ['a quote escape', 'z'.repeat(1999) + '"quoted" and the rest'],
    ['a backslash escape', 'z'.repeat(1999) + '\\server\\share and the rest'],
    ['a \\u escape', 'z'.repeat(1997) + '\u0007 and the rest']
  ])('retires against its transcript row when the cut splits %s', (_what, typed) => {
    const copy = deskCopy(typed)
    expect(copy.cut).toBe(true)
    expect(copy.text).not.toMatch(/\uFFFD$/)
    // At most the half-written character or escape is gone: 1997 to 2000 bytes.
    expect(new TextEncoder().encode(copy.text).length).toBeGreaterThanOrEqual(1997)
    expect(typed.startsWith(copy.text)).toBe(true)
    expect(withoutLandedDesktopPrompts([copy], [row(typed)])).toEqual([])
  })

  it('retires a long prompt of one-byte letters, as it always did', () => {
    const typed = 'z'.repeat(2500)
    const copy = deskCopy(typed)
    expect(copy.cut).toBe(true)
    expect(withoutLandedDesktopPrompts([copy], [row(typed)])).toEqual([])
  })

  it('keeps a trailing U+FFFD or backslash the person typed in a prompt the hook did not cut', () => {
    // The last: 2000 bytes exactly, ending in a two-byte letter.
    for (const typed of ['end \uFFFD', 'C:\\temp\\', 'z'.repeat(1998) + 'é']) {
      const copy = deskCopy(typed)
      expect(copy.cut).toBe(false)
      expect(copy.text).toBe(typed)
    }
  })

  it('drops only a half-written escape, never a whole one, and reads nothing from a body of only debris', () => {
    const cutText = (body: string) => readDesktopPrompt(`7:${body}`, true)?.text
    expect(cutText('a\\\\')).toBe('a\\') // a whole \\ at the cut
    expect(cutText('a\\\\\\')).toBe('a\\') // then half of the next
    expect(cutText('a\\u00e')).toBe('a')
    expect(cutText('a\\\\u00')).toBe('a\\u00') // an escaped backslash, then letters
    expect(cutText('a\\u00e9')).toBe('aé')
    expect(cutText('a\uFFFD\uFFFD')).toBe('a')
    for (const debris of ['\uFFFD', '\\', '\\u', '\\u12']) {
      expect(readDesktopPrompt(`7:${debris}`, true)).toBeNull()
    }
    // Not cut: every byte is what the person typed.
    expect(readDesktopPrompt('7:\uFFFD', false)?.text).toBe('\uFFFD')
  })

  it('reads a prompt of exactly 2000 bytes whole, and one byte over as a clean cut', () => {
    const whole = deskCopy('y'.repeat(2000))
    expect(whole).toMatchObject({ cut: false, text: 'y'.repeat(2000) })
    const over = deskCopy('y'.repeat(2001))
    expect(over).toMatchObject({ cut: true, text: 'y'.repeat(2000) })
  })
})
