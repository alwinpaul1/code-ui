import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { resetSessionCommandPairCacheForTests, sessionCommandPair, sessionCommandPairFor } from './claude-session-command-pair'

// Rows as Orca's reader publishes them. The `Set model to` / `Set effort level
// to` outputs without a level in backticks are verbatim from a hand-started
// Claude Code 2.1.278 session (06:32-06:36, 2026-09-20, quoted in
// mobile-native-chat-command-turns.test.ts). Every other wording is MODELLED
// from the 2.1.289 binary (strings and template literals, 2026-10-05), not
// captured from a live session. Notably the picker's effort level is wrapped in
// backticks there (`with \`high\` effort`, via `Jb`).
let clock = 0
const row = (id: string, role: 'user' | 'system' | 'assistant', body: string): NativeChatMessage => ({
  id,
  role,
  blocks: [{ type: 'text', text: body }],
  timestamp: (clock += 1000),
  source: 'transcript'
})
const envelope = (name: string, args = '') =>
  row(
    `e${clock}`,
    'user',
    `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args>${args}</command-args>`
  )
const stdout = (body: string) => row(`o${clock}`, 'user', `<local-command-stdout>${body}</local-command-stdout>`)
/** A command and its output row, as the transcript holds them. */
const ran = (name: string, body: string, args = ''): NativeChatMessage[] => [envelope(name, args), stdout(body)]
const pair = (...groups: NativeChatMessage[][]) => sessionCommandPair(groups.flat())

