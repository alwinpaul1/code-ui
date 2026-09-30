// A desk prompt's hook copy is dropped as landed when a user row of its words
// is in the transcript. Any such row counted, however far back, so a mid-turn
// "keep going with the task" that repeated an earlier turn was dropped at
// once. Claude Code writes no row for a message it takes mid-turn, so the copy
// was the only one and the message was drawn nowhere (review of the chat-echo
// batch, 2026-09-30: `expected [] to deeply equal [ 'n1' ]`). The hook names
// the row that was last when the prompt was submitted (`at=`); a row at or
// before it was written before the prompt and cannot be its landing.
import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { withoutLandedDesktopPrompts } from './use-desktop-prompt-echoes'

const WORDS = 'keep going with the task'
const T0 = Date.parse('2026-09-30T09:00:00Z')

const user = (id: string, text: string, at = T0): NativeChatMessage => ({ id, role: 'user', blocks: [{ type: 'text', text }], timestamp: at, source: 'transcript' })
const reply = (id: string, at = T0): NativeChatMessage => ({ id, role: 'assistant', blocks: [{ type: 'text', text: 'ok' }], timestamp: at, source: 'transcript' })

/** The prompt hook's copy of a submission (agent-hud-beacon.ts): the hook's
 *  pid, the words, the row that was last at submit, the hook's whole-second
 *  time, and when the phone received it. */
const hookCopy = (nonce: string, anchorId: string, text = WORDS): DesktopPrompt => ({
  nonce,
  text,
  cut: false,
  anchorId,
  typedAt: T0 + 120_000,
  seenAt: T0 + 120_400
})

const kept = (prompts: DesktopPrompt[], raw: NativeChatMessage[], alsoShown: string[] = []): string[] =>
  withoutLandedDesktopPrompts(prompts, raw, alsoShown, raw).map((prompt) => prompt.nonce)

describe('a desk prompt with the words of an earlier turn', () => {
  const earlier = [user('u1', WORDS, T0 + 1_000), reply('a1', T0 + 30_000), reply('a2', T0 + 90_000)]

  it('stays while the only row of its words came before the row it was typed after', () => {
    expect(kept([hookCopy('n1', 'a2')], earlier)).toEqual(['n1'])
  })

  // The failure path: a row of its words after the row it names is its own
  // (typed with the agent idle, or dequeued at the turn's end), and lands it.
  it('is landed by a row of its words after the row it was typed after, straight after or rows later', () => {
    expect(kept([hookCopy('n1', 'a2')], [...earlier, user('u3', WORDS)])).toEqual([])
    expect(kept([hookCopy('n1', 'a1')], [...earlier, reply('a3'), user('u4', WORDS)])).toEqual([])
  })

  it('stays when an earlier turn is a longer message its cut copy begins, and lands on a later one', () => {
    const long = `${WORDS} and then run the whole suite`
    const cut: DesktopPrompt = { ...hookCopy('n1', 'a1'), text: WORDS, cut: true }
    expect(kept([cut], [user('u0', long), reply('a1')])).toEqual(['n1'])
    expect(kept([cut], [user('u0', long), reply('a1'), user('u2', long)])).toEqual([])
  })

  // A status copy stands for the hook's copy it was paired with, and is
  // placed by the row that copy names (hookSubmissionOf).
  it('stays as a status copy whose hook copy names a row after the earlier turn', () => {
    const status: DesktopPrompt = {
      nonce: 'status:s:1:0',
      text: WORDS,
      at: T0 + 119_000,
      seenAt: T0 + 120_000,
      hookTwin: { nonce: '71001', anchorId: 'a2', seenAt: T0 + 120_400 }
    }
    expect(kept([status], earlier)).toEqual(['status:s:1:0'])
    expect(kept([status], [...earlier, user('u3', WORDS)])).toEqual([])
  })

  // What the queue box lists has no row: it is the box NOW, where a message
  // still queued is drawn, and a copy of its words is drawn there, not as a
  // bubble above it, wherever the earlier turn sits.
  it('is left to the queue box while the box lists its words', () => {
    expect(kept([hookCopy('n1', 'a2')], earlier, [WORDS])).toEqual([])
  })

  it('lands as before when it names no row, or a row the chat does not hold', () => {
    expect(kept([{ ...hookCopy('n1', 'a2'), anchorId: undefined }], earlier)).toEqual([])
    // Paged out above the loaded window: every row held is after it.
    expect(kept([hookCopy('n1', 'gone')], earlier)).toEqual([])
  })

  describe('at the edges of the transcript', () => {
    it('stays when the row it names is the last row, and lands on the next', () => {
      const rows = [user('u1', WORDS), reply('a1')]
      expect(kept([hookCopy('n1', 'a1')], rows)).toEqual(['n1'])
      expect(kept([hookCopy('n1', 'a1')], [...rows, user('u2', WORDS)])).toEqual([])
    })

    it('stays when the row it names is the first row and a user row of its words, and lands on the next', () => {
      const rows = [user('u0', WORDS)]
      expect(kept([hookCopy('n1', 'u0')], rows)).toEqual(['n1'])
      expect(kept([hookCopy('n1', 'u0')], [...rows, user('u1', WORDS)])).toEqual([])
    })

    it('is landed by the row straight after the first row it names', () => {
      expect(kept([hookCopy('n1', 'a0')], [reply('a0'), user('u1', WORDS)])).toEqual([])
    })

    it('stays over an empty transcript', () => {
      expect(kept([hookCopy('n1', 'a1')], [])).toEqual(['n1'])
    })
  })
})
