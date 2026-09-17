import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  answer: null as null | boolean | 'reject' | 'never',
  listener: null as null | ((enabled: boolean) => void)
}))

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: vi.fn((_event: string, listener: (enabled: boolean) => void) => {
      mocks.listener = listener
      return { remove: vi.fn() }
    }),
    isReduceMotionEnabled: vi.fn(() => {
      if (mocks.answer === 'reject') {
        return Promise.reject(new Error('no accessibility service'))
      }
      if (mocks.answer === 'never') {
        return new Promise<boolean>(() => {})
      }
      return Promise.resolve(Boolean(mocks.answer))
    })
  }
}))

import { resetReducedMotionForTests } from '../use-reduced-motion'
import { ALERT_MOTION_PREFERENCE_WAIT_MS, useAlertMotion } from './use-alert-motion'

let seen: (ReturnType<typeof useAlertMotion>)[] = []
let renderer: ReactTestRenderer | null = null

function Probe() {
  seen.push(useAlertMotion())
  return null
}

async function mount() {
  await act(async () => {
    renderer = create(createElement(Probe))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  seen = []
  mocks.answer = null
  mocks.listener = null
  // The shared hook remembers the OS's last answer across mounts; each case
  // here states its own answer, so none may inherit the previous one's.
  resetReducedMotionForTests()
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

describe('how the alert should move', () => {
  it('holds the card until the OS has said whether motion is reduced', async () => {
    mocks.answer = 'never'
    await mount()
    expect(seen.at(-1)).toBeNull()
  })

  it('springs when the OS says motion is not reduced', async () => {
    mocks.answer = false
    await mount()
    expect(seen.at(-1)).toBe('spring')
  })

  it('cross-fades when the OS says motion is reduced', async () => {
    mocks.answer = true
    await mount()
    expect(seen.at(-1)).toBe('crossfade')
  })

  // The failure path: the accessibility service can reject, and the hook the
  // onboarding preview uses then stays null for ever. An alert that never
  // appears is worse than one that moves; give the OS a beat, then show it.
  it('falls back to full motion when the OS never answers, so the card still appears', async () => {
    mocks.answer = 'reject'
    await mount()
    expect(seen.at(-1)).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(ALERT_MOTION_PREFERENCE_WAIT_MS - 1)
    })
    expect(seen.at(-1)).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(seen.at(-1)).toBe('spring')
  })

  it('does not let the fallback override an answer that arrived first', async () => {
    mocks.answer = true
    await mount()
    await act(async () => {
      vi.advanceTimersByTime(ALERT_MOTION_PREFERENCE_WAIT_MS + 10)
    })
    expect(seen.at(-1)).toBe('crossfade')
  })

  it('follows the setting when it changes while the app is open', async () => {
    mocks.answer = false
    await mount()
    expect(seen.at(-1)).toBe('spring')
    await act(async () => {
      mocks.listener?.(true)
    })
    expect(seen.at(-1)).toBe('crossfade')
  })
})
