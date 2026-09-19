import { describe, expect, it } from 'vitest'
import { dedupeWitnessReadings, preferredWitnessReading } from './mobile-native-chat-witness-dedupe'

// 2026-09-13, on the phone: "see these messages what happening dude" stood
// three times — clean, "…dude Running 1 shell command…", and "…dude Capturing
// the phone screen right now" — the running tool's rows glued on by the
// parser, each stored as its own message.
describe('preferredWitnessReading', () => {
  it('keeps the complete reading over one that only glues rows onto it', () => {
    expect(
      preferredWitnessReading(
        'see these messages what happening dude',
        'see these messages what happening dude Running 1 shell command…'
      )
    ).toBe('a')
    expect(
      preferredWitnessReading(
        'see these messages what happening dude Capturing the phone screen right now',
        'see these messages what happening dude'
      )
    ).toBe('b')
  })

  it('lets a queue-box stub grow into the full text', () => {
    expect(preferredWitnessReading('fix the dock and the…', 'fix the dock and the composer')).toBe('b')
  })

  it('treats two different messages as different', () => {
    expect(preferredWitnessReading('fix this', 'fix this now')).toBe('a')
    expect(preferredWitnessReading('fix this', 'fix that')).toBeNull()
    expect(preferredWitnessReading('fix thisness', 'fix this')).toBeNull()
  })
})

describe('dedupeWitnessReadings', () => {
  it('collapses every glued variant onto the clean reading, in order', () => {
    const list = [
      { t: 'see these messages what happening dude Running 1 shell command…' },
      { t: 'other message' },
      { t: 'see these messages what happening dude' },
      { t: 'see these messages what happening dude Capturing the phone screen right now' }
    ]
    expect(dedupeWitnessReadings(list, (i) => i.t).map((i) => i.t)).toEqual([
      'other message',
      'see these messages what happening dude'
    ])
  })
})

// Claude Code paints a prompt's inline code without the backticks (queue box,
// 2.1.278). The phone's own copy keeps them, so the two readings of one send
// were "different messages" and the send drew twice (2026-09-19).
it('reads the painted row and the typed text as the same message when only backticks differ', () => {
  const typed = 'written as a `user` row with `turnOrigin: "scheduled"` inside'
  const painted = 'written as a user row with turnOrigin:\n"scheduled" inside'
  expect(preferredWitnessReading(typed, painted)).toBe('a')
})
