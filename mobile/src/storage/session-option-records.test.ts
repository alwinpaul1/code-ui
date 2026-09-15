import { describe, expect, it } from 'vitest'
import type { NativeChatSessionOptionRecord } from '../../../src/shared/native-chat-session-option-state'
import { mergeStoredSessionOptionRecord } from './session-option-records'

describe('mergeStoredSessionOptionRecord', () => {
  it('keeps the reported model but carries the user\'s effort pick over', () => {
    const live: NativeChatSessionOptionRecord = {
      agent: 'claude',
      model: { value: 'opus', source: 'reported' },
      valuesByModel: {}
    }
    const stored: NativeChatSessionOptionRecord = {
      agent: 'claude',
      model: { value: 'sonnet', source: 'dispatched' },
      valuesByModel: { opus: { effort: { value: 'high', source: 'dispatched' } } }
    }
    expect(mergeStoredSessionOptionRecord(live, stored)).toBe(true)
    expect(live.model).toEqual({ value: 'opus', source: 'reported' })
    expect(live.valuesByModel.opus?.effort).toEqual({ value: 'high', source: 'dispatched' })
  })

  it('never overrides a newer in-memory pick, and ignores stored reported values', () => {
    const live: NativeChatSessionOptionRecord = {
      agent: 'claude',
      valuesByModel: { opus: { effort: { value: 'max', source: 'dispatched' } } }
    }
    const stored: NativeChatSessionOptionRecord = {
      agent: 'claude',
      model: { value: 'opus', source: 'reported' },
      valuesByModel: {
        opus: { effort: { value: 'high', source: 'dispatched' }, fast: { value: true, source: 'reported' } }
      }
    }
    // Nothing is merged: the live effort pick is newer, the stored `fast` is a
    // reported value, and the model is no longer restored at all.
    expect(mergeStoredSessionOptionRecord(live, stored)).toBe(false)
    expect(live.valuesByModel.opus?.effort?.value).toBe('max')
    expect(live.valuesByModel.opus?.fast).toBeUndefined()
    // The stored MODEL is not restored — see the test below.
    expect(live.model).toBeUndefined()
  })

  // 2026-09-15, the last door the wrong model came through. The pill read
  // "Fable Medium" on a session whose own status line said Opus 5 xhigh, and
  // the live host reports no model at all (`orca worktree ps`: agentType, no
  // model), so it was not coming from there. It was the phone's own disk: a
  // model picked in some earlier session, restored on cold start and shown as
  // if it were current, with nothing marking it as a memory.
  //
  // The per-model OPTION values still restore, and must: effort and toggles are
  // never reported back by the agent, so a record lost with the process is lost
  // for good. The model is the opposite — the agent states it on every repaint,
  // so remembering it buys a second of nothing and costs a wrong answer.
  it('never restores a remembered model as the current one', () => {
    const live: NativeChatSessionOptionRecord = { agent: 'claude', valuesByModel: {} }
    const stored: NativeChatSessionOptionRecord = {
      agent: 'claude',
      model: { value: 'fable', source: 'reported' },
      valuesByModel: { fable: { effort: { value: 'medium', source: 'dispatched' } } }
    }
    mergeStoredSessionOptionRecord(live, stored)
    expect(live.model).toBeUndefined()
    // The effort pick for that model is still worth keeping.
    expect(live.valuesByModel.fable?.effort?.value).toBe('medium')
  })
})