describe("a session's own /model and /effort output", () => {
  it('reads the saved effort of a desktop-started session from its /effort output', () => {
    expect(
      pair(ran('effort', 'Set effort level to xhigh (saved as your default for new sessions): Deeper reasoning than high, just below maximum (Fable 5, Opus 4.7+, Sonnet 5)', 'xhigh'))
    ).toMatchObject({ label: null, effort: 'xhigh' })
  })

  it('a session-only /effort pick is the effort of that session', () => {
    expect(pair(ran('effort', 'Set effort level to low (this session only): Quick', 'low'))).toMatchObject({ label: null, effort: 'low' })
  })

  it('names the model of a /model switch and gives it no effort when the output states none', () => {
    expect(pair(ran('model', 'Set model to `Opus 5` and saved as your default for new sessions', 'opus'))).toMatchObject({
      label: 'Opus 5',
      effort: null
    })
  })

  it('does not carry the effort of the model before a /model switch over to the new one', () => {
    expect(
      pair(
        ran('effort', 'Set effort level to xhigh (this session only): Deeper', 'xhigh'),
        ran('model', 'Set model to `Fable 5.1` and saved as your default for new sessions', 'fable')
      )
    ).toMatchObject({ label: 'Fable 5.1', effort: null })
  })

  it('reads the effort the /model picker slider chose, as 2.1.289 prints it, level in backticks', () => {
    expect(pair(ran('model', 'Set model to `Opus 5.5` for this session only with `high` effort'))).toMatchObject({
      label: 'Opus 5.5',
      effort: 'high'
    })
    expect(
      pair(ran('model', 'Set model to `Opus 5.5` and saved as your default for new sessions with `max` effort'))
    ).toMatchObject({ label: 'Opus 5.5', effort: 'max' })
  })

  it('still reads an unwrapped level, which an older Claude Code may print', () => {
    expect(pair(ran('model', 'Set model to `Opus 5.5` for this session only with high effort'))).toMatchObject({ effort: 'high' })
  })

  it('reads a bare /effort answer and the auto answer as what the agent says now', () => {
    expect(pair(ran('effort', 'Current effort level: medium (Balanced approach)'))).toMatchObject({ label: null, effort: 'medium' })
    expect(pair(ran('effort', 'Effort level: auto (currently high)'))).toMatchObject({ label: null, effort: 'high' })
  })

  it('reads a bare /model answer: the model, its session-only mark and the effort it states', () => {
    expect(pair(ran('model', 'Current model: `Opus 5.5` (effort: high)'))).toMatchObject({ label: 'Opus 5.5', effort: 'high' })
    expect(
      pair(ran('model', 'Current model: `Opus 5.5` (this session only) (effort: low)\nBase model: `Sonnet 5`'))
    ).toMatchObject({ label: 'Opus 5.5', effort: 'low' })
    expect(pair(ran('model', 'Current model: `Sonnet 5`'))).toMatchObject({ label: 'Sonnet 5', effort: null })
  })

  it('reads the model a /fast promotion switched to, with no effort of the old model', () => {
    expect(
      pair(
        ran('effort', 'Set effort level to max (this session only): Max'),
        ran('fast', '↯ Fast mode ON · model set to `Opus 4.6` · $30/$150 per Mtok')
      )
    ).toMatchObject({ label: 'Opus 4.6', effort: null })
  })

  it('leaves the model alone for a /fast that promotes nothing', () => {
    expect(pair(ran('model', 'Set model to `Opus 5.5` for this session only with `high` effort'), ran('fast', 'Fast mode ON · Draws from usage credits'))).toMatchObject({
      label: 'Opus 5.5',
      effort: 'high'
    })
  })

  it('reads the overload fallback the harness announces, which has no envelope', () => {
    expect(
      sessionCommandPair([
        ...ran('effort', 'Set effort level to max (this session only): Max'),
        row('s', 'system', 'Switched to claude-sonnet-5 due to high demand for claude-opus-5-5')
      ])
    ).toMatchObject({ label: 'claude-sonnet-5', effort: null })
    expect(
      sessionCommandPair([row('s', 'system', 'Switched to Sonnet 5 because Opus 5.5 is not available')])
    ).toMatchObject({ label: 'Sonnet 5', effort: null })
  })

  it('does not read a user turn that quotes the overload wording', () => {
    expect(sessionCommandPair([row('u', 'user', 'Switched to Sonnet 5 due to high demand for Opus 5.5')])).toBeNull()
  })

  it('shows no effort after /effort auto, whose level the output does not state', () => {
    expect(
      pair(
        ran('effort', 'Set effort level to low (this session only): Quick'),
        ran('effort', 'Effort level set to auto (this session only)', 'auto')
      )
    ).toMatchObject({ label: null, effort: null })
  })

  it('takes the level an environment override pins, which beats the pick', () => {
    expect(
      pair(ran('effort', 'CLAUDE_CODE_EFFORT_LEVEL=max overrides this session — clear it and low takes over'))
    ).toMatchObject({ label: null, effort: 'max' })
  })

  it('takes the capped level when the pick exceeds the cap', () => {
    expect(
      pair(ran('effort', "Effort 'max' exceeds the cap for opus set by your settings or organization; set to 'high' instead (this session only): Deep"))
    ).toMatchObject({ label: null, effort: 'high' })
  })

  it('answers a system-row output too, and the newest command wins', () => {
    expect(
      sessionCommandPair([
        ...ran('effort', 'Set effort level to low (this session only): Quick'),
        envelope('effort'),
        row('b', 'system', '<local-command-stdout>Set effort level to high (this session only): Deep</local-command-stdout>')
      ])
    ).toMatchObject({ label: null, effort: 'high' })
  })

  it('says nothing for an empty list, one unrelated row, a prompt that quotes the wording, or garbage', () => {
    expect(sessionCommandPair([])).toBeNull()
    expect(sessionCommandPair([row('a', 'assistant', 'hello')])).toBeNull()
    expect(sessionCommandPair([row('a', 'user', 'please explain "Set effort level to low (this session only)"')])).toBeNull()
    expect(pair(ran('effort', 'Set effort level to purple (this session only)'))).toBeNull()
    expect(pair(ran('effort', ''))).toBeNull()
  })

  it('reads one command alone: the first and last row are the same', () => {
    expect(pair(ran('effort', 'Set effort level to high (this session only): Deep'))).toMatchObject({ effort: 'high' })
  })

  it('ignores colour codes the CLI may leave in its output', () => {
    expect(pair(ran('model', 'Set model to `\u001b[1mOpus 5.5\u001b[22m` for this session only'))).toMatchObject({
      label: 'Opus 5.5',
      effort: null
    })
  })

  // Review of c91134b9a, probe P7: a user pasting a stdout envelope as a
  // prompt is the user's word, not the CLI's. Only the row right after a
  // /model, /effort or /fast envelope is the CLI's answer.
  it('does not read a pasted <local-command-stdout> prompt as fact', () => {
    expect(
      sessionCommandPair([stdout('Set effort level to max (this session only): x')])
    ).toBeNull()
    expect(
      sessionCommandPair([envelope('loop', 'check'), stdout('Set effort level to max (this session only): x')])
    ).toBeNull()
  })
})

