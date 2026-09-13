import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedPersist } from './use-debounced-persist'

const DELAY = 250

describe('useDebouncedPersist', () => {
  let renderer: ReactTestRenderer | null = null
  const write = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    write.mockClear()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  function Harness({ scope, text }: { scope: string | null; text: string | undefined }): null {
    useDebouncedPersist(scope, text, DELAY, write)
    return null
  }
  const mount = (props: { scope: string | null; text: string | undefined }) =>
    act(() => {
      renderer = create(createElement(Harness, props))
    })
  const update = (props: { scope: string | null; text: string | undefined }) =>
    act(() => renderer!.update(createElement(Harness, props)))

  it('writes once for a burst of typing, not once per keystroke', () => {
    // The first version put the flush in the timer's own cleanup, which React
    // also runs on every dependency change — so each character wrote to storage
    // synchronously during the commit, ~200 writes for a 200-character message.
    mount({ scope: 'tab', text: '' })
    for (const text of 'a message typed quickly'.split('').map((_, i, all) => all.slice(0, i + 1).join(''))) {
      update({ scope: 'tab', text })
    }
    expect(write).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(DELAY + 10))
    expect(write).toHaveBeenCalledExactlyOnceWith('tab', 'a message typed quickly')
  })

  it('still writes the newest value when the screen goes away mid-debounce', () => {
    mount({ scope: 'tab', text: 'half typed' })
    act(() => renderer!.unmount())
    renderer = null
    expect(write).toHaveBeenCalledExactlyOnceWith('tab', 'half typed')
  })

  it('does not write the same value twice when the timer already saved it', () => {
    mount({ scope: 'tab', text: 'saved' })
    act(() => vi.advanceTimersByTime(DELAY + 10))
    expect(write).toHaveBeenCalledOnce()
    act(() => renderer!.unmount())
    renderer = null
    expect(write).toHaveBeenCalledOnce()
  })

  it('flushes the old scope under its own key when the scope changes', () => {
    mount({ scope: 'tab-a', text: 'for a' })
    update({ scope: 'tab-b', text: 'for b' })
    expect(write).toHaveBeenCalledExactlyOnceWith('tab-a', 'for a')
    act(() => vi.advanceTimersByTime(DELAY + 10))
    expect(write).toHaveBeenLastCalledWith('tab-b', 'for b')
  })

  it('writes nothing without a scope or a value', () => {
    mount({ scope: null, text: 'nowhere' })
    update({ scope: 'tab', text: undefined })
    act(() => vi.advanceTimersByTime(DELAY + 10))
    expect(write).not.toHaveBeenCalled()
  })
})
