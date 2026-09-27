import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// expo-router's focus effect, drivable: `blur()` is another screen pushed over the session,
// `focus()` is coming back to it.
const focus = vi.hoisted(() => ({
  effect: null as null | (() => void | (() => void)),
  cleanup: null as null | (() => void),
  blur() {
    this.cleanup?.()
    this.cleanup = null
  },
  focus() {
    this.cleanup = this.effect?.() ?? null
  }
}))

vi.mock('expo-router', async () => {
  const { useEffect } = await import('react')
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => {
        focus.effect = effect
        focus.cleanup = effect() ?? null
        return () => {
          focus.cleanup?.()
          focus.cleanup = null
        }
      }, [effect])
    }
  }
})

import {
  useMobileSessionSaveToPhonePresence,
  type SaveToPhonePresence
} from './use-mobile-session-save-to-phone-presence'

let presence: SaveToPhonePresence | null = null
let tree: ReactTestRenderer | null = null

function Session() {
  presence = useMobileSessionSaveToPhonePresence().saveToPhonePresence
  return null
}

function enterSession(): SaveToPhonePresence {
  act(() => {
    tree = create(createElement(Session))
  })
  return presence!
}

afterEach(() => {
  act(() => tree?.unmount())
  tree = null
  presence = null
})

describe('whether the user is still in the session a tab-menu save was asked from', () => {
  it('is on screen while the session is in front, and not while another screen covers it', () => {
    const session = enterSession()
    expect(session.onScreen()).toBe(true)

    act(() => focus.blur())
    expect(session.onScreen()).toBe(false)

    act(() => focus.focus())
    expect(session.onScreen()).toBe(true)
  })

  it('keeps a save running while the session is only covered', () => {
    const session = enterSession()
    const signal = session.signal()

    act(() => focus.blur())

    expect(signal.aborted).toBe(false)
  })

  it('stops the save once the user leaves the session', () => {
    const session = enterSession()
    const signal = session.signal()

    act(() => tree?.unmount())
    tree = null

    expect(signal.aborted).toBe(true)
    expect(session.onScreen()).toBe(false)
    // A save asked for after that (it cannot be, the menu is gone) would not run either.
    expect(session.signal().aborted).toBe(true)
  })
})
