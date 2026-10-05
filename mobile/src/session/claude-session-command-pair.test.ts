import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { sessionCommandPair } from './claude-session-command-pair'

// Rows as Orca's reader publishes them. The first three outputs are verbatim
// from a hand-started Claude Code 2.1.278 session (06:32-06:36, 2026-09-20,
// quoted in mobile-native-chat-command-turns.test.ts). The remaining wordings
// are MODELLED from the 2.1.289 binary (strings of the /model picker and the
// /effort command, 2026-10-05): not captured from a live session.
const row = (id: string, role: 'user' | 'system' | 'assistant', body: string): NativeChatMessage => ({
  id,
  role,
  blocks: [{ type: 'text', text: body }],
  timestamp: 1,
  source: 'transcript'
})
const out = (id: string, body: string) => row(id, 'user', `<local-command-stdout>${body}</local-command-stdout>`)
const envelope = (id: string, name: string, args: string) =>
  row(id, 'user', `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args>${args}</command-args>`)

describe("a session's own /model and /effort output", () => {
  it('reads the saved effort of a desktop-started session from its /effort output', () => {
    expect(
      sessionCommandPair([
        envelope('a', 'effort', 'xhigh'),
        out('b', 'Set effort level to xhigh (saved as your default for new sessions): Deeper reasoning than high, just below maximum (Fable 5, Opus 4.7+, Sonnet 5)')
      ])
    ).toEqual({ label: null, effort: 'xhigh' })
  })

  it('a session-only /effort pick is the effort of that session', () => {
    expect(sessionCommandPair([out('b', 'Set effort level to low (this session only): Quick')])).toEqual({ label: null, effort: 'low' })
  })

  it('names the model of a /model switch and gives it no effort when the output states none', () => {
    expect(sessionCommandPair([out('b', 'Set model to `Opus 5` and saved as your default for new sessions')])).toEqual({
      label: 'Opus 5',
      effort: null
    })
  })

  it('does not carry the effort of the model before a /model switch over to the new one', () => {
    expect(
      sessionCommandPair([
        out('a', 'Set effort level to xhigh (this session only): Deeper'),
        out('b', 'Set model to `Fable 5.1` and saved as your default for new sessions')
      ])
    ).toEqual({ label: 'Fable 5.1', effort: null })
  })

  it('reads the effort the /model picker slider chose, saved or for this session only', () => {
    expect(sessionCommandPair([out('a', 'Set model to `Opus 5.5` for this session only with high effort')])).toEqual({
      label: 'Opus 5.5',
      effort: 'high'
    })
    expect(
      sessionCommandPair([out('a', 'Set model to `Opus 5.5` and saved as your default for new sessions with max effort')])
    ).toEqual({ label: 'Opus 5.5', effort: 'max' })
  })

  it('reads a bare /effort answer and the auto answer as what the agent says now', () => {
    expect(sessionCommandPair([out('a', 'Current effort level: medium (Balanced approach)')])).toEqual({ label: null, effort: 'medium' })
    expect(sessionCommandPair([out('a', 'Effort level: auto (currently high)')])).toEqual({ label: null, effort: 'high' })
  })

  it('shows no effort after /effort auto, whose level the output does not state', () => {
    expect(
      sessionCommandPair([
        out('a', 'Set effort level to low (this session only): Quick'),
        out('b', 'Effort level set to auto (this session only)')
      ])
    ).toEqual({ label: null, effort: null })
  })

  it('takes the level an environment override pins, which beats the pick', () => {
    expect(
      sessionCommandPair([out('a', 'CLAUDE_CODE_EFFORT_LEVEL=max overrides this session — clear it and low takes over')])
    ).toEqual({ label: null, effort: 'max' })
  })

  it('takes the capped level when the pick exceeds the cap', () => {
    expect(
      sessionCommandPair([out('a', "Effort 'max' exceeds the cap for opus set by your settings or organization; set to 'high' instead (this session only): Deep")])
    ).toEqual({ label: null, effort: 'high' })
  })

  it('answers a system-row output too, and the newest command wins', () => {
    expect(
      sessionCommandPair([
        out('a', 'Set effort level to low (this session only): Quick'),
        row('b', 'system', '<local-command-stdout>Set effort level to high (this session only): Deep</local-command-stdout>')
      ])
    ).toEqual({ label: null, effort: 'high' })
  })

  it('says nothing for an empty list, one unrelated row, a user prompt that quotes the wording, or garbage', () => {
    expect(sessionCommandPair([])).toBeNull()
    expect(sessionCommandPair([row('a', 'assistant', 'hello')])).toBeNull()
    expect(sessionCommandPair([row('a', 'user', 'please explain "Set effort level to low (this session only)"')])).toBeNull()
    expect(sessionCommandPair([out('a', 'Set effort level to purple (this session only)')])).toBeNull()
    expect(sessionCommandPair([out('a', '')])).toBeNull()
  })

  it('reads one row alone: the first and last row are the same', () => {
    expect(sessionCommandPair([out('only', 'Set effort level to high (this session only): Deep')])).toEqual({ label: null, effort: 'high' })
  })

  it('ignores colour codes the CLI may leave in its output', () => {
    expect(sessionCommandPair([out('a', 'Set model to `\u001b[1mOpus 5.5\u001b[22m` for this session only')])).toEqual({
      label: 'Opus 5.5',
      effort: null
    })
  })
})

describe('"Kept model as" (a picker closed on the same model)', () => {
  it('keeps the effort it already had and names the model', () => {
    expect(
      sessionCommandPair([
        out('a', 'Set model to `Opus 5.5` for this session only with high effort'),
        out('b', 'Kept model as `Opus 5.5`')
      ])
    ).toEqual({ label: 'Opus 5.5', effort: 'high' })
  })
  it('states no effort for a kept model it had not seen set', () => {
    expect(sessionCommandPair([out('a', 'Kept model as `Opus 5.5`')])).toEqual({ label: 'Opus 5.5', effort: null })
  })
})
