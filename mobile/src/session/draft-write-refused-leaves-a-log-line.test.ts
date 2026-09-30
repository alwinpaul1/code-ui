import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

// The composer's draft goes to disk through useDebouncedPersist, which drops
// whatever the write returns. A full phone refuses the write, and before this
// nothing said so: no warning, and no unhandled rejection either, because the
// store's own barrier had already marked the promise handled. The erase after
// a send is the costly one: refused, it leaves the sent text on disk to come
// back as the draft (use-debounced-persist.ts, reported 2026-09-13).
const refusal = new Error('Database or disk is full (code 13 SQLITE_FULL)')

vi.mock('@react-native-async-storage/async-storage', () => {
  const storage = {
    getItem: async () => null,
    setItem: async () => {
      throw refusal
    },
    removeItem: async () => {
      throw refusal
    }
  }
  return { default: storage, ...storage }
})

import { useMobileNativeChatDraftPersistence } from './use-mobile-native-chat-draft-persistence'

let renderer: ReactTestRenderer | null = null
let warn: MockInstance<typeof console.warn>
let unhandled = 0
const countUnhandled = (): void => {
  unhandled += 1
}

beforeEach(() => {
  unhandled = 0
  process.on('unhandledRejection', countUnhandled)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  process.off('unhandledRejection', countUnhandled)
  warn.mockRestore()
})

function Harness({ drafts }: { drafts: Record<string, string> }): null {
  useMobileNativeChatDraftPersistence('k', drafts, () => undefined)
  return null
}

/** Past the 250 ms debounce, on real timers, as the phone runs it. */
async function afterTheDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400))
  })
}

describe('a draft write the phone refuses', () => {
  it('leaves exactly one log line for a refused save, without the draft in it', async () => {
    act(() => {
      renderer = create(createElement(Harness, { drafts: { k: 'hello' } }))
    })
    await afterTheDebounce()
    expect({ unhandled, logged: warn.mock.calls.length }).toEqual({ unhandled: 0, logged: 1 })
    expect(String(warn.mock.calls[0]![0])).toContain('save')
    expect(warn.mock.calls[0]).toContain(refusal)
    expect(JSON.stringify(warn.mock.calls.map((call) => call.map(String)))).not.toContain('hello')
  })

  it('leaves exactly one log line when the erase after a send is refused', async () => {
    act(() => {
      renderer = create(createElement(Harness, { drafts: { k: '' } }))
    })
    await afterTheDebounce()
    expect({ unhandled, logged: warn.mock.calls.length }).toEqual({ unhandled: 0, logged: 1 })
    expect(String(warn.mock.calls[0]![0])).toContain('erase')
    expect(warn.mock.calls[0]).toContain(refusal)
  })

  it('leaves one line for the erase flushed as the chat closes mid-debounce', async () => {
    act(() => {
      renderer = create(createElement(Harness, { drafts: { k: '' } }))
    })
    act(() => renderer?.unmount())
    renderer = null
    await afterTheDebounce()
    expect({ unhandled, logged: warn.mock.calls.length }).toEqual({ unhandled: 0, logged: 1 })
    expect(String(warn.mock.calls[0]![0])).toContain('erase')
  })
})
