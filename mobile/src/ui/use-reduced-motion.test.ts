import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  answer: null as null | boolean | 'reject' | 'never',
  /** `false` removes AccessibilityInfo from the module entirely. */
  apiPresent: true,
  listener: null as null | ((enabled: boolean) => void)
}))

vi.mock('react-native', () => ({
  get AccessibilityInfo() {
    if (!mocks.apiPresent) {
      return undefined
    }
    return {
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
  }
}))

import {
  REDUCED_MOTION_PREFERENCE_WAIT_MS,
  resetReducedMotionForTests,
  useReducedMotion
} from './use-reduced-motion'

let seen: ReturnType<typeof useReducedMotion>[] = []
let renderer: ReactTestRenderer | null = null

function Probe() {
  seen.push(useReducedMotion())
  return null
}

async function mount() {
  await act(async () => {
    renderer = create(createElement(Probe))
  })
}

function unmount() {
  act(() => renderer?.unmount())
  renderer = null
}

beforeEach(() => {
  vi.useFakeTimers()
  seen = []
  mocks.answer = null
  mocks.apiPresent = true
  mocks.listener = null
  resetReducedMotionForTests()
})

afterEach(() => {
  unmount()
  vi.useRealTimers()
})

describe('the reduce-motion setting', () => {
  /**
   * The cache is what makes a first frame usable, and it is also the one way
   * the hook can start from a WRONG answer: the OS setting can change while no
   * consumer is mounted to hear `reduceMotionChanged`, so the next mount seeds
   * from a value that is now stale.
   *
   * This is not hypothetical — it is the trigger for the drawer defect found on
   * 2026-09-17, where a stale `true` drew the first frame near opacity 0 and the
   * correction to `false` then dropped the opacity key entirely, stranding an
   * interactive drawer invisible. The suite had every other transition and not
   * this one, which is why it shipped.
   */
  it('corrects a cached answer that has gone stale since the last mount', async () => {
    mocks.answer = true
    await mount()
    expect(seen.at(-1)).toBe(true)
    unmount()

    // The user turned the setting off with nothing mounted to hear it.
    seen = []
    mocks.answer = false
    await mount()

    // The first frame trusts the cache, which is the whole point of having one.
    expect(seen[0]).toBe(true)
    // And the OS's answer must win, or every later mount stays wrong.
    expect(seen.at(-1)).toBe(false)
  })

  it('is unknown until the OS has answered', async () => {
    mocks.answer = 'never'
    await mount()
    expect(seen.at(-1)).toBeNull()
  })

  it('reads false when the OS says motion is not reduced', async () => {
    mocks.answer = false
    await mount()
    expect(seen.at(-1)).toBe(false)
  })

  it('reads true when the OS says motion is reduced', async () => {
    mocks.answer = true
    await mount()
    expect(seen.at(-1)).toBe(true)
  })

  // The failure path: the accessibility service can reject. The hook this
  // replaces (onboarding's useReducedMotionEnabled) stayed null for ever
  // then, which is fine for a decorative loop and fatal for a drawer.
  it('falls back to full motion when the OS never answers', async () => {
    mocks.answer = 'reject'
    await mount()
    expect(seen.at(-1)).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(REDUCED_MOTION_PREFERENCE_WAIT_MS - 1)
    })
    expect(seen.at(-1)).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(seen.at(-1)).toBe(false)
  })

  it('does not let the fallback override an answer that arrived first', async () => {
    mocks.answer = true
    await mount()
    await act(async () => {
      vi.advanceTimersByTime(REDUCED_MOTION_PREFERENCE_WAIT_MS + 10)
    })
    expect(seen.at(-1)).toBe(true)
  })

  it('follows the setting when it changes while the app is open', async () => {
    mocks.answer = false
    await mount()
    expect(seen.at(-1)).toBe(false)
    await act(async () => {
      mocks.listener?.(true)
    })
    expect(seen.at(-1)).toBe(true)
  })

  // The other failure path: no accessibility API at all. Nine surfaces now
  // consult this hook, most of them rendered in tests whose react-native is
  // a handful of host tags; a runtime without the module must not take the
  // spinner (or the drawer) down with it. Drive the genuine absence.
  it('survives a runtime with no AccessibilityInfo at all, and falls back to full motion', async () => {
    mocks.apiPresent = false
    await mount()
    expect(seen.at(-1)).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(REDUCED_MOTION_PREFERENCE_WAIT_MS)
    })
    expect(seen.at(-1)).toBe(false)
  })
})

// Every mount asks the OS again, and the OS answers asynchronously, so
// without memory the thirtieth spinner in a list would hold for a tick and
// a drawer would open its first frame before the answer landed. The last
// answer is remembered process-wide so later mounts start from it.
describe('what later mounts start from', () => {
  it('starts a second mount from the last answer, synchronously', async () => {
    mocks.answer = true
    await mount()
    expect(seen.at(-1)).toBe(true)
    unmount()

    seen = []
    mocks.answer = 'never'
    await mount()
    expect(seen[0]).toBe(true)
  })

  it('does not remember the fallback’s guess, only what the OS said', async () => {
    mocks.answer = 'reject'
    await mount()
    await act(async () => {
      vi.advanceTimersByTime(REDUCED_MOTION_PREFERENCE_WAIT_MS)
    })
    expect(seen.at(-1)).toBe(false)
    unmount()

    seen = []
    mocks.answer = 'never'
    await mount()
    expect(seen[0]).toBeNull()
  })

  it('forgets on reset, so one test cannot leak its answer into the next', async () => {
    mocks.answer = true
    await mount()
    unmount()
    resetReducedMotionForTests()

    seen = []
    mocks.answer = 'never'
    await mount()
    expect(seen[0]).toBeNull()
  })
})
