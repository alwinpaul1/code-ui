import { describe, expect, it } from 'vitest'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { useAbsorbedQueueEchoes } from './use-absorbed-queue-echoes'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import ROWS from './__fixtures__/pr919-queued-run.json'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

// Real rows, lifted verbatim from the live pr-919 transcript (Claude Code
// 2.1.272, .claude-work/…/63b835a8….jsonl): a queued prompt, the reply it drew,
// the tool work in between, and the next queued prompt. This is the exact run
// that came out of the phone stacked at the bottom with no replies between.
const MESSAGES = ROWS as unknown as NativeChatMessage[]

function textOf(message: NativeChatMessage): string {
  return message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

describe('the run that was reported stacked', () => {
  it('reads as prompt, reply, then the next prompt', () => {
    const folded = foldMobileNativeChatMessages(MESSAGES)
    const shape = folded.map((message) => {
      const text = textOf(message)
      if (text.startsWith('1050 isnt charging')) {
        return 'PROMPT 1'
      }
      if (text.startsWith('1050 is daimler')) {
        return 'PROMPT 2'
      }
      return message.role === 'user' ? 'user-other' : 'reply'
    })
    // Both prompts present, in order, with the agent's work between them.
    expect(shape.filter((entry) => entry.startsWith('PROMPT'))).toEqual(['PROMPT 1', 'PROMPT 2'])
    const first = shape.indexOf('PROMPT 1')
    const second = shape.indexOf('PROMPT 2')
    expect(first).toBeLessThan(second)
    expect(shape.slice(first + 1, second)).toContain('reply')
  })

  it('never puts the two prompts next to each other', () => {
    const folded = foldMobileNativeChatMessages(MESSAGES)
    const positions = folded
      .map((message, index) => ({ index, text: textOf(message) }))
      .filter(({ text }) => text.startsWith('1050 isnt charging') || text.startsWith('1050 is daimler'))
      .map(({ index }) => index)
    expect(positions).toHaveLength(2)
    expect(positions[1]! - positions[0]!).toBeGreaterThan(1)
  })

  it('keeps the reply the first prompt drew, in between', () => {
    const folded = foldMobileNativeChatMessages(MESSAGES)
    const between = folded
      .slice(
        folded.findIndex((m) => textOf(m).startsWith('1050 isnt charging')) + 1,
        folded.findIndex((m) => textOf(m).startsWith('1050 is daimler'))
      )
      .map(textOf)
      .join(' ')
    expect(between).toContain('Let me check 1050 the same way')
    expect(between).toContain('Daimler trace disagrees')
  })
})

// The three tests above pass with or without the change — checked by reverting
// it. They are EVIDENCE, not a guard: they show the transcript alone already
// carries this run in the right order, which is the whole reason the witness
// could go. What the change actually removed is what the phone layered ON TOP,
// and that needs the scrollback fed to see it.
let latest: MobileNativeChatPendingMessage[] = []
function Probe({
  queued,
  scrollback,
  messages
}: {
  queued: string[]
  scrollback: string[]
  messages: NativeChatMessage[]
}) {
  latest = useAbsorbedQueueEchoes(queued, scrollback, messages, 'order-scope', messages, [])
  return null
}

describe('what the phone adds on top of that run', () => {
  it('adds nothing once the rows have landed', () => {
    let renderer: ReactTestRenderer | null = null
    act(() => {
      renderer = create(
        createElement(Probe, {
          queued: ['1050 is daimler thingy'],
          scrollback: [],
          messages: MESSAGES
        })
      )
    })
    act(() => {
      renderer!.update(createElement(Probe, { queued: [], scrollback: [], messages: MESSAGES }))
    })
    expect(latest).toEqual([])
    act(() => renderer!.unmount())
  })

  it('adds no second copy from the scrollback, glued or clean', () => {
    // This is the one that fails on the old code. The scrollback reading of
    // this very run glued the agent's reply onto the prompt, and the result
    // matched no row, so it was drawn as an extra bubble at the bottom — the
    // stacking that was reported.
    const glued =
      "1050 is daimler thingy I can't confirm it from here: distinguishing the two needs the raw " +
      'battery_power_kw series. session:ok'
    // It has to APPEAR while the phone is watching: the old code only held a
    // reading it saw arrive, so starting with it already on screen proves
    // nothing. First an empty screen, then the reading shows up.
    let renderer: ReactTestRenderer | null = null
    act(() => {
      renderer = create(
        createElement(Probe, { queued: [], scrollback: [], messages: MESSAGES })
      )
    })
    act(() => {
      renderer!.update(
        createElement(Probe, { queued: [], scrollback: [glued], messages: MESSAGES })
      )
    })
    expect(latest).toEqual([])
    act(() => renderer!.unmount())
  })
})
