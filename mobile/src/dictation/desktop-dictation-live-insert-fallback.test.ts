import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest'
import { deliverDesktopDictation } from './place-dictation-transcript'

// Desktop dictation with live terminal input on: the words go straight to the PTY. When that
// could not happen (no terminal handle, the pending live input would not flush, or the send came
// back false, which sendLiveTerminalInput does on any rejected RPC, a dropped connection or a
// stale tab and toasts only for oversize input), deliverDesktopDictation returned with no toast
// and no fallback. The user spoke, the desktop transcribed, and the words vanished with nothing on
// screen (review, 2026-09-30).
//
// The first fallback (557c4233) put the words in the buffered command draft and toasted "kept in
// the command box". But while live input is on the dock draws the live field, and the buffered box
// is not mounted at all: the words sat in hidden state under a toast pointing at a box that was not
// there, and surfaced later, unasked, when live input was switched off (review, 2026-09-30). Those
// tests checked the setInput mock and never what was on screen. Here `boxOnScreen` is what the dock
// draws when the words land, and the words must end up in that box or on the clipboard, with a
// toast that names the one they are in.

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

type SetInput = (update: (current: string) => string) => void

type Harness = {
  box: { value: string }
  toasts: string[]
  sends: [string, string][]
  clipboard: string[]
  composer: { value: string }
  setInput: Mock<SetInput>
  dock: { boxOnScreen: boolean }
}

