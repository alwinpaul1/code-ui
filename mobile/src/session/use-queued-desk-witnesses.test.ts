// A message the agent's queue box still lists is remembered where it arrived,
// so one the agent takes while the chat is closed is drawn there when the chat
// comes back (final review of fix/midturn-prompt-at-end, 2026-09-29). The
// overlay cases are in mobile-chat-midturn-prompt-after-reply.test.ts.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileChatQueueEntry } from './mobile-terminal-queued-messages'
import { echoMemoryId } from './mobile-native-chat-remember-echo'
import { useQueuedDeskWitnesses } from './use-queued-desk-witnesses'
import type { WitnessToRemember } from './mobile-native-chat-witness-memory'

const row = (id: string): NativeChatMessage => ({ id, role: 'assistant', blocks: [], timestamp: 1, source: 'transcript' })

function reader(scope = 'scope') {
  let renderer: ReactTestRenderer | null = null
  let out: WitnessToRemember[] = []
  function Probe({ entries, rows, scopeKey }: { entries: MobileChatQueueEntry[]; rows: NativeChatMessage[]; scopeKey: string }) {
    out = useQueuedDeskWitnesses(entries, rows, scopeKey)
    return null
  }
  return (entries: MobileChatQueueEntry[], rows: NativeChatMessage[], scopeKey = scope) => {
    act(() => {
      const element = createElement(Probe, { entries, rows, scopeKey })
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
    return out
  }
}

describe('a message the queue box lists', () => {
  it('is remembered where the chat first saw it, however long it stays', () => {
    const read = reader()
    expect(read(['check the logs'], [row('a1')])).toEqual([{ id: echoMemoryId('check the logs'), text: 'check the logs', anchorId: 'a1' }])
    expect(read(['check the logs'], [row('a1'), row('a2'), row('a3')]).map((witness) => witness.anchorId)).toEqual(['a1'])
  })

  it('is not a phone send the box stands in for, a reading run into the tool rows, or an empty row', () => {
    const read = reader()
    const ownSend: MobileChatQueueEntry = { text: 'mine', images: [], caption: 'mine' }
    expect(read([ownSend, 'taken\n⎿  $ ls', '   ', 'desk words'], [row('a1')]).map((witness) => witness.text)).toEqual(['desk words'])
  })

  // Degenerate: nothing listed, and no row to place it after yet.
  it('is not remembered with no row to place it after, and nothing is with an empty box', () => {
    const read = reader()
    expect(read([], [row('a1')])).toEqual([])
    expect(read(['first'], [])).toEqual([])
    expect(read(['first'], [row('a1')]).map((witness) => witness.anchorId)).toEqual(['a1'])
  })

  it('starts over for another chat', () => {
    const read = reader()
    read(['check the logs'], [row('a1')], 'one')
    expect(read(['check the logs'], [row('b9')], 'two').map((witness) => witness.anchorId)).toEqual(['b9'])
  })
})
