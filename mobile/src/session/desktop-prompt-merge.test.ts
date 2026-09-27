import { describe, expect, it } from 'vitest'
import { mergeDesktopPrompts } from './desktop-prompt-merge'

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
})
