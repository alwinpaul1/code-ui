import { describe, expect, it } from 'vitest'
import { mergeDesktopPrompts } from './desktop-prompt-merge'
import type { DesktopPrompt } from './agent-hud-beacon'

describe('one list of desktop prompts from the tab status and the beacon', () => {
  it('lets the status copy win over the beacon copy of the same message, and keeps the rest', () => {
    // A phone-launched session beacons a desktop prompt from its own hook
    // AND Orca's hook puts it on the tab status; the status copy carries
    // the time the prompt was taken.
    const merged = mergeDesktopPrompts(
      [{ nonce: 'status:s:1:0', text: 'fix the queue', at: 1000 }],
      [
        { nonce: 'beacon-1', text: 'fix the queue' },
        { nonce: 'beacon-2', text: 'and the pill' }
      ]
    )
    expect(merged).toEqual([
      { nonce: 'status:s:1:0', text: 'fix the queue', at: 1000 },
      { nonce: 'beacon-2', text: 'and the pill' }
    ])
  })

  it('is the beacon alone on a host that publishes no status, and empty for neither', () => {
    expect(mergeDesktopPrompts([], [{ nonce: 'b', text: 'hello' }])).toEqual([{ nonce: 'b', text: 'hello' }])
    expect(mergeDesktopPrompts([], [])).toEqual([])
  })
})

// Claude Code fires UserPromptSubmit for a message a subagent sends its lead
// (2.1.283: the prompt is the `<agent-message …>` wrapper), so the phone's own
// prompt hook beacons it like a typed prompt. The status copy of such a
// message has been seen-not-echoed since 2026-09-20; the beacon copy went
// straight into the desktop prompts, and every desktop prompt is drawn as the
// user's own bubble.
describe("a subagent's message the prompt hook beaconed", () => {
  it('never reaches the desktop prompts, so it is never drawn as the user bubble', async () => {
    const { SUBAGENT_HANDBACK_PROMPT, SUBAGENT_HANDBACK_USER_ROW, SUBAGENT_REQUEST_PROMPT } = await import(
      './fixtures/claude-agent-message-read-image-2.1.283'
    )
    const merged = mergeDesktopPrompts(
      [],
      [
        { nonce: '4101', text: SUBAGENT_REQUEST_PROMPT },
        { nonce: '4102', text: SUBAGENT_HANDBACK_PROMPT, cut: true },
        { nonce: '4103', text: SUBAGENT_HANDBACK_USER_ROW, cut: true },
        { nonce: '4104', text: 'and the pill' }
      ]
    )
    expect(merged).toEqual([{ nonce: '4104', text: 'and the pill' }])
  })

  it("keeps a person's prompt that merely quotes the wrapper mid-sentence", () => {
    const text = 'why does <agent-message from="x"> show up in the log?'
    expect(mergeDesktopPrompts([], [{ nonce: '1', text }])).toEqual([{ nonce: '1', text }])
  })
})

// Review of 004ce958: the status cuts a prompt at 200 characters, so two desk
// messages that agree that far fold to one status text. The first was watched
// (its status copy, and its beacon copy in full); the second, typed mid-turn,
// got no status copy (the same text as the last) and only the beacon's. Every
// beacon copy that folded to a status text was dropped, so the second was
// listed nowhere, and as a mid-turn message it has no row either.
describe('two long desk messages that agree for their first 200 characters', () => {
  const head = 'check the fold on every screen size we ship and write down each one that clips, '.repeat(3)
  const first = `${head}then fix the worst`
  const second = `${head}then leave them for tomorrow`
  const statusFirst: DesktopPrompt = { nonce: 'status:s:1000:0', text: first.slice(0, 200).trimEnd(), cut: true, at: 1000, seenAt: 1000 }

  it('keeps the second from the beacon: a status copy stands for one beacon copy, its nearest', () => {
    const beacon: DesktopPrompt[] = [
      { nonce: '9001', text: first, anchorId: 'a1', seenAt: 1000 },
      { nonce: '9002', text: second, anchorId: 'a2', seenAt: 5000 }
    ]
    expect(mergeDesktopPrompts([statusFirst], beacon).map((prompt) => prompt.nonce)).toEqual(['status:s:1000:0', '9002'])
  })

  // Review of 08813139: paired from the beacon side in list order, the older
  // message took the status copy first, and the one the status really carried
  // was kept beside its own status copy, drawn twice.
  it('pairs the status copy with the second, which it carried, after a remount', () => {
    const statusSecond: DesktopPrompt = { nonce: 'status:s:1000:0', text: second.slice(0, 200).trimEnd(), cut: true, at: 1000, atStateStart: true, seenAt: 10_000 }
    const beacon: DesktopPrompt[] = [
      { nonce: '9001', text: first, anchorId: 'a1', seenAt: 2_000 },
      { nonce: '9002', text: second, anchorId: 'a2', seenAt: 5_000 }
    ]
    expect(mergeDesktopPrompts([statusSecond], beacon).map((prompt) => prompt.nonce)).toEqual(['status:s:1000:0', '9001'])
  })
})

