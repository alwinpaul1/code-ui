/**
 * The recording row's Stop dictation (the Claude app's `kcw.f`: Stop ends the take and the words
 * stay in the composer; Cancel is the one that throws them away). Pinned against the hold-mode hook,
 * which owns the take.
 */
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { useDictationHoldMode, type DictationHoldModeActions } from './use-dictation-hold-mode'

type State = { isStarting: boolean; isRecording: boolean; isProcessing: boolean }

function mount(state: State): {
  actions: DictationHoldModeActions
  calls: { stops: number; cancels: number; restores: boolean[] }
} {
  const calls = { stops: 0, cancels: 0, restores: [] as boolean[] }
  const held: { actions: DictationHoldModeActions | null } = { actions: null }
  const dictation = {
    ...state,
    start: async () => {},
    stop: async () => {
      calls.stops += 1
    },
    cancel: async () => {
      calls.cancels += 1
    }
  }
  function Probe(): null {
    held.actions = useDictationHoldMode({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook reads only the flags and methods above.
      dictation: dictation as never,
      engineChoice: 'anthropic',
      usesLivePartials: true,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: unused once a take is running.
      liveTranscription: { isRecording: false, start: async () => {}, cancel: async () => {} } as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: unused once a take is running.
      anthropicDictation: { available: true, start: async () => {} } as never,
      targetIsChat: () => true,
      prepareLiveStart: () => {},
      prepareDesktopStart: () => () => {},
      restoreLiveCancel: (forSend) => {
        calls.restores.push(forSend)
      },
      triggerError: () => {},
      showToast: () => {},
      reportDictationFailure: () => {}
    })
    return null
  }
  act(() => {
    create(createElement(Probe))
  })
  return { actions: held.actions!, calls }
}

describe('Stop dictation on the recording row', () => {
  it('ends a recording take and keeps its words: a stop, never a cancel or a restore', () => {
    const { actions, calls } = mount({ isStarting: false, isRecording: true, isProcessing: false })
    actions.stopDictation()
    expect(calls).toEqual({ stops: 1, cancels: 0, restores: [] })
  })

  it('gives up a take that has not started recording yet, since there are no words to keep', () => {
    const { actions, calls } = mount({ isStarting: true, isRecording: false, isProcessing: false })
    actions.stopDictation()
    expect(calls.stops).toBe(0)
    expect(calls.cancels).toBe(1)
  })

  it('does nothing while the take is already transcribing, or with no take at all', () => {
    for (const state of [
      { isStarting: false, isRecording: false, isProcessing: true },
      { isStarting: false, isRecording: false, isProcessing: false }
    ]) {
      const { actions, calls } = mount(state)
      actions.stopDictation()
      expect(calls).toEqual({ stops: 0, cancels: 0, restores: [] })
    }
  })
})
