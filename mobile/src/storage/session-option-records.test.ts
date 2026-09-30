import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatSessionOptionRecord } from '../../../src/shared/native-chat-session-option-state'
import { mergeStoredSessionOptionRecord, readSessionOptionRecord } from './session-option-records'

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

// A record is written whole, but storage can hand back one that is not: an
// older build's shape, a write cut short, a hand edit. The merge ran
// Object.entries over each model's values and read `tracked.source` with no
// check, so one null threw "Cannot convert undefined or null to object" into
// a `void` promise nobody caught, and every effort and toggle pick in the
// record silently fell back to the catalog default for the rest of the run.
describe('a stored option record that was half written', () => {
  const effortHigh = { effort: { value: 'high', source: 'dispatched' as const } }
  const live = (): NativeChatSessionOptionRecord => ({ agent: 'claude', valuesByModel: {} })
  // Storage is untyped: these are the shapes a bad blob parses to.
  const halfWritten = (valuesByModel: unknown): NativeChatSessionOptionRecord =>
    ({ agent: 'claude', valuesByModel }) as NativeChatSessionOptionRecord

  it('restores nothing, and throws nothing, for a model whose values are null', () => {
    const record = live()
    expect(() => mergeStoredSessionOptionRecord(record, halfWritten({ opus: null }))).not.toThrow()
    expect(record.valuesByModel.opus?.effort).toBeUndefined()
  })

  it('skips a null tracked entry and keeps the good one beside it', () => {
    const record = live()
    expect(mergeStoredSessionOptionRecord(record, halfWritten({ opus: { ...effortHigh, fast: null } }))).toBe(true)
    expect(record.valuesByModel.opus).toEqual(effortHigh)
  })

  it('does not spread a string model entry into one option per character', () => {
    const record = live()
    expect(mergeStoredSessionOptionRecord(record, halfWritten({ opus: 'high' }))).toBe(false)
    expect(record.valuesByModel.opus ?? {}).toEqual({})
  })

  it('skips entries that are not a tracked value: an array, a bad value, an unknown source', () => {
    const record = live()
    const stored = halfWritten({
      opus: {
        effort: ['high'],
        fast: { value: { on: true }, source: 'dispatched' },
        thinking: { value: true, source: 'unknown' },
        verbose: { value: true }
      }
    })
    expect(mergeStoredSessionOptionRecord(record, stored)).toBe(false)
    expect(record.valuesByModel.opus ?? {}).toEqual({})
  })

  it('restores a good model next to a bad one', () => {
    const record = live()
    expect(mergeStoredSessionOptionRecord(record, halfWritten({ opus: null, sonnet: effortHigh }))).toBe(true)
    expect(record.valuesByModel.sonnet).toEqual(effortHigh)
  })

  it('merges nothing from an empty record', () => {
    const record = live()
    expect(mergeStoredSessionOptionRecord(record, halfWritten({}))).toBe(false)
    expect(record.valuesByModel).toEqual({})
  })
})

describe('reading a stored option record that was half written', () => {
  const scope = 'host\u0000worktree\u0000tab'
  const storageKey = `orca:sessionOptions:${encodeURIComponent(scope)}`

  beforeEach(async () => {
    await AsyncStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hands back the good picks and drops the bad entries, so nothing downstream meets them', async () => {
    await AsyncStorage.setItem(
      storageKey,
      JSON.stringify({
        agent: 'claude',
        model: null,
        valuesByModel: {
          opus: null,
          fable: 'medium',
          sonnet: { effort: { value: 'low', source: 'dispatched' }, fast: null }
        }
      })
    )
    expect(await readSessionOptionRecord(scope)).toEqual({
      status: 'record',
      record: {
        agent: 'claude',
        valuesByModel: { sonnet: { effort: { value: 'low', source: 'dispatched' } } }
      }
    })
  })

  it('keeps a well-formed stored record as it is', async () => {
    const whole: NativeChatSessionOptionRecord = {
      agent: 'claude',
      model: { value: 'opus', source: 'reported' },
      valuesByModel: {
        opus: { effort: { value: 'max', source: 'dispatched' }, fast: { value: true, source: 'applied' } }
      }
    }
    await AsyncStorage.setItem(storageKey, JSON.stringify(whole))
    expect(await readSessionOptionRecord(scope)).toEqual({ status: 'record', record: whole })
  })

  // Overwriting such a record loses nothing a picker could show, so the hook
  // may save over it; the line says why the picks did not come back.
  it('counts a record with no agent or no per-model map as nothing stored, and says so in one line', async () => {
    await AsyncStorage.setItem(storageKey, JSON.stringify({ valuesByModel: {} }))
    expect(await readSessionOptionRecord(scope)).toEqual({ status: 'none' })
    await AsyncStorage.setItem(storageKey, JSON.stringify({ agent: 'claude', valuesByModel: [] }))
    expect(await readSessionOptionRecord(scope)).toEqual({ status: 'none' })
    expect(console.warn).toHaveBeenCalledTimes(2)
    const line = String(vi.mocked(console.warn).mock.calls[0]?.[0])
    expect(line).toContain('[session-options] picks for')
    expect(line).toContain('worktree')
    expect(line).toContain('no agent or no per-model map')
  })

  it('counts a record that does not parse as nothing stored, and says so in one line', async () => {
    await AsyncStorage.setItem(storageKey, '{"agent":"claude","valuesByModel":{"opus":')
    expect(await readSessionOptionRecord(scope)).toEqual({ status: 'none' })
    expect(console.warn).toHaveBeenCalledTimes(1)
    const line = String(vi.mocked(console.warn).mock.calls[0]?.[0])
    expect(line).toContain('[session-options] picks for')
    expect(line).toContain('does not parse')
  })
})

// A refused read used to come back as null, the same answer as "nothing was
// ever stored". The hook then treated the tab as restored and wrote its live
// record over picks the store had only declined to show it.
describe('reading a stored option record the store refuses', () => {
  const scope = 'host\u0000worktree\u0000tab'
  const storageKey = `orca:sessionOptions:${encodeURIComponent(scope)}`

  beforeEach(async () => {
    await AsyncStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('tells a refused read apart from nothing stored, and carries the store’s own error', async () => {
    await AsyncStorage.setItem(
      storageKey,
      JSON.stringify({ agent: 'claude', valuesByModel: { opus: { effort: { value: 'high', source: 'dispatched' } } } })
    )
    const locked = new Error('database is locked (code 5 SQLITE_BUSY)')
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(locked)
    expect(await readSessionOptionRecord(scope)).toEqual({ status: 'refused', error: locked })
    // The caller knows what the refusal costs, so it is the one that says so.
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('reads nothing stored as none, not as a refusal', async () => {
    expect(await readSessionOptionRecord(scope)).toEqual({ status: 'none' })
    expect(console.warn).not.toHaveBeenCalled()
  })
})
