import { describe, expect, it } from 'vitest'
import { isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ccrRefusalCardOf, ccrRefusalWords, CCR_REFUSAL_LEARN_MORE_URL } from './ccr-refusal-rows'
import { ccrEventDrawsRow, decodeCcrEvents } from './ccr-transcript-decode'
import { prompt, refusalFallback, refusalNoFallback } from './fixtures/ccr-refusal-suggestion-events-2.1.300'

// G10. What the Claude app 1.261013.20 draws for Claude Code's refusal events (reducer t5v.java
// 1062-1112, cards np30.java `b`/`c`/`d` and op30.java `e`/`o`, words res/values/strings.xml
// ccr_refusal_*). The events are built from Claude Code 2.1.300's schemas, never captured live
// (fixtures/ccr-refusal-suggestion-events-2.1.300.ts).

function cards(rows: readonly NativeChatMessage[]) {
  return rows.flatMap((row) => row.blocks.flatMap((block) => (isTextBlock(block) ? [ccrRefusalCardOf(block)].filter((card) => card !== null) : [])))
}

describe('a refusal in a matched Claude tab draws the Claude app’s card', () => {
  it('a turn the model refused and retried on another model reads "Switched to Sonnet 5", not nothing', () => {
    const rows = decodeCcrEvents([prompt('u-refused', 'Scan my server'), refusalFallback({ original: 'claude-opus-5', fallback: 'claude-sonnet-5', category: 'cyber', refused: 'u-refused' })], new WeakMap())
    const [card] = cards(rows)
    expect(card).toMatchObject({ kind: 'fallback', originalModel: 'claude-opus-5', fallbackModel: 'claude-sonnet-5', category: 'cyber', refusedUuid: 'u-refused' })
    expect(rows.at(-1)!.role).toBe('system')
    expect(ccrRefusalWords(card!, { rewindable: false })).toEqual({
      headline: 'Switched to Sonnet 5',
      body: 'Opus 5 has specific safety measures that flag messages with cybersecurity topics. Switched to Sonnet 5.',
      details: 'Details: [cyber]'
    })
  })

  it('the switch card words a biology refusal and an unknown category as the app does', () => {
    const bio = cards(decodeCcrEvents([refusalFallback({ original: 'claude-opus-5', fallback: 'claude-sonnet-5', category: 'bio' })], new WeakMap()))[0]!
    expect(ccrRefusalWords(bio, { rewindable: false }).body).toBe('Opus 5 has specific safety measures that flag messages with biology topics. Switched to Sonnet 5.')
    const other = cards(decodeCcrEvents([refusalFallback({ original: 'claude-opus-5', fallback: 'claude-sonnet-5', category: 'weapons' })], new WeakMap()))[0]!
    expect(ccrRefusalWords(other, { rewindable: false })).toEqual({
      headline: 'Switched to Sonnet 5',
      body: 'Opus 5 has specific safety measures that flagged something in this message. Switched to Sonnet 5.',
      details: 'Details: [weapons]'
    })
  })

  it('a refusal with no category says nothing about one', () => {
    const card = cards(decodeCcrEvents([refusalFallback({ original: 'claude-opus-5', fallback: 'claude-sonnet-5', category: null })], new WeakMap()))[0]!
    expect(ccrRefusalWords(card, { rewindable: false }).details).toBeNull()
  })

  it('a refusal with no fallback reads "Session paused" and the category’s body', () => {
    const card = cards(decodeCcrEvents([refusalNoFallback({ original: 'claude-opus-5', category: 'cyber' })], new WeakMap()))[0]!
    expect(card).toMatchObject({ kind: 'paused', originalModel: 'claude-opus-5', fallbackModel: null })
    expect(ccrRefusalWords(card, { rewindable: false })).toEqual({
      headline: 'Session paused',
      body: 'Opus 5’s safety measures flagged this message for sensitive cybersecurity topics. To continue, switch to a different model or continue by editing your prompt on web or desktop.',
      details: 'Details: [cyber]'
    })
    const generic = cards(decodeCcrEvents([refusalNoFallback({ original: 'claude-opus-5' })], new WeakMap()))[0]!
    expect(ccrRefusalWords(generic, { rewindable: true }).body).toBe(
      'Opus 5’s safety measures flagged this message for sensitive topics. You can edit your prompt and try again, or switch to a different model.'
    )
  })

  it('the card knows the refused prompt’s words, the edit-and-retry prefill, from the prompt’s own row', () => {
    const rows = decodeCcrEvents([prompt('u-refused', 'Scan my server'), refusalNoFallback({ original: 'claude-opus-5', refused: 'u-refused' })], new WeakMap())
    expect(cards(rows)[0]!.promptText).toBe('Scan my server')
  })

  it('a refusal whose prompt is not loaded, or names none, has nothing to retry', () => {
    expect(cards(decodeCcrEvents([refusalNoFallback({ original: 'claude-opus-5', refused: 'u-elsewhere' })], new WeakMap()))[0]!.promptText).toBeNull()
    expect(cards(decodeCcrEvents([prompt('u-1', 'hi'), refusalNoFallback({ original: 'claude-opus-5', refused: null })], new WeakMap()))[0]!.promptText).toBeNull()
  })

  it('a refusal that names no model draws no card, as the app refuses it', () => {
    expect(decodeCcrEvents([refusalFallback({ original: ' ', fallback: 'claude-sonnet-5' })], new WeakMap())).toEqual([])
    expect(decodeCcrEvents([refusalFallback({ original: 'claude-opus-5', fallback: '' })], new WeakMap())).toEqual([])
    expect(decodeCcrEvents([refusalNoFallback({ original: '' })], new WeakMap())).toEqual([])
  })

  it('a subagent’s refusal stays out of the lead’s chat', () => {
    expect(decodeCcrEvents([refusalFallback({ original: 'claude-opus-5', fallback: 'claude-sonnet-5', parent: 'toolu_agent' })], new WeakMap())).toEqual([])
  })

  it('a refusal card is kept with the session’s rows, so it survives a restart', () => {
    expect(ccrEventDrawsRow(refusalNoFallback({ original: 'claude-opus-5' }))).toBe(true)
  })

  it('Learn more opens the app’s own help article', () => {
    expect(CCR_REFUSAL_LEARN_MORE_URL).toBe('https://support.claude.com/articles/15363606')
  })
})