// W1 of the review of fix/midturn-gaps (2026-09-29): drawn and remembered as
// the field's 200-character cut, a long message matched neither the queue
// box's whole reading of it nor its row, and came back as two once the chat
// had closed before the box listed it.
describe('a status copy the field cut, and the hook copy of the same message', () => {
  const words = `${'make the retry path log every failure with its attempt number, '.repeat(4)}and the last one`
  const cutCopy: DesktopPrompt = { nonce: 'status:s:1000:0', text: words.replace(/\s+/g, ' ').slice(0, 200), cut: true, at: 1000, seenAt: 1000 }

  it('carries the words as typed, with its own nonce and time', () => {
    const merged = mergeDesktopPrompts([cutCopy], [{ nonce: '9001', text: words, cut: false, anchorId: 'a1', seenAt: 1100 }])
    expect(merged).toEqual([{ ...cutCopy, text: words, cut: false }])
  })

  it('stays cut when the hook cut the words too, at 2,000 bytes', () => {
    const long = `${words} ${'x'.repeat(2000)}`
    const merged = mergeDesktopPrompts([cutCopy], [{ nonce: '9001', text: long.slice(0, 2000), cut: true, seenAt: 1100 }])
    expect(merged.map((prompt) => [prompt.nonce, prompt.cut, prompt.text.length])).toEqual([['status:s:1000:0', true, 2000]])
  })

  // Review of W1's fix: the phone never got the first message's hook copy,
  // and the status made no copy of the second, which shares its first 200
  // characters. The second's hook copy, read well after the status copy, is
  // a submission of its own: paired, the first took its words and it was
  // drawn nowhere.
  it('pairs only with a hook copy that reached the phone within 30 s of the status copy', () => {
    const later = `${words}, and one more`
    expect(mergeDesktopPrompts([cutCopy], [{ nonce: '9003', text: later, seenAt: 1000 + 30_001 }])).toEqual([
      cutCopy,
      { nonce: '9003', text: later, seenAt: 1000 + 30_001 }
    ])
    expect(mergeDesktopPrompts([cutCopy], [{ nonce: '9003', text: later, seenAt: 1000 + 30_000 }]).map((prompt) => prompt.text)).toEqual([later])
    // One found after it arrived, and one with no arrival time, pair as before.
    expect(mergeDesktopPrompts([cutCopy], [{ nonce: '9003', text: later, seenAt: 10 }]).map((prompt) => prompt.text)).toEqual([later])
    expect(mergeDesktopPrompts([cutCopy], [{ nonce: '9003', text: later }]).map((prompt) => prompt.text)).toEqual([later])
  })

  // Degenerate: a whole status copy, and one with no twin, are left as they are.
  it('leaves a whole status copy and a cut one with no twin as they were', () => {
    const whole: DesktopPrompt = { nonce: 'status:s:1000:1', text: 'fix the\n\nqueue'.replace(/\s+/g, ' '), at: 1000, seenAt: 1000 }
    expect(mergeDesktopPrompts([whole], [{ nonce: '9002', text: 'fix the\n\nqueue', seenAt: 1000 }])).toEqual([whole])
    expect(mergeDesktopPrompts([cutCopy], [])).toEqual([cutCopy])
  })
})

