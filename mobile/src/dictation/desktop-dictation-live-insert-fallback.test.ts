import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest'
import { deliverDesktopDictation } from './place-dictation-transcript'

// Desktop dictation with live terminal input on: the words go straight to the PTY. When that
// could not happen (no terminal handle, the pending live input would not flush, or the send came
// back false, which sendLiveTerminalInput does on any rejected RPC, a dropped connection or a
// stale tab and toasts only for oversize input), deliverDesktopDictation returned with no toast
// and no fallback. The user spoke, the desktop transcribed, and the words vanished with nothing on
// screen (review, 2026-09-30).

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

type SetInput = (update: (current: string) => string) => void

type Harness = {
  box: { value: string }
  toasts: string[]
  sends: [string, string][]
  setInput: Mock<SetInput>
}

function deliver(overrides: {
  activeHandle?: string | null
  routeContext?: { handle: string | null; liveInputEnabled: boolean } | null
  flushPending?: (handle: string) => Promise<boolean>
  send?: (harness: Harness) => Promise<boolean>
  box?: string
}): Harness {
  const harness: Harness = {
    box: { value: overrides.box ?? '' },
    toasts: [],
    sends: [],
    setInput: vi.fn<SetInput>()
  }
  harness.setInput.mockImplementation((update) => {
    harness.box.value = update(harness.box.value)
  })
  deliverDesktopDictation({
    text: 'hello',
    showNativeChat: false,
    liveInputEnabled: true,
    activeHandle: overrides.activeHandle === undefined ? 'h1' : overrides.activeHandle,
    routeContext: overrides.routeContext ?? null,
    flushPending: overrides.flushPending ?? (async () => true),
    sendLiveTerminalInput: async (handle, bytes) => {
      harness.sends.push([handle, bytes])
      return overrides.send ? overrides.send(harness) : true
    },
    setInput: harness.setInput,
    showToast: (message) => harness.toasts.push(message),
    setChatComposerText: () => {
      throw new Error('terminal dictation must not touch the chat composer')
    }
  })
  return harness
}

let warn: MockInstance<typeof console.warn>
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
})

const KEPT = /command box/i

describe('desktop dictation that could not be inserted into the live terminal', () => {
  it('keeps the words in the command box when the live send is refused, and says so', async () => {
    const run = deliver({ send: async () => false, box: 'ls' })
    await settle()
    expect(run.sends).toEqual([['h1', 'hello']])
    expect(run.box.value).toBe('ls hello')
    expect(run.toasts).toHaveLength(1)
    expect(run.toasts[0]).toMatch(KEPT)
    expect(run.toasts).not.toContain('Dictation inserted')
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/send/i)
  })

  it('keeps them when there is no terminal handle to insert into', async () => {
    const run = deliver({ activeHandle: null })
    await settle()
    expect(run.sends).toEqual([])
    expect(run.box.value).toBe('hello')
    expect(run.toasts).toHaveLength(1)
    expect(run.toasts[0]).toMatch(KEPT)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/no terminal/i)
  })

  it('keeps them when the pending live input will not flush first, and never sends', async () => {
    const run = deliver({ flushPending: async () => false })
    await settle()
    expect(run.sends).toEqual([])
    expect(run.box.value).toBe('hello')
    expect(run.toasts).toHaveLength(1)
    expect(run.toasts[0]).toMatch(KEPT)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/flush/i)
  })

  it('keeps them when the flush or the send throws instead of answering', async () => {
    const flushThrew = deliver({ flushPending: () => Promise.reject(new Error('relay gone')) })
    const sendThrew = deliver({ send: () => Promise.reject(new Error('socket closed')) })
    await settle()
    for (const run of [flushThrew, sendThrew]) {
      expect(run.box.value).toBe('hello')
      expect(run.toasts).toHaveLength(1)
      expect(run.toasts[0]).toMatch(KEPT)
    }
    expect(flushThrew.sends).toEqual([])
    const warned = warn.mock.calls.map((call) => call.map(String).join(' '))
    expect(warned.some((line) => /flush/i.test(line) && line.includes('relay gone'))).toBe(true)
    expect(warned.some((line) => /send/i.test(line) && line.includes('socket closed'))).toBe(true)
  })

  it('still keeps them after an oversize send that toasted its own reason, with nothing saying inserted', async () => {
    const run = deliver({
      send: async (harness) => {
        harness.toasts.push('Input too large (max 256 KiB)')
        return false
      }
    })
    await settle()
    expect(run.box.value).toBe('hello')
    expect(run.toasts[0]).toBe('Input too large (max 256 KiB)')
    expect(run.toasts.slice(1)).toHaveLength(1)
    expect(run.toasts[1]).toMatch(KEPT)
    expect(run.toasts).not.toContain('Dictation inserted')
  })

  it('inserts once and leaves the command box alone when the live send lands', async () => {
    const run = deliver({ box: 'ls' })
    await settle()
    expect(run.sends).toEqual([['h1', 'hello']])
    expect(run.toasts).toEqual(['Dictation inserted'])
    expect(run.setInput).not.toHaveBeenCalled()
    expect(run.box.value).toBe('ls')
    expect(warn).not.toHaveBeenCalled()
  })

  it('inserts into the terminal the dictation started on, not the one active now', async () => {
    const run = deliver({ routeContext: { handle: 'h0', liveInputEnabled: true } })
    await settle()
    expect(run.sends).toEqual([['h0', 'hello']])
    expect(run.toasts).toEqual(['Dictation inserted'])
  })
})
