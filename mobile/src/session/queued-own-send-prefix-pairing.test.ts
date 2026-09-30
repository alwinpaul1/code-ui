import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { pendingOutsideVisibleQueue, projectMobileChatQueue } from './mobile-terminal-queued-messages'
import { useQueuedOwnSends } from './use-queued-own-sends'

// Two phone sends queued while the agent works, the first a prefix of the
// second, each 24 characters or more (QUEUE_ROW_MATCH_FLOOR). Each row of the
// box went to the LONGEST send it is a prefix of, so the first row, the
// shorter send's own words exactly, was drawn with the longer send's text, the
// second row was left the screen's reading of the longer send, and the shorter
// send stayed pending: a chat bubble as well as a queue row. Recall and edit
// then worked on the wrong message (2026-09-30).

const SHORT = { id: 's', text: 'please continue with the next step' }
const LONG = { id: 'l', text: 'please continue with the next step and run tests' }

const rowText = (entry: unknown): string => (typeof entry === 'string' ? entry : (entry as { text: string }).text)

describe('two queued sends, one the start of the other', () => {
  it('shows each on its own row and neither as a bubble', () => {
    const projected = projectMobileChatQueue([SHORT, LONG], [SHORT.text, LONG.text])
    expect(projected.pending).toEqual([])
    expect(projected.queue).toEqual([
      { text: SHORT.text, images: [], caption: SHORT.text },
      { text: LONG.text, images: [], caption: LONG.text }
    ])
  })

  it('shows each on its own row whichever was sent first', () => {
    const projected = projectMobileChatQueue([LONG, SHORT], [LONG.text, SHORT.text])
    expect(projected.pending).toEqual([])
    expect(projected.queue.map(rowText)).toEqual([LONG.text, SHORT.text])
  })

  it('gives a row the box cut short with `…` to the longer send, and the whole row to the shorter', () => {
    const cut = 'please continue with the next step…'
    const projected = projectMobileChatQueue([LONG, SHORT], [cut, SHORT.text])
    expect(projected.pending).toEqual([])
    expect(projected.queue).toEqual([
      { text: LONG.text, images: [], caption: cut },
      { text: SHORT.text, images: [], caption: SHORT.text }
    ])
  })

  it('hides the same sends from the chat as the queue box shows', () => {
    expect(pendingOutsideVisibleQueue([SHORT, LONG], [SHORT.text, LONG.text])).toEqual([])
    expect(pendingOutsideVisibleQueue([SHORT, LONG], [LONG.text])).toEqual([SHORT])
  })

  it('leaves the shorter send a bubble while the box lists only the longer one', () => {
    const projected = projectMobileChatQueue([SHORT, LONG], [LONG.text])
    expect(projected.pending).toEqual([SHORT])
    expect(projected.queue).toEqual([{ text: LONG.text, images: [], caption: LONG.text }])
  })

  it('shows one send on its row, keeps a send with no row as a bubble, and a row with no send as the screen read it', () => {
    expect(projectMobileChatQueue([SHORT], [SHORT.text])).toEqual({
      pending: [],
      queue: [{ text: SHORT.text, images: [], caption: SHORT.text }]
    })
    expect(projectMobileChatQueue([SHORT], [])).toEqual({ pending: [SHORT], queue: [] })
    expect(projectMobileChatQueue([], [SHORT.text])).toEqual({ pending: [], queue: [SHORT.text] })
    expect(projectMobileChatQueue([], [])).toEqual({ pending: [], queue: [] })
  })

  it('shows each on its own row in the chat’s queue box while the agent works', () => {
    const now = Date.now()
    const pending = [
      { ...SHORT, sentAt: now },
      { ...LONG, sentAt: now }
    ]
    let result: ReturnType<typeof useQueuedOwnSends<(typeof pending)[number]>> | null = null
    function Own(): null {
      result = useQueuedOwnSends(pending, [SHORT.text, LONG.text], true, {
        scopeKey: 's',
        readsQueueBox: true,
        readBeat: null
      })
      return null
    }
    let renderer: ReactTestRenderer | null = null
    act(() => {
      renderer = create(createElement(Own))
    })
    expect(result!.pending).toEqual([])
    expect(result!.queue.map(rowText)).toEqual([SHORT.text, LONG.text])
    act(() => renderer!.unmount())
  })
})
