import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseTerminalActivity } from './mobile-terminal-hud-parse'
import { parseClaudeSpinnerLine } from './mobile-terminal-spinner-line'

// Both spinner readers took the verb as [A-Z][a-zA-Z]+, so any verb with a
// letter outside ASCII, a hyphen or an apostrophe read as no spinner at all:
// the chat's status line lost its elapsed time and thinking status, and the
// HUD its activity, for the whole of that turn (review, 2026-09-30).

// Claude Code 2.1.282 painting its own verb, verbatim from the capture
// (claude-screen-ask-single-select-2.1.282.txt, the "ask" screen, tmux).
const FLAMBEING_2_1_282 = readFileSync(
  fileURLToPath(new URL('./fixtures/claude-screen-ask-single-select-2.1.282.txt', import.meta.url)),
  'utf8'
)
  .split('\n')
  .find((row) => row.includes('Flambéing'))!

describe('a spinner verb that is not plain ASCII letters', () => {
  it('reads the accented verb Claude Code 2.1.282 painted', () => {
    expect(FLAMBEING_2_1_282).toBe('✳ Flambéing… (9s · ↓ 490 tokens)')
    expect(parseClaudeSpinnerLine([FLAMBEING_2_1_282])).toEqual({
      verb: 'Flambéing',
      elapsed: '9s',
      thinking: null
    })
    expect(parseTerminalActivity([FLAMBEING_2_1_282])).toBe('Flambéing')
  })

  // Verbs from the Claude Code 2.1.285 binary's own spinner list, in the row
  // shape of the captures ("✻ Frolicking… (15m 36s · ↓ 56.6k tokens)").
  it.each([['Dilly-dallying'], ['Fiddle-faddling'], ['Razzle-dazzling'], ['Sock-hopping'], ['Topsy-turvying'], ["Beboppin'"]])(
    'reads %s, with its hyphen or apostrophe, as one verb',
    (verb) => {
      const row = `✻ ${verb}… (12s · ↓ 1.2k tokens · thinking some more)`
      expect(parseClaudeSpinnerLine([row])).toEqual({ verb, elapsed: '12s', thinking: 'thinking some more' })
      expect(parseTerminalActivity([row])).toBe(verb)
    }
  )

  it('reads a custom verb with a typographic apostrophe', () => {
    expect(parseClaudeSpinnerLine(['✶ Rock’n’rolling… (3s)'])?.verb).toBe('Rock’n’rolling')
  })

  it('still reads no spinner off rows that are not one', () => {
    for (const row of [
      // A compaction's two words (2.1.282, 2.1.283).
      'Compacting conversation…',
      '✻ Compacting conversation…',
      // Codex's spinner.
      '• Working (5s • esc to interrupt)',
      // A finished turn's summary (2.1.270).
      '✻ Baked for 7s · done 10:25 AM',
      // A tool running, with its own dot (2.1.281, 2.1.277).
      '● Running 1 shell command · 14s…',
      '⏺ Running 5 shell commands…',
      // A lowercase word and a lone mark are not a verb.
      '✻ dilly-dallying…',
      "✻ '…",
      '✻ -…'
    ]) {
      expect(parseClaudeSpinnerLine([row])).toBeNull()
      expect(parseTerminalActivity([row])).toBeNull()
    }
    expect(parseClaudeSpinnerLine([])).toBeNull()
    expect(parseTerminalActivity([''])).toBeNull()
  })
})