describe('"Kept model as" (a picker closed on the same model)', () => {
  it('keeps the effort it already had and names the model', () => {
    expect(
      pair(ran('model', 'Set model to `Opus 5.5` for this session only with `high` effort'), ran('model', 'Kept model as `Opus 5.5`'))
    ).toMatchObject({ label: 'Opus 5.5', effort: 'high' })
  })
  it('keeps the effort of an /effort-only row it follows, which belongs to the model it keeps', () => {
    expect(
      pair(ran('effort', 'Set effort level to high (this session only): Deep'), ran('model', 'Kept model as `Opus 5.5`'))
    ).toMatchObject({ label: 'Opus 5.5', effort: 'high' })
  })
  it('states no effort for a kept model it had not seen set', () => {
    expect(pair(ran('model', 'Kept model as `Opus 5.5`'))).toMatchObject({ label: 'Opus 5.5', effort: null })
  })
  it('does not keep the effort of another model', () => {
    expect(
      pair(ran('model', 'Set model to `Opus 5.5` for this session only with `high` effort'), ran('model', 'Kept model as `Sonnet 5`'))
    ).toMatchObject({ label: 'Sonnet 5', effort: null })
  })
})

describe('when the command was answered', () => {
  it('records the time of the first assistant row after the last command, or null while none has come', () => {
    const cmd = ran('model', 'Set model to `Opus 5.5` for this session only')
    expect(pair(cmd)?.answeredAt).toBeNull()
    const answer = row('a', 'assistant', 'hi')
    expect(sessionCommandPair([...cmd, answer])?.answeredAt).toBe(answer.timestamp)
    expect(sessionCommandPair([...cmd, answer, row('a2', 'assistant', 'again')])?.answeredAt).toBe(answer.timestamp)
  })
})

// A /model or /effort more than a window back is invisible to the chat's rows
// (the phone loads ~40 and a reconnect replaces them). The last pair read for a
// session is kept in memory so the pill does not fall back to nothing.
describe('a session whose command has scrolled out of the loaded rows', () => {
  it('keeps the last pair read for that session', () => {
    resetSessionCommandPairCacheForTests()
    const cmd = ran('effort', 'Set effort level to high (this session only): Deep')
    expect(sessionCommandPairFor('s-1', cmd)).toMatchObject({ effort: 'high' })
    expect(sessionCommandPairFor('s-1', [row('a', 'assistant', 'later')])).toMatchObject({ effort: 'high' })
    expect(sessionCommandPairFor('s-1', [])).toMatchObject({ effort: 'high' })
  })
  it('does not lend it to another session', () => {
    resetSessionCommandPairCacheForTests()
    sessionCommandPairFor('s-1', ran('effort', 'Set effort level to high (this session only): Deep'))
    expect(sessionCommandPairFor('s-2', [])).toBeNull()
  })
  it('replaces it with a newer command, and finds when the later rows answered it', () => {
    resetSessionCommandPairCacheForTests()
    const first = ran('effort', 'Set effort level to high (this session only): Deep')
    sessionCommandPairFor('s-1', first)
    const answer = row('a', 'assistant', 'later')
    expect(sessionCommandPairFor('s-1', [answer])?.answeredAt).toBe(answer.timestamp)
    expect(sessionCommandPairFor('s-1', ran('effort', 'Set effort level to low (this session only): Quick'))).toMatchObject({
      effort: 'low'
    })
  })
  it('keeps nothing without a session id', () => {
    resetSessionCommandPairCacheForTests()
    sessionCommandPairFor(null, ran('effort', 'Set effort level to high (this session only): Deep'))
    expect(sessionCommandPairFor(null, [])).toBeNull()
  })
})