function deliver(overrides: {
  activeHandle?: string | null
  routeContext?: { handle: string | null; liveInputEnabled: boolean } | null
  liveInputEnabled?: boolean
  showNativeChat?: boolean
  flushPending?: (handle: string) => Promise<boolean>
  send?: (harness: Harness) => Promise<boolean>
  box?: string
  /** What the dock draws when the fallback lands; live input on means the live field, not the box. */
  boxOnScreen?: boolean
  clipboardRefuses?: boolean
}): Harness {
  const harness: Harness = {
    box: { value: overrides.box ?? '' },
    toasts: [],
    sends: [],
    clipboard: [],
    composer: { value: '' },
    setInput: vi.fn<SetInput>(),
    dock: { boxOnScreen: overrides.boxOnScreen ?? false }
  }
  harness.setInput.mockImplementation((update) => {
    harness.box.value = update(harness.box.value)
  })
  deliverDesktopDictation({
    text: 'hello',
    showNativeChat: overrides.showNativeChat ?? false,
    liveInputEnabled: overrides.liveInputEnabled ?? true,
    activeHandle: overrides.activeHandle === undefined ? 'h1' : overrides.activeHandle,
    routeContext: overrides.routeContext ?? null,
    flushPending: overrides.flushPending ?? (async () => true),
    sendLiveTerminalInput: async (handle, bytes) => {
      harness.sends.push([handle, bytes])
      return overrides.send ? overrides.send(harness) : true
    },
    setInput: harness.setInput,
    showToast: (message) => harness.toasts.push(message),
    setChatComposerText: (update) => {
      harness.composer.value = update(harness.composer.value)
    },
    commandBoxOnScreen: () => harness.dock.boxOnScreen,
    copyToClipboard: async (text) => {
      if (overrides.clipboardRefuses) {
        throw new Error('the clipboard did not accept this text')
      }
      harness.clipboard.push(text)
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

const COPIED = /not inserted.*clipboard/i
const KEPT = /command box/i
const warned = () => warn.mock.calls.map((call) => call.map(String).join(' '))

/** The words are on the clipboard, the hidden command draft never saw them, and the toast says so. */
function expectCopied(run: Harness, box = ''): void {
  expect(run.clipboard).toEqual(['hello'])
  expect(run.setInput).not.toHaveBeenCalled()
  expect(run.box.value).toBe(box)
  expect(run.toasts.at(-1)).toMatch(COPIED)
  expect(run.toasts.join('\n')).not.toMatch(KEPT)
  expect(run.toasts).not.toContain('Dictation inserted')
}

describe('desktop dictation that could not be inserted into the live terminal', () => {
  it('copies the words to the clipboard rather than the hidden command box when the live send is refused', async () => {
    const run = deliver({ send: async () => false, box: 'ls' })
    await settle()
    expect(run.sends).toEqual([['h1', 'hello']])
    expectCopied(run, 'ls')
    expect(run.toasts).toHaveLength(1)
    expect(warned()).toHaveLength(1)
    expect(warned()[0]).toMatch(/send/i)
    expect(warned()[0]).toMatch(/clipboard/i)
  })

  it('copies them when there is no terminal handle to insert into', async () => {
    const run = deliver({ activeHandle: null })
    await settle()
    expect(run.sends).toEqual([])
    expectCopied(run)
    expect(run.toasts).toHaveLength(1)
    expect(warned()[0]).toMatch(/no terminal/i)
  })

  it('copies them when the pending live input will not flush first, and never sends', async () => {
    const run = deliver({ flushPending: async () => false })
    await settle()
    expect(run.sends).toEqual([])
    expectCopied(run)
    expect(run.toasts).toHaveLength(1)
    expect(warned()[0]).toMatch(/flush/i)
  })

  it('copies them when the flush or the send throws instead of answering', async () => {
    const flushThrew = deliver({ flushPending: () => Promise.reject(new Error('relay gone')) })
    const sendThrew = deliver({ send: () => Promise.reject(new Error('socket closed')) })
    await settle()
    for (const run of [flushThrew, sendThrew]) {
      expectCopied(run)
      expect(run.toasts).toHaveLength(1)
    }
    expect(flushThrew.sends).toEqual([])
    expect(warned().some((line) => /flush/i.test(line) && line.includes('relay gone'))).toBe(true)
    expect(warned().some((line) => /send/i.test(line) && line.includes('socket closed'))).toBe(true)
  })

  it('copies them after an oversize send that toasted its own reason, and toasts after it', async () => {
    const run = deliver({
      send: async (harness) => {
        harness.toasts.push('Input too large (max 256 KiB)')
        return false
      }
    })
    await settle()
    expectCopied(run)
    expect(run.toasts[0]).toBe('Input too large (max 256 KiB)')
    expect(run.toasts).toHaveLength(2)
  })

  it('says the dictation was lost, and why, when the clipboard refuses it too', async () => {
    const run = deliver({ send: async () => false, clipboardRefuses: true, box: 'ls' })
    await settle()
    expect(run.clipboard).toEqual([])
    expect(run.setInput).not.toHaveBeenCalled()
    expect(run.box.value).toBe('ls')
    expect(run.toasts).toHaveLength(1)
    expect(run.toasts[0]).toMatch(/not inserted/i)
    // Nothing on screen claims the words were kept anywhere.
    expect(run.toasts[0]).not.toMatch(COPIED)
    expect(run.toasts[0]).not.toMatch(KEPT)
    expect(run.toasts[0]).not.toMatch(/kept|copied to/i)
    expect(warned()).toHaveLength(1)
    expect(warned()[0]).toMatch(/send/i)
    expect(warned()[0]).toContain('the clipboard did not accept this text')
  })

  it('puts them in the command box when live input was switched off before the send came back', async () => {
    const run = deliver({
      box: 'ls',
      send: async (harness) => {
        // The dock now draws the buffered box: the route's snapshot from before the await is stale.
        harness.dock.boxOnScreen = true
        return false
      }
    })
    await settle()
    expect(run.box.value).toBe('ls hello')
    expect(run.clipboard).toEqual([])
    expect(run.toasts).toHaveLength(1)
    expect(run.toasts[0]).toMatch(KEPT)
    expect(warned()[0]).toMatch(/send/i)
  })

  it('inserts once and touches neither the command box nor the clipboard when the live send lands', async () => {
    const run = deliver({ box: 'ls' })
    await settle()
    expect(run.sends).toEqual([['h1', 'hello']])
    expect(run.toasts).toEqual(['Dictation inserted'])
    expect(run.setInput).not.toHaveBeenCalled()
    expect(run.box.value).toBe('ls')
    expect(run.clipboard).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it('inserts into the terminal the dictation started on, not the one active now', async () => {
    const run = deliver({ routeContext: { handle: 'h0', liveInputEnabled: true } })
    await settle()
    expect(run.sends).toEqual([['h0', 'hello']])
    expect(run.toasts).toEqual(['Dictation inserted'])
  })
})

describe('desktop dictation with live input off', () => {
  it('still lands in the visible command box with "Dictation inserted"', async () => {
    const run = deliver({ liveInputEnabled: false, boxOnScreen: true, box: 'ls' })
    await settle()
    expect(run.sends).toEqual([])
    expect(run.box.value).toBe('ls hello')
    expect(run.toasts).toEqual(['Dictation inserted'])
    expect(run.clipboard).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it('copies the words when the command box is not on screen by the time they arrive', async () => {
    // Started on a buffered terminal, then the user opened a file tab, the chat view, or a
    // terminal with live input on. The draft that setInput writes is not drawn, or (no terminal
    // handle) not written at all, and "Dictation inserted" pointed at nothing.
    const run = deliver({ liveInputEnabled: false, boxOnScreen: false, box: 'ls' })
    await settle()
    expect(run.sends).toEqual([])
    expectCopied(run, 'ls')
    expect(warned()[0]).toMatch(/command box is not on screen/i)
  })
})

describe('desktop dictation into the native chat composer', () => {
  it('appends to the composer and touches neither the terminal, the command box nor the clipboard', async () => {
    const run = deliver({ showNativeChat: true, box: 'ls' })
    await settle()
    expect(run.composer.value).toBe('hello')
    expect(run.toasts).toEqual(['Dictation inserted'])
    expect(run.sends).toEqual([])
    expect(run.setInput).not.toHaveBeenCalled()
    expect(run.clipboard).toEqual([])
  })
})
