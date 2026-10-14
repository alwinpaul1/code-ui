/**
 * Two behaviours the hold-mode extraction (use-dictation-hold-mode.ts, 2026-10-14) dropped, both
 * pinned against the hook itself because the session-route parity pins could no longer see them
 * once the callbacks moved out of the dictation hook.
 *
 * 1. A send ends dictation only when the words were going into the chat composer. Dictating into a
 *    terminal (or the buffered field) and sending must leave the recogniser alone: cancelling there
 *    erased the live transcript the user had just spoken into the PTY (the gate was
 *    `kind === 'chat'` before the extraction, from the 2026-09-13 send fix).
 * 2. A desktop start that rejects releases the route context it claimed, so the next transcript is
 *    not routed to a tab the failed take was aimed at.
 */
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { useDictationHoldMode, type DictationHoldModeActions } from './use-dictation-hold-mode'

type Calls = {
  restoreLiveCancel: boolean[]
  dictationCancels: number
  releasedStarts: number
  failures: unknown[]
}

function mount(opts: {
  targetIsChat: boolean
  recording: boolean
  startRejects?: Error
}): { actions: DictationHoldModeActions; calls: Calls } {
  const calls: Calls = { restoreLiveCancel: [], dictationCancels: 0, releasedStarts: 0, failures: [] }
  const held: { actions: DictationHoldModeActions | null } = { actions: null }
  const dictation = {
    isStarting: false,
    isRecording: opts.recording,
    isProcessing: false,
    start: () => (opts.startRejects ? Promise.reject(opts.startRejects) : Promise.resolve()),
    stop: async () => {},
    cancel: async () => {
      calls.dictationCancels += 1
    }
  }
  const live = { isRecording: false, start: async () => {}, cancel: async () => {} }

  function Probe(): null {
    held.actions = useDictationHoldMode({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook reads only the flags and methods above.
      dictation: dictation as never,
      engineChoice: 'desktop',
      usesLivePartials: false,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: unused on the desktop route.
      liveTranscription: live as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: unused on the desktop route.
      anthropicDictation: { available: false, start: async () => {} } as never,
      targetIsChat: () => opts.targetIsChat,
      prepareLiveStart: () => {},
      prepareDesktopStart: () => () => {
        calls.releasedStarts += 1
      },
      restoreLiveCancel: (forSend) => {
        calls.restoreLiveCancel.push(forSend)
      },
      triggerError: () => {},
      showToast: () => {},
      reportDictationFailure: (err) => {
        calls.failures.push(err)
      }
    })
    return null
  }

  act(() => {
    create(createElement(Probe))
  })
  return { actions: held.actions!, calls }
}

describe('sending while dictating', () => {
  it('ends the take when the words were going into the chat composer', () => {
    const { actions, calls } = mount({ targetIsChat: true, recording: true })
    actions.cancelDictation(true)
    expect(calls.restoreLiveCancel).toEqual([true])
    expect(calls.dictationCancels).toBe(1)
  })

  it('leaves a take into a terminal running, so its live transcript is not erased', () => {
    const { actions, calls } = mount({ targetIsChat: false, recording: true })
    actions.cancelDictation(true)
    expect(calls.restoreLiveCancel).toEqual([])
    expect(calls.dictationCancels).toBe(0)
  })

  it('does nothing when no take is running', () => {
    const { actions, calls } = mount({ targetIsChat: true, recording: false })
    actions.cancelDictation(true)
    expect(calls.dictationCancels).toBe(0)
  })

  it('still cancels a terminal take when the user cancels rather than sends', () => {
    const { actions, calls } = mount({ targetIsChat: false, recording: true })
    actions.cancelDictation()
    expect(calls.restoreLiveCancel).toEqual([false])
    expect(calls.dictationCancels).toBe(1)
  })
})

describe('a desktop start that fails', () => {
  it('releases the route context it claimed, then reports the failure', async () => {
    const refused = new Error('dictation_already_active')
    const { actions, calls } = mount({ targetIsChat: true, recording: false, startRejects: refused })
    await act(async () => {
      actions.startDictation()
      await Promise.resolve()
    })
    expect(calls.releasedStarts).toBe(1)
    expect(calls.failures).toEqual([refused])
  })

  it('keeps the route context when the start succeeds', async () => {
    const { actions, calls } = mount({ targetIsChat: true, recording: false })
    await act(async () => {
      actions.startDictation()
      await Promise.resolve()
    })
    expect(calls.releasedStarts).toBe(0)
    expect(calls.failures).toEqual([])
  })
})

